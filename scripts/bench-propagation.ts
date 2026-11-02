// Single-threaded SGP4 throughput under Node on the shipped catalog. Browser
// numbers, including workers, come from e2e/measure.spec.ts instead.
//
//   npx tsx scripts/bench-propagation.ts [--write]

import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { minutesSinceEpoch, ommToElements, sgp4, sgp4init } from '../src/sgp4';
import { loadCatalog, SNAPSHOT_JD } from '../tests/support/catalog';

const catalog = loadCatalog();
const initStart = performance.now();
const sats = catalog.map((entry) => sgp4init(ommToElements(entry)));
const initMs = performance.now() - initStart;
const near = sats.filter((s) => !s.deep);
const deep = sats.filter((s) => s.deep);

function measure(group: typeof sats): { microsecondsPerCall: number; msPerSweep: number } {
  const offsets = group.map((s) => minutesSinceEpoch(s, SNAPSHOT_JD.jd, SNAPSHOT_JD.frac));
  const out = new Float64Array(6);
  const sweep = (minute: number): void => {
    for (let i = 0; i < group.length; i += 1) {
      sgp4(group[i] as (typeof group)[number], (offsets[i] as number) + minute, out, 0);
    }
  };
  for (let warm = 0; warm < 40; warm += 1) sweep(warm);
  const samples: number[] = [];
  for (let run = 0; run < 200; run += 1) {
    const start = performance.now();
    sweep(40 + run * 0.5);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = samples[samples.length >> 1] as number;
  return { microsecondsPerCall: (median * 1000) / group.length, msPerSweep: median };
}

const report = {
  command: 'npx tsx scripts/bench-propagation.ts --write',
  machine: `${cpus()[0]?.model} under Node ${process.version}, single thread, machine shared with other jobs`,
  objects: sats.length,
  initMs,
  nearEarth: { objects: near.length, ...measure(near) },
  deepSpace: { objects: deep.length, ...measure(deep) },
  wholeCatalog: measure(sats),
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--write')) {
  writeFileSync('results/propagation-node.json', `${JSON.stringify(report, null, 2)}\n`);
}
