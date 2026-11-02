// Measures how much of the SGP4 implementation the published vectors actually
// constrain. Each numeric literal and arithmetic operator is changed in turn,
// the module is rebundled in memory, and all vectors are replayed. A mutant that
// survives marks code whose correctness the vectors say nothing about, which
// passing tests alone cannot reveal.
//
// Survivors then face a second oracle: satellite.js on every deep-space object
// in the snapshot plus synthetic resonant orbits. Whatever survives both is
// either equivalent to the original or a threshold no test orbit lands on.
//
//   npx tsx scripts/mutation-check.ts

import { build, type Plugin } from 'esbuild';
import * as satellite from 'satellite.js';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadCatalog, syntheticDeepSpaceOrbits } from '../tests/support/catalog';
import { loadVectorCases, type VectorCase } from '../tests/support/vectors';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['src/sgp4/deepspace.ts', 'src/sgp4/propagate.ts', 'src/sgp4/init.ts'];
const POSITION_TOLERANCE_KM = 1e-6;
const VELOCITY_TOLERANCE_KM_S = 1e-8;
const EXPECTED_CODES = '1,1,6,6,4,3,6';

interface Mutant {
  file: string;
  line: number;
  kind: 'literal' | 'operator';
  original: string;
  replacement: string;
  start: number;
  end: number;
}

/** Blanks comments so nothing inside them is mistaken for code. */
function maskComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '));
}

