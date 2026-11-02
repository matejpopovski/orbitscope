import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseTle, sgp4, sgp4init } from '../../src/sgp4';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');

interface PublishedLine {
  tsince: number;
  r: [number, number, number];
  v: [number, number, number];
}

export interface VectorCase {
  satnum: number;
  line1: string;
  line2: string;
  comment: string;
  /** Requested span from the TLE file: start, stop, step in minutes. */
  span: [number, number, number];
  lines: PublishedLine[];
}

/** Pairs each TLE in SGP4-VER.TLE with its block of output in tcppver.out. */
export function loadVectorCases(): VectorCase[] {
  const tleLines = fixture('SGP4-VER.TLE').split(/\r?\n/);
  const pairs: Omit<VectorCase, 'lines'>[] = [];
  let comment = '';
  for (let i = 0; i < tleLines.length; i += 1) {
    const line = tleLines[i] as string;
    if (line.startsWith('#')) {
      comment = line.replace(/^#\s*/, '').trim();
    } else if (line.startsWith('1 ')) {
      const line2 = tleLines[i + 1] as string;
      i += 1;
      const span = line2.slice(69).trim().split(/\s+/).map(Number) as [number, number, number];
      pairs.push({
        satnum: Number.parseInt(line.slice(2, 7), 10),
        line1: line,
        line2,
        comment,
        span,
      });
    }
  }

  const blocks: { satnum: number; lines: PublishedLine[] }[] = [];
  let current: PublishedLine[] = [];
  for (const raw of fixture('tcppver.out').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.endsWith('xx')) {
      current = [];
      blocks.push({ satnum: Number.parseInt(line, 10), lines: current });
    } else if (line.length > 0) {
      const n = line.split(/\s+/).map(Number);
      current.push({
        tsince: n[0] as number,
        r: [n[1] as number, n[2] as number, n[3] as number],
        v: [n[4] as number, n[5] as number, n[6] as number],
      });
    }
  }

  // Paired by position: a catalog number can legitimately appear more than once.
  return pairs.map((pair, i) => {
    const block = blocks[i];
    if (block?.satnum !== pair.satnum) {
      throw new Error(`TLE ${pair.satnum} and output block ${block?.satnum} are out of step`);
    }
    return { ...pair, lines: block.lines };
  });
}

export interface CaseResult {
  satnum: number;
  comment: string;
  deepSpace: boolean;
  points: number;
  maxPositionErrorKm: number;
  maxVelocityErrorKmS: number;
  /** Code from `sgp4init`. Non-zero means the elements fail at epoch. */
  initError: number;
  /** Code from the first step past the last published line, 0 if none. */
  terminalError: number;
}

/**
 * Replays one case. Position error is the Euclidean distance to the published
 * vector, so its floor is the published rounding: 1e-8 km per axis.
 *
 * A case that fails at epoch has no real vectors. The reference still prints a
 * line for it, but only because its output arrays still hold the previous
 * satellite's last state, so that line is not compared.
 */
export function runCase(testCase: VectorCase): CaseResult {
  const sat = sgp4init(parseTle(testCase.line1, testCase.line2));
  const out = new Float64Array(6);
  if (sat.error !== 0) {
    return {
      satnum: testCase.satnum,
      comment: testCase.comment,
      deepSpace: sat.deep,
      points: 0,
      maxPositionErrorKm: 0,
      maxVelocityErrorKmS: 0,
      initError: sat.error,
      terminalError: sat.error,
    };
  }
  let maxR = 0;
  let maxV = 0;

  for (const line of testCase.lines) {
    const code = sgp4(sat, line.tsince, out, 0);
    if (code !== 0) {
      throw new Error(`satellite ${testCase.satnum} failed with code ${code} at ${line.tsince}`);
    }
    maxR = Math.max(
      maxR,
      Math.hypot(
        (out[0] as number) - line.r[0],
        (out[1] as number) - line.r[1],
        (out[2] as number) - line.r[2],
      ),
    );
    maxV = Math.max(
      maxV,
      Math.hypot(
        (out[3] as number) - line.v[0],
        (out[4] as number) - line.v[1],
        (out[5] as number) - line.v[2],
      ),
    );
  }

  // The reference stops printing at the first error, so the code that ended a
  // block has to be found by stepping on from the last published time.
  const [, stop, step] = testCase.span;
  const last = testCase.lines.at(-1)?.tsince ?? 0;
  let terminalError = 0;
  for (let t = last + step; t <= stop && terminalError === 0; t += step) {
    terminalError = sgp4(sat, t, out, 0);
  }
  if (terminalError === 0 && last < stop) {
    terminalError = sgp4(sat, stop, out, 0);
  }

  return {
    satnum: testCase.satnum,
    comment: testCase.comment,
    deepSpace: sat.deep,
    points: testCase.lines.length,
    maxPositionErrorKm: maxR,
    maxVelocityErrorKmS: maxV,
    initError: 0,
    terminalError,
  };
}
