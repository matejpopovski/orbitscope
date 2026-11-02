import { describe, expect, it } from 'vitest';
import { hermite } from '../src/engine/hermite';
import { minutesSinceEpoch, ommToElements, sgp4, sgp4init, type Satrec } from '../src/sgp4';
import { loadCatalog, SNAPSHOT_JD } from './support/catalog';

const catalog = loadCatalog();

/** Worst gap between SGP4 and the interpolant over one keyframe interval. */
function interpolationError(sat: Satrec, startMin: number, intervalSeconds: number): number {
  const a = new Float64Array(6);
  const b = new Float64Array(6);
  const exact = new Float64Array(6);
  const intervalMin = intervalSeconds / 60;
  if (sgp4(sat, startMin, a, 0) !== 0 || sgp4(sat, startMin + intervalMin, b, 0) !== 0) return 0;
  let worst = 0;
  for (const u of [0.125, 0.25, 0.5, 0.75, 0.875]) {
    if (sgp4(sat, startMin + u * intervalMin, exact, 0) !== 0) continue;
    let sum = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = hermite(
        a[axis] as number,
        a[axis + 3] as number,
        b[axis] as number,
        b[axis + 3] as number,
        u,
        intervalSeconds,
      );
      sum += (value - (exact[axis] as number)) ** 2;
    }
    worst = Math.max(worst, Math.sqrt(sum));
  }
  return worst;
}

describe('hermite', () => {
  it('passes through both keyframes', () => {
    expect(hermite(1, 9, 2, 9, 0, 10)).toBe(1);
    expect(hermite(1, 9, 2, 9, 1, 10)).toBe(2);
  });

  it('reproduces a cubic exactly', () => {
    const f = (t: number): number => t * t * t - 2 * t + 1;
    const df = (t: number): number => 3 * t * t - 2;
    const h = 4;
    expect(hermite(f(0), df(0), f(h), df(h), 0.25, h)).toBeCloseTo(f(1), 10);
  });
});

describe('keyframe interpolation on the shipped catalog', () => {
  it('stays under 100 m at the longest interval the scheduler uses', () => {
    let worst = 0;
    for (const entry of catalog) {
      const sat = sgp4init(ommToElements(entry));
      const start = minutesSinceEpoch(sat, SNAPSHOT_JD.jd, SNAPSHOT_JD.frac);
      worst = Math.max(worst, interpolationError(sat, start, 120));
    }
    expect(worst).toBeLessThan(0.1);
  }, 60_000);
});
