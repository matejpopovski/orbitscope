import { describe, expect, it } from 'vitest';
import { geodeticToEcef, lookAngles, temeToEcef } from '../src/astro/frames';
import { gstime, jdFromUnixMs } from '../src/astro/time';
import { predictPasses } from '../src/passes/predictor';
import { minutesSinceEpoch, ommToElements, sgp4, sgp4init, type Satrec } from '../src/sgp4';
import { loadCatalog, SNAPSHOT_TIME_MS } from './support/catalog';

const catalog = loadCatalog();
const byName = (pattern: RegExp): Satrec => {
  const entry = catalog.find((e) => pattern.test(e.OBJECT_NAME));
  if (!entry) throw new Error(`no ${pattern} in the snapshot`);
  return sgp4init(ommToElements(entry));
};

const observer = { latDeg: 43.07, lonDeg: -89.4, altKm: 0.27 };
const site = geodeticToEcef(observer);
const buffer = new Float64Array(6);

function elevation(sat: Satrec, ms: number): number {
  const { jd, frac } = jdFromUnixMs(ms);
  sgp4(sat, minutesSinceEpoch(sat, jd, frac), buffer, 0);
  const r = [buffer[0], buffer[1], buffer[2]] as [number, number, number];
  return lookAngles(observer, site, temeToEcef(r, gstime(jd + frac))).elevationDeg;
}

/** The exhaustive answer: one-second sampling, independent of the search logic. */
function bruteForce(sat: Satrec, startMs: number, hours: number, mask: number): [number, number][] {
  const passes: [number, number][] = [];
  let up = elevation(sat, startMs) > mask;
  let rise = up ? startMs : 0;
  const end = startMs + hours * 3_600_000;
  for (let t = startMs + 1000; t <= end; t += 1000) {
    const now = elevation(sat, t) > mask;
    if (now && !up) rise = t;
    if (!now && up) passes.push([rise, t]);
    up = now;
  }
  if (up) passes.push([rise, end]);
  return passes;
}

describe('pass prediction against a one-second brute-force scan', () => {
  it.each([
    ['ISS', /^ISS \(ZARYA\)/, 0],
    ['a Starlink', /^STARLINK-/, 10],
    ['a near-polar Iridium', /^IRIDIUM/, 0],
    ['a GPS satellite', /^NAVSTAR/, 0],
  ])('finds every pass of %s at the same times', (_, pattern, mask) => {
    const sat = byName(pattern);
    const hours = 24;
    const expected = bruteForce(sat, SNAPSHOT_TIME_MS, hours, mask);
    const found = predictPasses(sat, observer, SNAPSHOT_TIME_MS, {
      horizonHours: hours,
      minElevationDeg: mask,
      maxPasses: 50,
    });
    expect(found).toHaveLength(expected.length);
    found.forEach((pass, i) => {
      const [rise, set] = expected[i] as [number, number];
      expect(Math.abs(pass.aosMs - rise)).toBeLessThanOrEqual(1500);
      expect(Math.abs(pass.losMs - set)).toBeLessThanOrEqual(1500);
    });
  });

  it('puts the rise and set exactly on the mask', () => {
    const sat = byName(/^ISS \(ZARYA\)/);
    const passes = predictPasses(sat, observer, SNAPSHOT_TIME_MS, { minElevationDeg: 5 });
    expect(passes.length).toBeGreaterThan(0);
    for (const pass of passes) {
      expect(elevation(sat, pass.aosMs)).toBeCloseTo(5, 1);
      expect(elevation(sat, pass.losMs)).toBeCloseTo(5, 1);
      expect(pass.maxElevationDeg).toBeGreaterThanOrEqual(5);
      expect(pass.tcaMs).toBeGreaterThan(pass.aosMs);
      expect(pass.tcaMs).toBeLessThan(pass.losMs);
    }
  });

  it('reports the true peak elevation', () => {
    const sat = byName(/^ISS \(ZARYA\)/);
    for (const pass of predictPasses(sat, observer, SNAPSHOT_TIME_MS)) {
      let peak = -90;
      for (let t = pass.aosMs; t <= pass.losMs; t += 500) {
        peak = Math.max(peak, elevation(sat, t));
      }
      expect(pass.maxElevationDeg).toBeGreaterThan(peak - 0.001);
    }
  });
});

describe('pass prediction edge cases', () => {
  it('catches a grazing pass shorter than the sweep step', () => {
    const sat = byName(/^ISS \(ZARYA\)/);
    const passes = predictPasses(sat, observer, SNAPSHOT_TIME_MS, { maxPasses: 30 });
    const first = passes[0];
    if (!first) throw new Error('expected a pass');
    // Set the mask a hair under this pass's peak, leaving only seconds above it.
    const mask = first.maxElevationDeg - 0.002;
    const graze = predictPasses(sat, observer, first.tcaMs - 600_000, {
      horizonHours: 0.4,
      minElevationDeg: mask,
    });
    expect(graze).toHaveLength(1);
    expect(
      (graze[0] as { losMs: number }).losMs - (graze[0] as { aosMs: number }).aosMs,
    ).toBeLessThan(30_000);
  });

  it('reports a geostationary satellite as one pass spanning the whole window', () => {
    const entry = catalog.find(
      (e) =>
        e.MEAN_MOTION > 1.0026 &&
        e.MEAN_MOTION < 1.0029 &&
        e.ECCENTRICITY < 0.001 &&
        e.INCLINATION < 0.1 &&
        elevation(sgp4init(ommToElements(e)), SNAPSHOT_TIME_MS) > 20,
    );
    if (!entry) throw new Error('no visible geostationary satellite in the snapshot');
    const passes = predictPasses(sgp4init(ommToElements(entry)), observer, SNAPSHOT_TIME_MS);
    expect(passes).toHaveLength(1);
    expect(passes[0]?.startsInProgress).toBe(true);
    expect(passes[0]?.endsInProgress).toBe(true);
  });

  it('returns nothing for a satellite that cannot rise', () => {
    const southern = { latDeg: 85, lonDeg: 0, altKm: 0 };
    const sat = byName(/^ISS \(ZARYA\)/);
    expect(predictPasses(sat, southern, SNAPSHOT_TIME_MS)).toEqual([]);
  });

  it('stops cleanly at the first propagation failure', () => {
    const sat = sgp4init(
      ommToElements({
        NORAD_CAT_ID: 1,
        EPOCH: '2026-11-01T00:00:00',
        MEAN_MOTION: 16.3,
        ECCENTRICITY: 0.0008,
        INCLINATION: 51.6,
        RA_OF_ASC_NODE: 0,
        ARG_OF_PERICENTER: 0,
        MEAN_ANOMALY: 0,
        BSTAR: 0.5,
      }),
    );
    expect(() =>
      predictPasses(sat, observer, SNAPSHOT_TIME_MS, { horizonHours: 240 }),
    ).not.toThrow();
  });
});
