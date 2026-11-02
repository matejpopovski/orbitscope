import { readFileSync } from 'node:fs';
import { decodeSnapshot, type CatalogEntry, type Snapshot } from '../../src/catalog/snapshot';
import { jdFromUnixMs, type JulianDate } from '../../src/astro/time';

const manifest = JSON.parse(readFileSync('public/data/manifest.json', 'utf8')) as {
  file: string;
  fetchedAt: string;
};

export const SNAPSHOT_TIME_MS = Date.parse(manifest.fetchedAt);
export const SNAPSHOT_JD: JulianDate = jdFromUnixMs(SNAPSHOT_TIME_MS);

export function loadCatalog(): CatalogEntry[] {
  return decodeSnapshot(
    JSON.parse(readFileSync(`public/data/${manifest.file}`, 'utf8')) as Snapshot,
  );
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Orbits the live catalog barely reaches: eccentric one-day and half-day
 * resonances, including elements either side of each eccentricity break in the
 * resonance polynomials. The vectors cannot constrain those terms because their
 * resonant cases sit at low or fixed eccentricity.
 */
export function syntheticDeepSpaceOrbits(): CatalogEntry[] {
  const random = mulberry32(20061753);
  const entries: CatalogEntry[] = [];
  const add = (name: string, meanMotion: number, eccentricity: number): void => {
    entries.push({
      NORAD_CAT_ID: 900000 + entries.length,
      OBJECT_NAME: name,
      OBJECT_ID: 'SYNTHETIC',
      EPOCH: '2026-11-01T12:00:00.000000',
      MEAN_MOTION: meanMotion,
      ECCENTRICITY: eccentricity,
      INCLINATION: 5 + random() * 170,
      RA_OF_ASC_NODE: random() * 360,
      ARG_OF_PERICENTER: random() * 360,
      MEAN_ANOMALY: random() * 360,
      BSTAR: 0.0001 * random(),
    });
  };
  for (let i = 0; i < 60; i += 1) {
    add('ONE-DAY', 1.0 + random() * 0.01, 0.01 + random() * 0.6);
    add('HALF-DAY', 2.0 + random() * 0.01, 0.5 + random() * 0.3);
    add('LONG-PERIOD', 0.5 + random() * 5, random() * 0.5);
  }
  for (const eccentricity of [0.5, 0.65, 0.7, 0.715]) {
    for (const delta of [-1e-4, 1e-4]) {
      add('BREAK', 2.005, eccentricity + delta);
    }
  }
  return entries;
}
