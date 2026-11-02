const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const TWOPI = 2 * Math.PI;

const WGS84_A_KM = 6378.137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export type Vec3 = readonly [number, number, number];

/**
 * TEME to Earth-fixed by a rotation through GMST. Strictly this yields the
 * pseudo-Earth-fixed frame: polar motion is ignored because it needs a daily
 * data feed and moves a low orbit by only tens of metres.
 */
export function temeToEcef(r: Vec3, gmst: number): [number, number, number] {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  return [c * r[0] + s * r[1], -s * r[0] + c * r[1], r[2]];
}

export interface Geodetic {
  latDeg: number;
  lonDeg: number;
  altKm: number;
}

export function geodeticToEcef(g: Geodetic): [number, number, number] {
  const lat = g.latDeg * DEG2RAD;
  const lon = g.lonDeg * DEG2RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return [
    (n + g.altKm) * cosLat * Math.cos(lon),
    (n + g.altKm) * cosLat * Math.sin(lon),
    (n * (1 - WGS84_E2) + g.altKm) * sinLat,
  ];
}

export function ecefToGeodetic(r: Vec3): Geodetic {
  const [x, y, z] = r;
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - WGS84_E2));
  let n = WGS84_A_KM;
  for (let i = 0; i < 6; i += 1) {
    const sinLat = Math.sin(lat);
    n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    lat = Math.atan2(z + n * WGS84_E2 * sinLat, p);
  }
  const cosLat = Math.cos(lat);
  // Height from p fails at the poles and height from z fails at the equator,
  // so use whichever the latitude favours.
  const altKm = Math.abs(cosLat) > 0.1 ? p / cosLat - n : z / Math.sin(lat) - n * (1 - WGS84_E2);
  return { latDeg: lat * RAD2DEG, lonDeg: Math.atan2(y, x) * RAD2DEG, altKm };
}

export interface LookAngles {
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
}

/** Topocentric azimuth (from north, clockwise), geometric elevation and range. */
export function lookAngles(observer: Geodetic, observerEcef: Vec3, target: Vec3): LookAngles {
  const lat = observer.latDeg * DEG2RAD;
  const lon = observer.lonDeg * DEG2RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const dx = target[0] - observerEcef[0];
  const dy = target[1] - observerEcef[1];
  const dz = target[2] - observerEcef[2];

  const south = sinLat * cosLon * dx + sinLat * sinLon * dy - cosLat * dz;
  const east = -sinLon * dx + cosLon * dy;
  const up = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;

  const rangeKm = Math.hypot(dx, dy, dz);
  let azimuth = Math.atan2(east, -south);
  if (azimuth < 0) azimuth += TWOPI;
  return {
    azimuthDeg: azimuth * RAD2DEG,
    elevationDeg: Math.asin(up / rangeKm) * RAD2DEG,
    rangeKm,
  };
}
