// Writes this project's SGP4 output for the whole snapshot so that
// scripts/crosscheck-python.py can compare it with Vallado's compiled C++.
//
//   npm run crosscheck:python

import { writeFileSync } from 'node:fs';
import { minutesSinceEpoch, ommToElements, sgp4, sgp4init } from '../src/sgp4';
import { loadCatalog, SNAPSHOT_JD } from '../tests/support/catalog';

const OFFSETS_MINUTES = [0, 1440, 4320, -1440];
const out = new Float64Array(6);
const states = loadCatalog().flatMap((entry) => {
  const sat = sgp4init(ommToElements(entry));
  const base = minutesSinceEpoch(sat, SNAPSHOT_JD.jd, SNAPSHOT_JD.frac);
  return OFFSETS_MINUTES.flatMap((offset) =>
    sgp4(sat, base + offset, out, 0) === 0
      ? [{ id: entry.NORAD_CAT_ID, tsince: base + offset, state: Array.from(out) }]
      : [],
  );
});
writeFileSync('results/.ts-states.json', JSON.stringify(states));
console.log(`exported ${states.length} states`);
