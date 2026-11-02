import { J2, J3OJ2, PI, RADIUS_EARTH_KM, TWOPI, VKMPERSEC, X2O3, XKE } from './constants';
import { dpper, dspace, type DeepSecular, type PeriodicState } from './deepspace';
import type { Satrec } from './satrec';

// Reused across calls so the hot path allocates nothing. Propagation is
// single-threaded per worker, so sharing these is safe.
const secular: DeepSecular = { em: 0, argpm: 0, inclm: 0, mm: 0, nodem: 0, nm: 0 };
const periodic: PeriodicState = { ep: 0, inclp: 0, nodep: 0, argpp: 0, mp: 0 };

const TEMP4 = 1.5e-12;

/**
 * SGP4 as given by Vallado et al., AIAA 2006-6753, and its reference code:
 * https://celestrak.org/publications/AIAA/2006-6753/
 *
 * Propagates a satellite `tsince` minutes from its epoch and writes position
 * (km) and velocity (km/s), both in TEME, to `out[offset..offset + 5]`.
 *
 * Returns 0 on success or a code from `SGP4_ERRORS`. On error code 6 the state
 * is still written, matching the reference, but it should not be used.
 */
export function sgp4(sat: Satrec, tsince: number, out: Float64Array, offset: number): number {
  const t = tsince;

  const xmdf = sat.mo + sat.mdot * t;
  const argpdf = sat.argpo + sat.argpdot * t;
  const nodedf = sat.nodeo + sat.nodedot * t;
  let argpm = argpdf;
  let mm = xmdf;
  const t2 = t * t;
  let nodem = nodedf + sat.nodecf * t2;
  let tempa = 1 - sat.cc1 * t;
  let tempe = sat.bstar * sat.cc4 * t;
  let templ = sat.t2cof * t2;

  if (!sat.isimp) {
    const delomg = sat.omgcof * t;
    const delmtemp = 1 + sat.eta * Math.cos(xmdf);
    const delm = sat.xmcof * (delmtemp * delmtemp * delmtemp - sat.delmo);
    const temp = delomg + delm;
    mm = xmdf + temp;
    argpm = argpdf - temp;
    const t3 = t2 * t;
    const t4 = t3 * t;
    tempa = tempa - sat.d2 * t2 - sat.d3 * t3 - sat.d4 * t4;
    tempe += sat.bstar * sat.cc5 * (Math.sin(mm) - sat.sinmao);
    templ += sat.t3cof * t3 + t4 * (sat.t4cof + t * sat.t5cof);
  }

  let nm = sat.noUnkozai;
  let em = sat.ecco;
  let inclm = sat.inclo;

  if (sat.deep) {
    secular.em = em;
    secular.argpm = argpm;
    secular.inclm = inclm;
    secular.mm = mm;
    secular.nodem = nodem;
    secular.nm = nm;
    dspace(sat, t, secular);
    em = secular.em;
    argpm = secular.argpm;
    inclm = secular.inclm;
    mm = secular.mm;
    nodem = secular.nodem;
    nm = secular.nm;
  }

  if (nm <= 0) return 2;

  const am = Math.pow(XKE / nm, X2O3) * tempa * tempa;
  nm = XKE / Math.pow(am, 1.5);
  em -= tempe;

  if (em >= 1 || em < -0.001) return 1;
  // Very small eccentricities make the short-period terms blow up.
  if (em < 1e-6) em = 1e-6;

  mm += sat.noUnkozai * templ;
  let xlm = mm + argpm + nodem;
  nodem %= TWOPI;
  argpm %= TWOPI;
  xlm %= TWOPI;
  mm = (xlm - argpm - nodem) % TWOPI;

  let ep = em;
  let xincp = inclm;
  let argpp = argpm;
  let nodep = nodem;
  let mp = mm;
  let sinip = Math.sin(inclm);
  let cosip = Math.cos(inclm);

  if (sat.deep) {
    periodic.ep = ep;
    periodic.inclp = xincp;
    periodic.nodep = nodep;
    periodic.argpp = argpp;
    periodic.mp = mp;
    dpper(sat, t, periodic);
    ep = periodic.ep;
    xincp = periodic.inclp;
    nodep = periodic.nodep;
    argpp = periodic.argpp;
    mp = periodic.mp;

    if (xincp < 0) {
      xincp = -xincp;
      nodep += PI;
      argpp -= PI;
    }
    if (ep < 0 || ep > 1) return 3;

    // These depend on inclination, which the lunar-solar terms just changed,
    // so unlike near-Earth orbits they are not constants of the satellite.
    sinip = Math.sin(xincp);
    cosip = Math.cos(xincp);
    sat.aycof = -0.5 * J3OJ2 * sinip;
    const denom = Math.abs(cosip + 1) > TEMP4 ? 1 + cosip : TEMP4;
    sat.xlcof = (-0.25 * J3OJ2 * sinip * (3 + 5 * cosip)) / denom;
  }

  const axnl = ep * Math.cos(argpp);
  let temp = 1 / (am * (1 - ep * ep));
  const aynl = ep * Math.sin(argpp) + temp * sat.aycof;
  const xl = mp + argpp + nodep + temp * sat.xlcof * axnl;

  // Kepler's equation. The 0.95 clamp stops a Newton step overshooting at high
  // eccentricity, and ten iterations is the reference's fixed limit.
  const u = (xl - nodep) % TWOPI;
  let eo1 = u;
  let tem5 = 9999.9;
  let sineo1 = 0;
  let coseo1 = 0;
  for (let ktr = 1; Math.abs(tem5) >= 1e-12 && ktr <= 10; ktr += 1) {
    sineo1 = Math.sin(eo1);
    coseo1 = Math.cos(eo1);
    tem5 = 1 - coseo1 * axnl - sineo1 * aynl;
    tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
    if (Math.abs(tem5) >= 0.95) tem5 = tem5 > 0 ? 0.95 : -0.95;
    eo1 += tem5;
  }

  const ecose = axnl * coseo1 + aynl * sineo1;
  const esine = axnl * sineo1 - aynl * coseo1;
  const el2 = axnl * axnl + aynl * aynl;
  const pl = am * (1 - el2);
  if (pl < 0) return 4;

  const rl = am * (1 - ecose);
  const rdotl = (Math.sqrt(am) * esine) / rl;
  const rvdotl = Math.sqrt(pl) / rl;
  const betal = Math.sqrt(1 - el2);
  temp = esine / (1 + betal);
  const sinu = (am / rl) * (sineo1 - aynl - axnl * temp);
  const cosu = (am / rl) * (coseo1 - axnl + aynl * temp);
  let su = Math.atan2(sinu, cosu);
  const sin2u = (cosu + cosu) * sinu;
  const cos2u = 1 - 2 * sinu * sinu;
  temp = 1 / pl;
  const temp1 = 0.5 * J2 * temp;
  const temp2 = temp1 * temp;

  if (sat.deep) {
    const cosisq = cosip * cosip;
    sat.con41 = 3 * cosisq - 1;
    sat.x1mth2 = 1 - cosisq;
    sat.x7thm1 = 7 * cosisq - 1;
  }

  const mrt = rl * (1 - 1.5 * temp2 * betal * sat.con41) + 0.5 * temp1 * sat.x1mth2 * cos2u;
  su -= 0.25 * temp2 * sat.x7thm1 * sin2u;
  const xnode = nodep + 1.5 * temp2 * cosip * sin2u;
  const xinc = xincp + 1.5 * temp2 * cosip * sinip * cos2u;
  const mvt = rdotl - (nm * temp1 * sat.x1mth2 * sin2u) / XKE;
  const rvdot = rvdotl + (nm * temp1 * (sat.x1mth2 * cos2u + 1.5 * sat.con41)) / XKE;

  const sinsu = Math.sin(su);
  const cossu = Math.cos(su);
  const snod = Math.sin(xnode);
  const cnod = Math.cos(xnode);
  const sini = Math.sin(xinc);
  const cosi = Math.cos(xinc);
  const xmx = -snod * cosi;
  const xmy = cnod * cosi;
  const ux = xmx * sinsu + cnod * cossu;
  const uy = xmy * sinsu + snod * cossu;
  const uz = sini * sinsu;
  const vx = xmx * cossu - cnod * sinsu;
  const vy = xmy * cossu - snod * sinsu;
  const vz = sini * cossu;

  out[offset] = mrt * ux * RADIUS_EARTH_KM;
  out[offset + 1] = mrt * uy * RADIUS_EARTH_KM;
  out[offset + 2] = mrt * uz * RADIUS_EARTH_KM;
  out[offset + 3] = (mvt * ux + rvdot * vx) * VKMPERSEC;
  out[offset + 4] = (mvt * uy + rvdot * vy) * VKMPERSEC;
  out[offset + 5] = (mvt * uz + rvdot * vz) * VKMPERSEC;

  return mrt < 1 ? 6 : 0;
}