function findMutants(file: string, source: string): Mutant[] {
  const code = maskComments(source);
  const lineOf = (offset: number): number => code.slice(0, offset).split('\n').length;
  const mutants: Mutant[] = [];

  for (const m of code.matchAll(/(?<![\w.])\d+\.?\d*(?:e[+-]?\d+)?(?![\w.])/gi)) {
    const prefix = code.slice(code.lastIndexOf('\n', m.index) + 1, m.index);
    // Array indices and offsets in the output buffer are structure, not physics.
    if (/\[$/.test(prefix) || /^import/.test(prefix.trim()) || /offset \+ $/.test(prefix)) continue;
    const value = Number(m[0]);
    const replacement = value === 0 ? '1' : String(value * 1.001);
    mutants.push({
      file,
      line: lineOf(m.index),
      kind: 'literal',
      original: m[0],
      replacement,
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  const swaps: Record<string, string> = { ' + ': ' - ', ' - ': ' + ', ' * ': ' / ', ' / ': ' * ' };
  for (const m of code.matchAll(/ [-+*/] /g)) {
    mutants.push({
      file,
      line: lineOf(m.index),
      kind: 'operator',
      original: m[0].trim(),
      replacement: (swaps[m[0]] as string).trim(),
      start: m.index + 1,
      end: m.index + 2,
    });
  }
  return mutants;
}

async function bundle(overrides: Map<string, string>): Promise<string> {
  const plugin: Plugin = {
    name: 'mutate',
    setup(b) {
      b.onLoad({ filter: /src\/sgp4\/.*\.ts$/ }, async (args) => {
        const contents = overrides.get(args.path) ?? (await readFile(args.path, 'utf8'));
        return { contents, loader: 'ts' };
      });
    },
  };
  const result = await build({
    entryPoints: [resolve(ROOT, 'src/sgp4/index.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'lib',
    logLevel: 'silent',
    plugins: [plugin],
  });
  return result.outputFiles[0]?.text ?? '';
}

const HARNESS = `
(function (cases) {
  const out = new Float64Array(6);
  const codes = [];
  for (const c of cases) {
    const sat = lib.sgp4init(lib.parseTle(c.line1, c.line2));
    if (sat.error !== 0) { codes.push(sat.error); continue; }
    for (const l of c.lines) {
      const code = lib.sgp4(sat, l.tsince, out, 0);
      if (code !== 0) return 'code ' + code + ' at ' + l.tsince;
      const dr = Math.hypot(out[0] - l.r[0], out[1] - l.r[1], out[2] - l.r[2]);
      const dv = Math.hypot(out[3] - l.v[0], out[4] - l.v[1], out[5] - l.v[2]);
      if (!(dr < ${POSITION_TOLERANCE_KM}) || !(dv < ${VELOCITY_TOLERANCE_KM_S})) return 'vector';
    }
    const stop = c.span[1], step = c.span[2];
    const last = c.lines.length ? c.lines[c.lines.length - 1].tsince : 0;
    let code = 0;
    for (let t = last + step; t <= stop && code === 0; t += step) code = lib.sgp4(sat, t, out, 0);
    if (code === 0 && last < stop) code = lib.sgp4(sat, stop, out, 0);
    if (code !== 0) codes.push(code);
  }
  return codes.join(',') === '${EXPECTED_CODES}' ? 'survived' : 'codes';
})
`;

function replay(code: string, cases: VectorCase[]): string {
  const context = vm.createContext({ Math, Float64Array });
  vm.runInContext(code, context, { timeout: 2000 });
  const run = vm.runInContext(HARNESS, context, { timeout: 2000 }) as (c: VectorCase[]) => string;
  context.cases = cases;
  context.run = run;
  try {
    return vm.runInContext('run(cases)', context, { timeout: 2000 }) as string;
  } catch {
    return 'hang or throw';
  }
}

interface OracleState {
  entry: unknown;
  tsince: number;
  r: [number, number, number];
  v: [number, number, number];
}

/** Reference states from satellite.js, computed once and replayed per mutant. */
function buildOracle(): OracleState[] {
  const catalog = loadCatalog();
  const deep = catalog.filter((e) => e.MEAN_MOTION < 6.4);
  const near = catalog.filter((e) => e.MEAN_MOTION >= 6.4).filter((_, i) => i % 50 === 0);
  const states: OracleState[] = [];
  for (const entry of [...deep, ...near, ...syntheticDeepSpaceOrbits()]) {
    const reference = satellite.json2satrec({
      ...entry,
      MEAN_MOTION_DOT: 0,
      MEAN_MOTION_DDOT: 0,
    } as unknown as satellite.OMMJsonObject);
    for (const tsince of [-1440, 720, 4320, 20160]) {
      const state = satellite.sgp4(reference, tsince);
      if (!state) continue;
      const { position: p, velocity: w } = state;
      states.push({ entry, tsince, r: [p.x, p.y, p.z], v: [w.x, w.y, w.z] });
    }
  }
  return states;
}

const ORACLE_HARNESS = `
(function (states) {
  const out = new Float64Array(6);
  for (const s of states) {
    const sat = lib.sgp4init(lib.ommToElements(s.entry));
    const code = lib.sgp4(sat, s.tsince, out, 0);
    if (code !== 0) return 'code ' + code;
    const dr = Math.hypot(out[0] - s.r[0], out[1] - s.r[1], out[2] - s.r[2]);
    const dv = Math.hypot(out[3] - s.v[0], out[4] - s.v[1], out[5] - s.v[2]);
    if (!(dr < 1e-4) || !(dv < 1e-6)) return 'oracle';
  }
  return 'survived';
})
`;

function replayOracle(code: string, states: OracleState[]): string {
  const context = vm.createContext({ Math, Float64Array, states });
  vm.runInContext(code, context, { timeout: 20000 });
  context.run = vm.runInContext(ORACLE_HARNESS, context, { timeout: 2000 });
  try {
    return vm.runInContext('run(states)', context, { timeout: 20000 }) as string;
  } catch {
    return 'hang or throw';
  }
}

const cases = loadVectorCases();
const oracle = buildOracle();
const oracleBaseline = replayOracle(await bundle(new Map()), oracle);
if (oracleBaseline !== 'survived') {
  throw new Error(`unmutated code disagrees with satellite.js: ${oracleBaseline}`);
}
const baseline = replay(await bundle(new Map()), cases);
if (baseline !== 'survived') throw new Error(`unmutated code fails the vectors: ${baseline}`);

const survivors: Mutant[] = [];
const residual: Mutant[] = [];
let total = 0;
const byFile: Record<string, { mutants: number; killed: number }> = {};

for (const file of TARGETS) {
  const path = resolve(ROOT, file);
  const source = await readFile(path, 'utf8');
  const mutants = findMutants(file, source);
  byFile[file] = { mutants: mutants.length, killed: 0 };
  for (const mutant of mutants) {
    total += 1;
    const mutated = source.slice(0, mutant.start) + mutant.replacement + source.slice(mutant.end);
    let verdict: string;
    try {
      verdict = replay(await bundle(new Map([[path, mutated]])), cases);
    } catch {
      verdict = 'does not compile';
    }
    if (verdict === 'survived') {
      survivors.push(mutant);
      if (replayOracle(await bundle(new Map([[path, mutated]])), oracle) === 'survived') {
        residual.push(mutant);
      }
    } else {
      (byFile[file] as { killed: number }).killed += 1;
    }
  }
  console.log(file, byFile[file]);
}

const killed = total - survivors.length;
const killedByOracle = survivors.length - residual.length;
const report = {
  command: 'npx tsx scripts/mutation-check.ts',
  note:
    'Literals scaled by 1.001 (0 becomes 1), and + - * / swapped. "killed" means the published ' +
    'vectors (1e-6 km, 1e-8 km/s) or expected error codes caught the change. "killedByOracle" ' +
    'counts survivors then caught by satellite.js over deep-space catalog objects and synthetic ' +
    'resonant orbits (1e-4 km, 1e-6 km/s).',
  mutants: total,
  killed,
  killRate: killed / total,
  killedByOracle,
  oracleStates: oracle.length,
  residual: residual.length,
  byFile,
  residualMutants: residual.map(({ file, line, kind, original, replacement }) => ({
    file,
    line,
    kind,
    original,
    replacement,
  })),
};
await writeFile(
  resolve(ROOT, 'results/sgp4-mutation.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  `${killed}/${total} killed by vectors (${((100 * killed) / total).toFixed(1)}%), ` +
    `${killedByOracle} more by the oracle, ${residual.length} residual`,
);
