import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compactCatalog, FIELDS, MAX_SNAPSHOT_BYTES } from '../scripts/fetch-snapshot.mjs';
import { apsides, CATEGORIES, classify } from '../src/catalog/classify';
import { decodeSnapshot, type CatalogEntry, type Snapshot } from '../src/catalog/snapshot';
import { ommToElements, sgp4init } from '../src/sgp4';

const manifest = JSON.parse(readFileSync('public/data/manifest.json', 'utf8')) as {
  file: string;
  objects: number;
};
const snapshotText = readFileSync(`public/data/${manifest.file}`, 'utf8');
const snapshot = JSON.parse(snapshotText) as Snapshot;

const record = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  OBJECT_NAME: 'TEST',
  OBJECT_ID: '2026-001A',
  EPOCH: '2026-11-01T20:01:28.068960',
  MEAN_MOTION: 15.5,
  ECCENTRICITY: 0.001,
  INCLINATION: 51.6,
  RA_OF_ASC_NODE: 10,
  ARG_OF_PERICENTER: 20,
  MEAN_ANOMALY: 30,
  BSTAR: 0.0001,
  NORAD_CAT_ID: 25544,
  ...overrides,
});

describe('snapshot compaction', () => {
  it('passes element values through without rounding', () => {
    const { rows } = compactCatalog([record({ MEAN_MOTION: 15.49817123 })], 'x');
    expect(rows[0]?.[FIELDS.indexOf('MEAN_MOTION')]).toBe(15.49817123);
  });

  it('keeps catalog numbers a TLE cannot carry', () => {
    const { rows } = compactCatalog([record({ NORAD_CAT_ID: 101228 })], 'x');
    expect(rows[0]?.[0]).toBe(101228);
  });

  it('drops duplicates and malformed records rather than failing the refresh', () => {
    const result = compactCatalog(
      [
        record(),
        record(),
        record({ NORAD_CAT_ID: 2, BSTAR: null }),
        record({ NORAD_CAT_ID: 3, EPOCH: 'nope' }),
      ],
      'x',
    );
    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toBe(3);
  });

  it('rejects a body that is not an array', () => {
    expect(() => compactCatalog({ error: 'x' }, 'x')).toThrow(/array/);
  });
});

describe('committed snapshot', () => {
  const entries = decodeSnapshot(snapshot);

  it('is under the size limit and matches its manifest', () => {
    expect(Buffer.byteLength(snapshotText)).toBeLessThan(MAX_SNAPSHOT_BYTES);
    expect(entries).toHaveLength(manifest.objects);
  });

  it('names its upstream sources, which the redistribution approval requires', () => {
    expect(snapshot.attribution).toMatch(/CelesTrak/);
    expect(snapshot.attribution).toMatch(/Space-Track/);
  });

  it('initialises every object it ships', () => {
    const failed = entries.filter((e) => sgp4init(ommToElements(e)).error !== 0);
    expect(failed.map((e) => e.OBJECT_NAME)).toEqual([]);
  });

  it('refuses a snapshot from an unknown schema', () => {
    expect(() => decodeSnapshot({ ...snapshot, schema: 99 })).toThrow(/schema/);
  });

  it('refuses a snapshot missing a column', () => {
    const fields = snapshot.fields.filter((f) => f !== 'BSTAR');
    expect(() => decodeSnapshot({ ...snapshot, fields })).toThrow(/BSTAR/);
  });
});

describe('classification', () => {
  const entry = (name: string, meanMotion: number, ecc: number): CatalogEntry =>
    ({ OBJECT_NAME: name, MEAN_MOTION: meanMotion, ECCENTRICITY: ecc }) as CatalogEntry;
  const id = (e: CatalogEntry): string | undefined => CATEGORIES[classify(e)]?.id;

  it('computes the ISS altitude from mean elements', () => {
    const { apogeeKm, perigeeKm } = apsides(15.5, 0.0005);
    expect(perigeeKm).toBeGreaterThan(400);
    expect(apogeeKm).toBeLessThan(430);
  });

  it.each([
    ['STARLINK-1007', 15.06, 0.0001, 'starlink'],
    ['ONEWEB-0012', 13.1, 0.0002, 'megaconstellation'],
    ['GPS BIIR-2  (PRN 13)', 2.0, 0.01, 'gnss'],
    ['ISS (ZARYA)', 15.5, 0.0005, 'leo'],
    ['INTELSAT 901', 1.0027, 0.0002, 'geo'],
    ['MOLNIYA 1-93', 2.0, 0.7, 'heo'],
    ['O3B MPOWER', 5.0, 0.0001, 'meo'],
  ])('files %s', (name, motion, ecc, expected) => {
    expect(id(entry(name, motion, ecc))).toBe(expected);
  });
});
