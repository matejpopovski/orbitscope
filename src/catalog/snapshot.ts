import type { OmmRecord } from '../sgp4';

export interface SnapshotManifest {
  file: string;
  fetchedAt: string;
  objects: number;
  bytes: number;
  sha256: string;
  source: string;
  attribution: string;
}

export interface Snapshot {
  schema: number;
  source: string;
  attribution: string;
  fetchedAt: string;
  fields: string[];
  rows: (string | number)[][];
}

export const SUPPORTED_SCHEMA = 1;

export interface CatalogEntry extends OmmRecord {
  OBJECT_NAME: string;
  OBJECT_ID: string;
}

/**
 * Rows are decoded by the field list the file carries, so a snapshot written by
 * a newer script fails loudly here instead of silently swapping two elements.
 */
export function decodeSnapshot(snapshot: Snapshot): CatalogEntry[] {
  if (snapshot.schema !== SUPPORTED_SCHEMA) {
    throw new Error(`unsupported snapshot schema ${snapshot.schema}`);
  }
  const index = new Map(snapshot.fields.map((name, i) => [name, i]));
  const col = (name: keyof CatalogEntry): number => {
    const i = index.get(name);
    if (i === undefined) throw new Error(`snapshot has no ${name} column`);
    return i;
  };
  const id = col('NORAD_CAT_ID');
  const name = col('OBJECT_NAME');
  const designator = col('OBJECT_ID');
  const epoch = col('EPOCH');
  const motion = col('MEAN_MOTION');
  const ecc = col('ECCENTRICITY');
  const inc = col('INCLINATION');
  const raan = col('RA_OF_ASC_NODE');
  const argp = col('ARG_OF_PERICENTER');
  const anomaly = col('MEAN_ANOMALY');
  const bstar = col('BSTAR');

  return snapshot.rows.map((row) => ({
    NORAD_CAT_ID: row[id] as number,
    OBJECT_NAME: row[name] as string,
    OBJECT_ID: row[designator] as string,
    EPOCH: row[epoch] as string,
    MEAN_MOTION: row[motion] as number,
    ECCENTRICITY: row[ecc] as number,
    INCLINATION: row[inc] as number,
    RA_OF_ASC_NODE: row[raan] as number,
    ARG_OF_PERICENTER: row[argp] as number,
    MEAN_ANOMALY: row[anomaly] as number,
    BSTAR: row[bstar] as number,
  }));
}

/** Fetches the catalog the site ships. Nothing here ever contacts CelesTrak. */
export async function loadCatalog(baseUrl: string): Promise<{
  manifest: SnapshotManifest;
  entries: CatalogEntry[];
}> {
  const manifestResponse = await fetch(`${baseUrl}data/manifest.json`);
  if (!manifestResponse.ok) {
    throw new Error(`Catalog manifest returned HTTP ${manifestResponse.status}`);
  }
  const manifest = (await manifestResponse.json()) as SnapshotManifest;
  const snapshotResponse = await fetch(`${baseUrl}data/${manifest.file}`);
  if (!snapshotResponse.ok) {
    throw new Error(`Catalog snapshot returned HTTP ${snapshotResponse.status}`);
  }
  const snapshot = (await snapshotResponse.json()) as Snapshot;
  return { manifest, entries: decodeSnapshot(snapshot) };
}
