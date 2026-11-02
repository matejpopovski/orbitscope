import * as satellite from 'satellite.js';
import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from '../src/catalog/snapshot';
import { minutesSinceEpoch, ommToElements, sgp4, sgp4init } from '../src/sgp4';
import { jdFromUnixMs } from '../src/astro/time';
import {
  loadCatalog,
  SNAPSHOT_JD,
  SNAPSHOT_TIME_MS,
  syntheticDeepSpaceOrbits,
} from './support/catalog';

// satellite.js is a development dependency, used only as an independent
// implementation to compare against. bundle.test.ts keeps it out of the build.
const referenceFor = (entry: CatalogEntry): satellite.SatRec =>
  satellite.json2satrec({
    ...entry,
    MEAN_MOTION_DOT: 0,
    MEAN_MOTION_DDOT: 0,
  } as unknown as satellite.OMMJsonObject);

/** Largest position difference in km across the catalog at one time offset. */
export function compareCatalog(
  catalog: CatalogEntry[],
  offsetMinutes: number,
): { worstKm: number; compared: number; disagreements: number } {
  const out = new Float64Array(6);
  let worstKm = 0;
  let compared = 0;
  let disagreements = 0;
  for (const entry of catalog) {
    const sat = sgp4init(ommToElements(entry));
    const tsince = minutesSinceEpoch(sat, SNAPSHOT_JD.jd, SNAPSHOT_JD.frac) + offsetMinutes;
    const code = sgp4(sat, tsince, out, 0);
    const state = satellite.sgp4(referenceFor(entry), tsince);
    if ((code === 0) !== (state !== null)) {
      disagreements += 1;
      continue;
    }
    if (code !== 0 || !state) continue;
    compared += 1;
    worstKm = Math.max(
      worstKm,
      Math.hypot(
        (out[0] as number) - state.position.x,
        (out[1] as number) - state.position.y,
        (out[2] as number) - state.position.z,
      ),
    );
  }
  return { worstKm, compared, disagreements };
}

describe('agreement with satellite.js on the shipped catalog', () => {
  const catalog = loadCatalog();

  it('resolves wall-clock time to the same instant', () => {
    // Everything above works in minutes from epoch. This goes through dates, so
    // an error in minutesSinceEpoch cannot hide by appearing on both sides.
    const out = new Float64Array(6);
    const ms = SNAPSHOT_TIME_MS + 86_400_000 / 3;
    const { jd, frac } = jdFromUnixMs(ms);
    let worst = 0;
    for (const entry of catalog.filter((_, i) => i % 20 === 0)) {
      const sat = sgp4init(ommToElements(entry));
      const state = satellite.propagate(referenceFor(entry), new Date(ms));
      if (sgp4(sat, minutesSinceEpoch(sat, jd, frac), out, 0) !== 0 || !state) continue;
      worst = Math.max(
        worst,
        Math.hypot(
          (out[0] as number) - state.position.x,
          (out[1] as number) - state.position.y,
          (out[2] as number) - state.position.z,
        ),
      );
    }
    // Absolute times pick up satellite.js rounding its epoch to the millisecond,
    // up to 8 m at orbital speed, so this bound is looser than the ones below.
    expect(worst).toBeLessThan(0.02);
  }, 60_000);

  it.each([
    ['at the snapshot time', 0],
    ['one day ahead', 1440],
    ['three days ahead', 4320],
    ['one day behind', -1440],
  ])(
    'matches %s',
    (_, offsetMinutes) => {
      const { worstKm, compared, disagreements } = compareCatalog(catalog, offsetMinutes);
      expect(disagreements).toBe(0);
      expect(compared).toBeGreaterThan(catalog.length * 0.99);
      expect(worstKm).toBeLessThan(1e-3);
    },
    60_000,
  );

  it('matches on eccentric resonant orbits the vectors do not reach', () => {
    const { worstKm, compared, disagreements } = compareCatalog(syntheticDeepSpaceOrbits(), 4320);
    expect(disagreements).toBe(0);
    expect(compared).toBeGreaterThan(0);
    expect(worstKm).toBeLessThan(1e-3);
  }, 60_000);
});
