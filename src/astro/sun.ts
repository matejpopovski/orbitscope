const DEG2RAD = Math.PI / 180;

/**
 * Unit vector to the sun in the mean equator-of-date frame, from the Astronomical
 * Almanac's low-precision series (good to about 0.01 degrees). That frame differs
 * from TEME by far less than the series error, so no conversion is applied. It
 * drives the terminator and eclipse checks, neither of which needs better.
 */
export function sunDirection(jd: number, frac: number): [number, number, number] {
  const t = (jd - 2451545 + frac) / 36525;
  const meanLongitude = 280.46 + 36000.771 * t;
  const meanAnomaly = (357.5277233 + 35999.05034 * t) * DEG2RAD;
  const eclipticLongitude =
    (meanLongitude +
      1.914666471 * Math.sin(meanAnomaly) +
      0.019994643 * Math.sin(2 * meanAnomaly)) *
    DEG2RAD;
  const obliquity = (23.439291 - 0.0130042 * t) * DEG2RAD;
  return [
    Math.cos(eclipticLongitude),
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.sin(obliquity) * Math.sin(eclipticLongitude),
  ];
}

/**
 * Cylindrical Earth shadow test. The sun's angular size is ignored, so a
 * satellite within a few seconds of entering shadow may be misclassified.
 */
export function isSunlit(
  r: readonly [number, number, number],
  sun: readonly [number, number, number],
  earthRadiusKm: number,
): boolean {
  const along = r[0] * sun[0] + r[1] * sun[1] + r[2] * sun[2];
  if (along >= 0) return true;
  const px = r[0] - along * sun[0];
  const py = r[1] - along * sun[1];
  const pz = r[2] - along * sun[2];
  return px * px + py * py + pz * pz > earthRadiusKm * earthRadiusKm;
}
