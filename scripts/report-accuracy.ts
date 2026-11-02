// Regenerates the accuracy figures quoted in the README.
//
//   npx tsx scripts/report-accuracy.ts
//
// Writes results/sgp4-vectors.json, results/crosscheck.json and
// results/interpolation.json.

import { writeFileSync } from 'node:fs';
import * as satellite from 'satellite.js';
import { CATEGORIES, classify } from '../src/catalog/classify';
import { hermite } from '../src/engine/hermite';
import { minutesSinceEpoch, ommToElements, sgp4, sgp4init, type Satrec } from '../src/sgp4';
import { loadCatalog, SNAPSHOT_JD, syntheticDeepSpaceOrbits } from '../tests/support/catalog';
import { loadVectorCases, runCase } from '../tests/support/vectors';

const write = (name: string, value: unknown): void =>
  writeFileSync(`results/${name}.json`, `${JSON.stringify(value, null, 2)}\n`);

const catalog = loadCatalog();

const vectors = loadVectorCases().map(runCase);
write('sgp4-vectors', {
  command: 'npx tsx scripts/report-accuracy.ts',
  reference:
    'Vallado, Crawford, Hujsak, Kelso, "Revisiting Spacetrack Report #3", AIAA 2006-6753: SGP4-VER.TLE and tcppver.out',
  satellites: vectors.length,
  comparedPoints: vectors.reduce((sum, v) => sum + v.points, 0),
  deepSpaceSatellites: vectors.filter((v) => v.deepSpace).length,
  maxPositionErrorKm: Math.max(...vectors.map((v) => v.maxPositionErrorKm)),
  maxVelocityErrorKmS: Math.max(...vectors.map((v) => v.maxVelocityErrorKmS)),
  errorCodes: vectors.map((v) => v.terminalError).filter((code) => code !== 0),
  perSatellite: vectors,
});

function crosscheck(
  entries: typeof catalog,
  offsetMinutes: number,
): { objects: number; worstKm: number; meanKm: number } {
  const out = new Float64Array(6);
  let worstKm = 0;
  let sum = 0;
  let objects = 0;
  for (const entry of entries) {
    const sat = sgp4init(ommToElements(entry));
    const tsince = minutesSinceEpoch(sat, SNAPSHOT_JD.jd, SNAPSHOT_JD.frac) + offsetMinutes;
    const reference = satellite.json2satrec({
      ...entry,
      MEAN_MOTION_DOT: 0,
      MEAN_MOTION_DDOT: 0,
    } as unknown as satellite.OMMJsonObject);
    const state = satellite.sgp4(reference, tsince);
    if (sgp4(sat, tsince, out, 0) !== 0 || !state) continue;
    const d = Math.hypot(
      (out[0] as number) - state.position.x,
      (out[1] as number) - state.position.y,
      (out[2] as number) - state.position.z,
    );
    worstKm = Math.max(worstKm, d);
    sum += d;
    objects += 1;
  }
  return { objects, worstKm, meanKm: sum / objects };
}

/**
 * The cost of implementing only improved mode. Both sides are satellite.js, so
 * this isolates the mode from any difference between implementations.
 */
function modeDifference(offsetMinutes: number): {
  worstKm: number;
  meanKm: number;
  over1Km: number;
} {
  let worstKm = 0;
  let sum = 0;
  let count = 0;
  let over1Km = 0;
  for (const entry of catalog) {
    const omm = {
      ...entry,
      MEAN_MOTION_DOT: 0,
      MEAN_MOTION_DDOT: 0,
    } as unknown as satellite.OMMJsonObject;
    const improved = satellite.json2satrec(omm, 'i');
    const afspc = satellite.json2satrec(omm, 'a');
    const sat = sgp4init(ommToElements(entry));
    const tsince = minutesSinceEpoch(sat, SNAPSHOT_JD.jd, SNAPSHOT_JD.frac) + offsetMinutes;
    const a = satellite.sgp4(improved, tsince);
    const b = satellite.sgp4(afspc, tsince);
    if (!a || !b) continue;
    const d = Math.hypot(
      a.position.x - b.position.x,
      a.position.y - b.position.y,
      a.position.z - b.position.z,
    );
    worstKm = Math.max(worstKm, d);
    sum += d;
    count += 1;
    if (d > 1) over1Km += 1;
  }
  return { worstKm, meanKm: sum / count, over1Km };
}

write('crosscheck', {
  command: 'npx tsx scripts/report-accuracy.ts',
  reference: 'satellite.js 7.1.0, same tsince for both implementations',
  snapshotObjects: catalog.length,
  offsetsMinutes: Object.fromEntries(
    [0, 1440, 4320, -1440].map((minutes) => [minutes, crosscheck(catalog, minutes)]),
  ),
  syntheticResonantOrbits: crosscheck(syntheticDeepSpaceOrbits(), 4320),
  improvedVersusAfspcMode: { atSnapshot: modeDifference(0), threeDaysAhead: modeDifference(4320) },
});

