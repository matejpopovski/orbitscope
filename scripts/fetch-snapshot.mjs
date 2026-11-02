#!/usr/bin/env node
// Downloads CelesTrak's active-satellite GP set and writes the compact dated
// snapshot the site ships. This is the only code in the project that talks to
// CelesTrak: browsers read the snapshot, never the upstream service.
//
// CelesTrak allows one download of a group per data update and asks clients to
// stop on any non-200 response. A repeat request costs a 403, and 50 errors in
// two hours puts the address on their firewall. So there is deliberately no
// retry loop here: one attempt, then exit non-zero for a human to read.
//
//   node scripts/fetch-snapshot.mjs [--out public/data] [--force] [--raw file]
//                                   [--from-raw file] [--url url]
//
// --raw keeps the unmodified response, --from-raw rebuilds from that file
// without touching the network, and --url points at a stand-in server.

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json';
export const USER_AGENT = 'orbitscope-snapshot/1.0 (+https://github.com/matejpopovski/orbitscope)';
export const SCHEMA_VERSION = 1;
export const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
export const MIN_OBJECTS = 1000;
export const MIN_AGE_HOURS = 20;

export const ATTRIBUTION =
  'Orbital data: CelesTrak (celestrak.org), derived from general perturbations element sets ' +
  'published by the US Space Force 18th Space Defense Squadron via Space-Track.org. ' +
  'Basic SSA data redistributed under the USSPACECOM blanket approval, which is conditional on citation.';

// Rows are positional and src/catalog/snapshot.ts decodes them by these names.
// MEAN_MOTION_DOT and MEAN_MOTION_DDOT are left out because SGP4 never reads them.
export const FIELDS = [
  'NORAD_CAT_ID',
  'OBJECT_NAME',
  'OBJECT_ID',
  'EPOCH',
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'BSTAR',
];

const NUMERIC_FIELDS = FIELDS.filter(
  (f) => !['NORAD_CAT_ID', 'OBJECT_NAME', 'OBJECT_ID', 'EPOCH'].includes(f),
);

/**
 * Turns the upstream OMM array into the compact positional snapshot. Numbers
 * pass through unchanged because rounding an element is an orbit change, not a
 * compression; the size saving comes from dropping keys and unused fields.
 */
export function compactCatalog(records, fetchedAt) {
  if (!Array.isArray(records)) {
    throw new Error('expected a JSON array of OMM records');
  }
  const seen = new Set();
  const rows = [];
  let skipped = 0;
  for (const record of records) {
    const id = Number(record?.NORAD_CAT_ID);
    const valid =
      Number.isInteger(id) &&
      id > 0 &&
      typeof record.OBJECT_NAME === 'string' &&
      typeof record.EPOCH === 'string' &&
      !Number.isNaN(Date.parse(`${record.EPOCH}Z`)) &&
      NUMERIC_FIELDS.every((f) => Number.isFinite(record[f]));
    if (!valid || seen.has(id)) {
      skipped += 1;
      continue;
    }
    seen.add(id);
    rows.push(FIELDS.map((f) => (f === 'NORAD_CAT_ID' ? id : (record[f] ?? ''))));
  }
  rows.sort((a, b) => a[0] - b[0]);
  return {
    schema: SCHEMA_VERSION,
    source: SOURCE_URL,
    attribution: ATTRIBUTION,
    fetchedAt,
    skipped,
    fields: FIELDS,
    rows,
  };
}

async function readManifest(outDir) {
  try {
    return JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function download(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    redirect: 'manual',
  });
  const body = await response.text();
  if (response.status !== 200) {
    throw new Error(
      `CelesTrak answered HTTP ${response.status}. Not retrying, per their usage policy. ` +
        `Body: ${body.slice(0, 200)}`,
    );
  }
  return body;
}

async function writeSnapshot(outDir, snapshot) {
  const date = snapshot.fetchedAt.slice(0, 10);
  const file = `active-${date}.json`;
  const text = `${JSON.stringify(snapshot)}\n`;
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_SNAPSHOT_BYTES) {
    throw new Error(`snapshot is ${bytes} bytes, over the ${MAX_SNAPSHOT_BYTES} byte limit`);
  }
  await mkdir(outDir, { recursive: true });
  for (const name of await readdir(outDir)) {
    if (/^active-.*\.json$/.test(name) && name !== file) {
      await rm(join(outDir, name));
    }
  }
  await writeFile(join(outDir, file), text);
  const manifest = {
    file,
    fetchedAt: snapshot.fetchedAt,
    objects: snapshot.rows.length,
    bytes,
    sha256: createHash('sha256').update(text).digest('hex'),
    source: snapshot.source,
    attribution: snapshot.attribution,
  };
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function parseArgs(argv) {
  const args = { out: 'public/data', force: false, raw: null, fromRaw: null, url: SOURCE_URL };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') args.force = true;
    else if (arg === '--out') args.out = argv[(i += 1)];
    else if (arg === '--raw') args.raw = argv[(i += 1)];
    else if (arg === '--from-raw') args.fromRaw = argv[(i += 1)];
    else if (arg === '--url') args.url = argv[(i += 1)];
    else throw new Error(`unknown argument ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let body;
  let fetchedAt;
  if (args.fromRaw) {
    body = await readFile(args.fromRaw, 'utf8');
    fetchedAt = (await stat(args.fromRaw)).mtime.toISOString();
  } else {
    const manifest = await readManifest(args.out);
    if (manifest && !args.force) {
      const ageHours = (Date.now() - Date.parse(manifest.fetchedAt)) / 3.6e6;
      if (ageHours < MIN_AGE_HOURS) {
        console.log(`snapshot is ${ageHours.toFixed(1)} h old, skipping download`);
        return;
      }
    }
    body = await download(args.url);
    fetchedAt = new Date().toISOString();
    if (args.raw) {
      await mkdir(dirname(args.raw), { recursive: true });
      await writeFile(args.raw, body);
    }
  }
  const snapshot = compactCatalog(JSON.parse(body), fetchedAt);
  if (snapshot.rows.length < MIN_OBJECTS) {
    throw new Error(`only ${snapshot.rows.length} usable objects, keeping the previous snapshot`);
  }
  const manifest = await writeSnapshot(args.out, snapshot);
  console.log(
    `wrote ${manifest.file}: ${manifest.objects} objects, ${manifest.bytes} bytes, ` +
      `${snapshot.skipped} skipped`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
