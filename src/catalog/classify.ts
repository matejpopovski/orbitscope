import { RADIUS_EARTH_KM } from '../sgp4';
import type { CatalogEntry } from './snapshot';

/**
 * Display categories. The index is what the vertex shader tests against the
 * visibility bitmask, so the order is part of the renderer's contract.
 */
export const CATEGORIES = [
  { id: 'starlink', label: 'Starlink' },
  { id: 'megaconstellation', label: 'Megaconstellations' },
  { id: 'gnss', label: 'Navigation' },
  { id: 'leo', label: 'Other LEO' },
  { id: 'meo', label: 'Other MEO' },
  { id: 'geo', label: 'Geosynchronous' },
  { id: 'heo', label: 'Highly elliptical' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

const MEGACONSTELLATION = /^(ONEWEB|KUIPER|AMAZON LEO|QIANFAN|HULIANWANG|GUOWANG)/;
const GNSS = /(NAVSTAR|^GPS |GLONASS|GALILEO|GSAT0|BEIDOU|QZS|IRNSS|NAVIC)/;

const MU_KM3_MIN2 = 398600.8 * 3600;

/** Apogee and perigee heights in km from mean motion and eccentricity. */
export function apsides(
  meanMotionRevPerDay: number,
  eccentricity: number,
): { apogeeKm: number; perigeeKm: number } {
  const n = (meanMotionRevPerDay * 2 * Math.PI) / 1440;
  const a = Math.cbrt(MU_KM3_MIN2 / (n * n));
  return {
    apogeeKm: a * (1 + eccentricity) - RADIUS_EARTH_KM,
    perigeeKm: a * (1 - eccentricity) - RADIUS_EARTH_KM,
  };
}

export function classify(entry: CatalogEntry): number {
  const name = entry.OBJECT_NAME;
  const id = ((): CategoryId => {
    if (name.startsWith('STARLINK')) return 'starlink';
    if (MEGACONSTELLATION.test(name)) return 'megaconstellation';
    if (GNSS.test(name)) return 'gnss';
    if (entry.ECCENTRICITY > 0.25) return 'heo';
    const { apogeeKm } = apsides(entry.MEAN_MOTION, entry.ECCENTRICITY);
    if (apogeeKm < 2000) return 'leo';
    if (entry.MEAN_MOTION > 0.9 && entry.MEAN_MOTION < 1.1) return 'geo';
    return 'meo';
  })();
  return CATEGORIES.findIndex((c) => c.id === id);
}
