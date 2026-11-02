import type { CatalogEntry } from './snapshot';

/**
 * Multiplies the catalog for load testing. Copies are phased along their own
 * orbits so they spread out instead of stacking on the original. The result is
 * synthetic by construction, and the page says so whenever it is in use.
 */
export function scaleCatalog(entries: CatalogEntry[], factor: number): CatalogEntry[] {
  if (factor <= 1) return entries;
  const scaled: CatalogEntry[] = [];
  for (let copy = 0; copy < factor; copy += 1) {
    const anomalyShift = (copy * 360) / factor;
    const nodeShift = (copy * 137.5) % 360;
    for (const entry of entries) {
      scaled.push(
        copy === 0
          ? entry
          : {
              ...entry,
              MEAN_ANOMALY: (entry.MEAN_ANOMALY + anomalyShift) % 360,
              RA_OF_ASC_NODE: (entry.RA_OF_ASC_NODE + nodeShift) % 360,
            },
      );
    }
  }
  return scaled;
}
