import { describe, expect, it } from 'vitest';
import { ecefToGeodetic, geodeticToEcef, lookAngles, temeToEcef } from '../src/astro/frames';
import { isSunlit, sunDirection } from '../src/astro/sun';
import { gstime, jday } from '../src/astro/time';

const ARCSEC = Math.PI / (180 * 3600);

describe('TEME to Earth-fixed', () => {
  // Appendix C worked example, Vallado et al. 2006 (Rev 3).
  const rTeme = [5094.1801072, 6127.6447052, 6380.3445327] as const;
  const rItrf = [-1033.479383, 7901.2952754, 6380.3565958] as const;
  const utc = jday(2004, 4, 6, 7, 51, 28.386);
  const ut1 = utc.jd + utc.frac - 0.439961 / 86400;

  it('reproduces the published ITRF vector once polar motion is applied', () => {
    const [x, y, z] = temeToEcef(rTeme, gstime(ut1));
    const xp = -0.140682 * ARCSEC;
    const yp = 0.333309 * ARCSEC;
    expect(x + xp * z - rItrf[0]).toBeCloseTo(0, 3);
    expect(y - yp * z - rItrf[1]).toBeCloseTo(0, 3);
    expect(-xp * x + yp * y + z - rItrf[2]).toBeCloseTo(0, 3);
  });

  it('stays within polar motion of the published vector without it', () => {
    const r = temeToEcef(rTeme, gstime(ut1));
    expect(Math.hypot(r[0] - rItrf[0], r[1] - rItrf[1], r[2] - rItrf[2])).toBeLessThan(0.03);
  });
});

describe('geodetic conversion', () => {
  it.each([
    [0, 0, 0],
    [43.07, -89.4, 0.27],
    [-33.9, 151.2, 0.05],
    [89.9, 45, 1],
    [-89.99, -120, 0],
    [12, 179.9, 550],
  ])('round-trips lat %f lon %f alt %f', (latDeg, lonDeg, altKm) => {
    const g = ecefToGeodetic(geodeticToEcef({ latDeg, lonDeg, altKm }));
    expect(g.latDeg).toBeCloseTo(latDeg, 8);
    expect(g.lonDeg).toBeCloseTo(lonDeg, 8);
    expect(g.altKm).toBeCloseTo(altKm, 6);
  });

  it('places the equator-Greenwich point on the semi-major axis', () => {
    const [x, y, z] = geodeticToEcef({ latDeg: 0, lonDeg: 0, altKm: 0 });
    expect(x).toBeCloseTo(6378.137, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(0, 9);
  });
});

describe('look angles', () => {
  const observer = { latDeg: 0, lonDeg: 0, altKm: 0 };
  const site = geodeticToEcef(observer);

  it('sees a point straight overhead at 90 degrees', () => {
    const look = lookAngles(observer, site, [7000, 0, 0]);
    expect(look.elevationDeg).toBeCloseTo(90, 6);
    expect(look.rangeKm).toBeCloseTo(7000 - 6378.137, 6);
  });

  it('measures azimuth clockwise from north', () => {
    const north = lookAngles(observer, site, [6378.137, 0, 100]);
    const east = lookAngles(observer, site, [6378.137, 100, 0]);
    expect(north.azimuthDeg).toBeCloseTo(0, 6);
    expect(north.elevationDeg).toBeCloseTo(0, 6);
    expect(east.azimuthDeg).toBeCloseTo(90, 6);
  });
});

describe('sun', () => {
  const declination = (jd: { jd: number; frac: number }): number =>
    (Math.asin(sunDirection(jd.jd, jd.frac)[2]) * 180) / Math.PI;

  it('crosses the equator at the 2024 March equinox', () => {
    expect(declination(jday(2024, 3, 20, 3, 6, 0))).toBeCloseTo(0, 1);
  });

  it('reaches the obliquity at the 2024 June solstice', () => {
    expect(declination(jday(2024, 6, 20, 20, 51, 0))).toBeCloseTo(23.44, 1);
  });

  it('puts a satellite behind Earth in shadow but not one beside it', () => {
    const sun = [1, 0, 0] as const;
    expect(isSunlit([-7000, 0, 0], sun, 6378)).toBe(false);
    expect(isSunlit([-7000, 6500, 0], sun, 6378)).toBe(true);
    expect(isSunlit([7000, 0, 0], sun, 6378)).toBe(true);
  });
});
