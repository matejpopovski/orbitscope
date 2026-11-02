import { describe, expect, it } from 'vitest';
import { minutesSinceEpoch, parseTle, periodMinutes, sgp4, sgp4init } from '../src/sgp4';
import { loadVectorCases, runCase } from './support/vectors';

const cases = loadVectorCases();

describe('published Vallado verification vectors', () => {
  it('loads the whole published set', () => {
    expect(cases).toHaveLength(33);
    expect(cases.reduce((sum, c) => sum + c.lines.length, 0)).toBe(667);
  });

  it('treats the line printed for 33334 as stale output, not a vector', () => {
    const index = cases.findIndex((c) => c.satnum === 33334);
    const stale = cases[index]?.lines[0];
    const previous = cases[index - 1]?.lines.at(-1);
    expect(stale?.r).toEqual(previous?.r);
    expect(stale?.v).toEqual(previous?.v);
    expect(runCase(cases[index] as (typeof cases)[number]).initError).toBe(3);
  });

  it.each(cases.map((c) => [c.satnum, c] as const))('matches satellite %i', (_, testCase) => {
    const result = runCase(testCase);
    // Published output carries 8 decimals in km and 9 in km/s. The bounds allow
    // that rounding plus the last digits of platform math-library differences.
    expect(result.maxPositionErrorKm).toBeLessThan(1e-6);
    expect(result.maxVelocityErrorKmS).toBeLessThan(1e-8);
  });

  it('stops with the error sequence the reference reports', () => {
    const codes = cases.map((c) => runCase(c).terminalError).filter((code) => code !== 0);
    expect(codes).toEqual([1, 1, 6, 6, 4, 3, 6]);
  });
});

describe('epoch arithmetic', () => {
  const first = cases[0];
  if (!first) throw new Error('fixture is empty');
  const sat = sgp4init(parseTle(first.line1, first.line2));

  it('counts zero minutes at the epoch itself', () => {
    expect(minutesSinceEpoch(sat, sat.jdEpoch, sat.jdEpochFrac)).toBe(0);
  });

  it('counts forwards and backwards in minutes', () => {
    expect(minutesSinceEpoch(sat, sat.jdEpoch + 1, sat.jdEpochFrac)).toBeCloseTo(1440, 9);
    expect(minutesSinceEpoch(sat, sat.jdEpoch, sat.jdEpochFrac - 1 / 1440)).toBeCloseTo(-1, 9);
  });

  it('reads the epoch of 00005 as 2000 day 179.78495062', () => {
    expect(sat.jdEpoch + sat.jdEpochFrac).toBeCloseTo(2451723.28495062, 7);
  });

  it('derives the orbital period from the mean motion', () => {
    // 10.82419157 rev/day is about 133 minutes per revolution.
    expect(periodMinutes(sat)).toBeCloseTo(1440 / 10.82419157, 0);
  });
});

describe('propagation state', () => {
  const geo = cases.find((c) => c.satnum === 23599);

  it('gives the same deep-space answer whichever way a time is reached', () => {
    if (!geo) throw new Error('fixture missing resonant case');
    const elements = parseTle(geo.line1, geo.line2);
    const direct = new Float64Array(6);
    const stepped = new Float64Array(6);

    sgp4(sgp4init(elements), 2880, direct, 0);

    const sat = sgp4init(elements);
    for (const t of [10000, -5000, 720, 5760, 2880]) {
      sgp4(sat, t, stepped, 0);
    }
    expect(Array.from(stepped)).toEqual(Array.from(direct));
  });
});