/** Same comparison for straight-line interpolation, the option Hermite replaced. */
function linearError(sat: Satrec, startMin: number, seconds: number): number | null {
  const a = new Float64Array(6);
  const b = new Float64Array(6);
  const exact = new Float64Array(6);
  const minutes = seconds / 60;
  if (sgp4(sat, startMin, a, 0) !== 0 || sgp4(sat, startMin + minutes, b, 0) !== 0) return null;
  if (sgp4(sat, startMin + minutes / 2, exact, 0) !== 0) return null;
  return Math.hypot(
    ((a[0] as number) + (b[0] as number)) / 2 - (exact[0] as number),
    ((a[1] as number) + (b[1] as number)) / 2 - (exact[1] as number),
    ((a[2] as number) + (b[2] as number)) / 2 - (exact[2] as number),
  );
}

function interpolationError(sat: Satrec, startMin: number, seconds: number): number | null {
  const a = new Float64Array(6);
  const b = new Float64Array(6);
  const exact = new Float64Array(6);
  const minutes = seconds / 60;
  if (sgp4(sat, startMin, a, 0) !== 0 || sgp4(sat, startMin + minutes, b, 0) !== 0) return null;
  let worst = 0;
  for (let i = 1; i < 8; i += 1) {
    const u = i / 8;
    if (sgp4(sat, startMin + u * minutes, exact, 0) !== 0) return null;
    let sum = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      sum +=
        (hermite(
          a[axis] as number,
          a[axis + 3] as number,
          b[axis] as number,
          b[axis + 3] as number,
          u,
          seconds,
        ) -
          (exact[axis] as number)) **
        2;
    }
    worst = Math.max(worst, Math.sqrt(sum));
  }
  return worst;
}

/**
 * How far SGP4's reported velocity is from the time derivative of its own
 * position. The theory drops terms from the velocity expressions, and this gap
 * sets the error floor of any interpolant that trusts those velocities.
 */
function velocityConsistency(): {
  medianKmS: number;
  p99KmS: number;
  worstKmS: number;
  worstObject: string;
} {
  const before = new Float64Array(6);
  const after = new Float64Array(6);
  const middle = new Float64Array(6);
  const halfStepSeconds = 0.05;
  const halfStepMinutes = halfStepSeconds / 60;
  const gaps: number[] = [];
  let worst = 0;
  let worstObject = '';
  for (const entry of catalog) {
    const sat = sgp4init(ommToElements(entry));
    const t = minutesSinceEpoch(sat, SNAPSHOT_JD.jd, SNAPSHOT_JD.frac);
    if (
      sgp4(sat, t - halfStepMinutes, before, 0) !== 0 ||
      sgp4(sat, t + halfStepMinutes, after, 0) !== 0 ||
      sgp4(sat, t, middle, 0) !== 0
    ) {
      continue;
    }
    const scale = 1 / (2 * halfStepSeconds);
    const gap = Math.hypot(
      ((after[0] as number) - (before[0] as number)) * scale - (middle[3] as number),
      ((after[1] as number) - (before[1] as number)) * scale - (middle[4] as number),
      ((after[2] as number) - (before[2] as number)) * scale - (middle[5] as number),
    );
    gaps.push(gap);
    if (gap > worst) {
      worst = gap;
      worstObject = entry.OBJECT_NAME;
    }
  }
  gaps.sort((x, y) => x - y);
  return {
    medianKmS: percentile(gaps, 0.5),
    p99KmS: percentile(gaps, 0.99),
    worstKmS: worst,
    worstObject,
  };
}

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;

// Checked at several phases of the orbit: the error peaks near perigee, so a
// single start time would flatter eccentric orbits.
const phases = [0, 13, 29, 47, 61, 83, 101, 127, 149, 173, 211, 241];
const intervals = [1, 5, 15, 30, 60, 120, 240, 600];
write('interpolation', {
  command: 'npx tsx scripts/report-accuracy.ts',
  note: 'Worst error per object between SGP4 and the cubic Hermite keyframe interpolant, over 12 start phases and 7 interior points of each interval.',
  objects: catalog.length,
  velocityConsistency: velocityConsistency(),
  results: intervals.map((seconds) => {
    const errors: number[] = [];
    const linear: number[] = [];
    const worstByCategory: Record<string, number> = {};
    for (const entry of catalog) {
      const sat = sgp4init(ommToElements(entry));
      const start = minutesSinceEpoch(sat, SNAPSHOT_JD.jd, SNAPSHOT_JD.frac);
      let worst = 0;
      for (const phase of phases) {
        worst = Math.max(worst, interpolationError(sat, start + phase, seconds) ?? 0);
      }
      errors.push(worst);
      linear.push(linearError(sat, start, seconds) ?? 0);
      const id = CATEGORIES[classify(entry)]?.id as string;
      worstByCategory[id] = Math.max(worstByCategory[id] ?? 0, worst);
    }
    errors.sort((x, y) => x - y);
    linear.sort((x, y) => x - y);
    return {
      intervalSeconds: seconds,
      medianKm: percentile(errors, 0.5),
      p99Km: percentile(errors, 0.99),
      worstKm: errors.at(-1),
      linearMedianKm: percentile(linear, 0.5),
      worstByCategory,
    };
  }),
});
console.log('wrote results/sgp4-vectors.json, crosscheck.json, interpolation.json');
