import { gstime } from '../astro/time';
import { J2, J3OJ2, J4, JD_1950, RADIUS_EARTH_KM, TWOPI, X2O3, XKE } from './constants';
import { dscom, dsinit } from './deepspace';
import { sgp4 } from './propagate';
import { Satrec, type MeanElements } from './satrec';

const scratch = new Float64Array(6);

/**
 * Builds a propagator from mean elements. Mirrors `sgp4init` from Vallado et
 * al., "Revisiting Spacetrack Report #3" (AIAA 2006-6753), in its improved
 * operation mode. The AFSPC mode is not implemented because the published
 * vectors do not exercise it, and untestable branches have no place here.
 */
export function sgp4init(elements: MeanElements): Satrec {
  const sat = new Satrec();
  sat.satnum = elements.satnum;
  sat.jdEpoch = elements.jdEpoch;
  sat.jdEpochFrac = elements.jdEpochFrac;
  sat.bstar = elements.bstar;
  sat.ecco = elements.ecco;
  sat.argpo = elements.argpo;
  sat.inclo = elements.inclo;
  sat.mo = elements.mo;
  sat.noKozai = elements.noKozai;
  sat.nodeo = elements.nodeo;

  const epoch = elements.jdEpoch + elements.jdEpochFrac - JD_1950;

  const ss = 78 / RADIUS_EARTH_KM + 1;
  const qzms2ttemp = (120 - 78) / RADIUS_EARTH_KM;
  const qzms2t = qzms2ttemp * qzms2ttemp * qzms2ttemp * qzms2ttemp;

  // initl: recover the Brouwer mean motion from the Kozai value GP data carries.
  const eccsq = sat.ecco * sat.ecco;
  const omeosq = 1 - eccsq;
  const rteosq = Math.sqrt(omeosq);
  const cosio = Math.cos(sat.inclo);
  const cosio2 = cosio * cosio;
  const ak = Math.pow(XKE / sat.noKozai, X2O3);
  const d1 = (0.75 * J2 * (3 * cosio2 - 1)) / (rteosq * omeosq);
  let del = d1 / (ak * ak);
  const adel = ak * (1 - del * del - del * (1 / 3 + (134 * del * del) / 81));
  del = d1 / (adel * adel);
  sat.noUnkozai = sat.noKozai / (1 + del);

  const ao = Math.pow(XKE / sat.noUnkozai, X2O3);
  const sinio = Math.sin(sat.inclo);
  const po = ao * omeosq;
  const con42 = 1 - 5 * cosio2;
  sat.con41 = -con42 - cosio2 - cosio2;
  const posq = po * po;
  const rp = ao * (1 - sat.ecco);
  sat.gsto = gstime(epoch + JD_1950);

  sat.isimp = rp < 220 / RADIUS_EARTH_KM + 1;

  // The atmospheric density parameter s depends on perigee height below
  // 156 km, and is pinned to 20 km below 98 km.
  let sfour = ss;
  let qzms24 = qzms2t;
  const perige = (rp - 1) * RADIUS_EARTH_KM;
  if (perige < 156) {
    sfour = perige - 78;
    if (perige < 98) sfour = 20;
    const qzms24temp = (120 - sfour) / RADIUS_EARTH_KM;
    qzms24 = qzms24temp * qzms24temp * qzms24temp * qzms24temp;
    sfour = sfour / RADIUS_EARTH_KM + 1;
  }

  const pinvsq = 1 / posq;
  const tsi = 1 / (ao - sfour);
  sat.eta = ao * sat.ecco * tsi;
  const etasq = sat.eta * sat.eta;
  const eeta = sat.ecco * sat.eta;
  const psisq = Math.abs(1 - etasq);
  const coef = qzms24 * Math.pow(tsi, 4);
  const coef1 = coef / Math.pow(psisq, 3.5);
  const cc2 =
    coef1 *
    sat.noUnkozai *
    (ao * (1 + 1.5 * etasq + eeta * (4 + etasq)) +
      ((0.375 * J2 * tsi) / psisq) * sat.con41 * (8 + 3 * etasq * (8 + etasq)));
  sat.cc1 = sat.bstar * cc2;
  let cc3 = 0;
  if (sat.ecco > 1e-4) {
    cc3 = (-2 * coef * tsi * J3OJ2 * sat.noUnkozai * sinio) / sat.ecco;
  }
  sat.x1mth2 = 1 - cosio2;
  sat.cc4 =
    2 *
    sat.noUnkozai *
    coef1 *
    ao *
    omeosq *
    (sat.eta * (2 + 0.5 * etasq) +
      sat.ecco * (0.5 + 2 * etasq) -
      ((J2 * tsi) / (ao * psisq)) *
        (-3 * sat.con41 * (1 - 2 * eeta + etasq * (1.5 - 0.5 * eeta)) +
          0.75 * sat.x1mth2 * (2 * etasq - eeta * (1 + etasq)) * Math.cos(2 * sat.argpo)));
  sat.cc5 = 2 * coef1 * ao * omeosq * (1 + 2.75 * (etasq + eeta) + eeta * etasq);

  const cosio4 = cosio2 * cosio2;
  const temp1 = 1.5 * J2 * pinvsq * sat.noUnkozai;
  const temp2 = 0.5 * temp1 * J2 * pinvsq;
  const temp3 = -0.46875 * J4 * pinvsq * pinvsq * sat.noUnkozai;
  sat.mdot =
    sat.noUnkozai +
    0.5 * temp1 * rteosq * sat.con41 +
    0.0625 * temp2 * rteosq * (13 - 78 * cosio2 + 137 * cosio4);
  sat.argpdot =
    -0.5 * temp1 * con42 +
    0.0625 * temp2 * (7 - 114 * cosio2 + 395 * cosio4) +
    temp3 * (3 - 36 * cosio2 + 49 * cosio4);
  const xhdot1 = -temp1 * cosio;
  sat.nodedot = xhdot1 + (0.5 * temp2 * (4 - 19 * cosio2) + 2 * temp3 * (3 - 7 * cosio2)) * cosio;
  const xpidot = sat.argpdot + sat.nodedot;
  sat.omgcof = sat.bstar * cc3 * Math.cos(sat.argpo);
  sat.xmcof = sat.ecco > 1e-4 ? (-X2O3 * coef * sat.bstar) / eeta : 0;
  sat.nodecf = 3.5 * omeosq * xhdot1 * sat.cc1;
  sat.t2cof = 1.5 * sat.cc1;

  // Guards the division for retrograde equatorial orbits, where 1 + cos(i)
  // reaches zero.
  const xlcofDenom = Math.abs(cosio + 1) > 1.5e-12 ? 1 + cosio : 1.5e-12;
  sat.xlcof = (-0.25 * J3OJ2 * sinio * (3 + 5 * cosio)) / xlcofDenom;
  sat.aycof = -0.5 * J3OJ2 * sinio;
  const delmotemp = 1 + sat.eta * Math.cos(sat.mo);
  sat.delmo = delmotemp * delmotemp * delmotemp;
  sat.sinmao = Math.sin(sat.mo);
  sat.x7thm1 = 7 * cosio2 - 1;

  if (TWOPI / sat.noUnkozai >= 225) {
    sat.deep = true;
    sat.isimp = true;
    const common = dscom(sat, epoch);
    dsinit(sat, common, xpidot, eccsq);
  }

  if (!sat.isimp) {
    const cc1sq = sat.cc1 * sat.cc1;
    sat.d2 = 4 * ao * tsi * cc1sq;
    const temp = (sat.d2 * tsi * sat.cc1) / 3;
    sat.d3 = (17 * ao + sfour) * temp;
    sat.d4 = 0.5 * temp * ao * tsi * (221 * ao + 31 * sfour) * sat.cc1;
    sat.t3cof = sat.d2 + 2 * cc1sq;
    sat.t4cof = 0.25 * (3 * sat.d3 + sat.cc1 * (12 * sat.d2 + 10 * cc1sq));
    sat.t5cof =
      0.2 *
      (3 * sat.d4 +
        12 * sat.cc1 * sat.d3 +
        6 * sat.d2 * sat.d2 +
        15 * cc1sq * (2 * sat.d2 + cc1sq));
  }

  sat.error = sgp4(sat, 0, scratch, 0);
  return sat;
}

/** Minutes from a satellite's epoch to a Julian date given as whole + fraction. */
export function minutesSinceEpoch(sat: Satrec, jd: number, jdFrac: number): number {
  return (jd - sat.jdEpoch + (jdFrac - sat.jdEpochFrac)) * 1440;
}

/** Orbital period in minutes, from the recovered mean motion. */
export function periodMinutes(sat: Satrec): number {
  return TWOPI / sat.noUnkozai;
}
