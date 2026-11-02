import { PI, TWOPI, X2O3, XKE } from './constants';
import type { Satrec } from './satrec';

// Lunar and solar perturbation terms (SDP4) for periods of 225 minutes or more.
// Numeric literals come from the published theory; several carry fewer digits
// than a double can hold, and tidying them would break agreement with it.

const ZES = 0.01675;
const ZEL = 0.0549;
const ZNS = 1.19459e-5;
const ZNL = 1.5835218e-4;
/** Earth rotation in rad/min, the reference's 4.37526908801129966e-3 as a double. */
const RPTIM = 0.0043752690880113;

/** The five osculating elements that `dpper` corrects in place. */
export interface PeriodicState {
  ep: number;
  inclp: number;
  nodep: number;
  argpp: number;
  mp: number;
}

/**
 * Lunar-solar long-period periodics.
 *
 * The reference code also calls this during initialisation with `init = 'y'`,
 * but in that mode every output is left untouched, so the epoch offsets it
 * subtracts (`peo`, `pinco`, `plo`, `pgho`, `pho`) are always zero. Both the
 * call and the offsets are omitted here; the vectors confirm the equivalence.
 */
export function dpper(sat: Satrec, t: number, s: PeriodicState): void {
  let zm = sat.zmos + ZNS * t;
  let zf = zm + 2 * ZES * Math.sin(zm);
  let sinzf = Math.sin(zf);
  let f2 = 0.5 * sinzf * sinzf - 0.25;
  let f3 = -0.5 * sinzf * Math.cos(zf);
  const ses = sat.se2 * f2 + sat.se3 * f3;
  const sis = sat.si2 * f2 + sat.si3 * f3;
  const sls = sat.sl2 * f2 + sat.sl3 * f3 + sat.sl4 * sinzf;
  const sghs = sat.sgh2 * f2 + sat.sgh3 * f3 + sat.sgh4 * sinzf;
  const shs = sat.sh2 * f2 + sat.sh3 * f3;

  zm = sat.zmol + ZNL * t;
  zf = zm + 2 * ZEL * Math.sin(zm);
  sinzf = Math.sin(zf);
  f2 = 0.5 * sinzf * sinzf - 0.25;
  f3 = -0.5 * sinzf * Math.cos(zf);
  const sel = sat.ee2 * f2 + sat.e3 * f3;
  const sil = sat.xi2 * f2 + sat.xi3 * f3;
  const sll = sat.xl2 * f2 + sat.xl3 * f3 + sat.xl4 * sinzf;
  const sghl = sat.xgh2 * f2 + sat.xgh3 * f3 + sat.xgh4 * sinzf;
  const shll = sat.xh2 * f2 + sat.xh3 * f3;

  const pe = ses + sel;
  const pinc = sis + sil;
  const pl = sls + sll;
  let pgh = sghs + sghl;
  let ph = shs + shll;

  s.inclp += pinc;
  s.ep += pe;
  const sinip = Math.sin(s.inclp);
  const cosip = Math.cos(s.inclp);

  if (s.inclp >= 0.2) {
    ph /= sinip;
    pgh -= cosip * ph;
    s.argpp += pgh;
    s.nodep += ph;
    s.mp += pl;
    return;
  }

  // Lyddane form: below about 11 degrees the classical element is close to
  // singular, so the node correction goes through non-singular variables.
  const sinop = Math.sin(s.nodep);
  const cosop = Math.cos(s.nodep);
  let alfdp = sinip * sinop;
  let betdp = sinip * cosop;
  const dalf = ph * cosop + pinc * cosip * sinop;
  const dbet = -ph * sinop + pinc * cosip * cosop;
  alfdp += dalf;
  betdp += dbet;
  s.nodep %= TWOPI;
  let xls = s.mp + s.argpp + cosip * s.nodep;
  const dls = pl + pgh - pinc * s.nodep * sinip;
  xls += dls;
  const xnoh = s.nodep;
  s.nodep = Math.atan2(alfdp, betdp);
  if (Math.abs(xnoh - s.nodep) > PI) {
    s.nodep += s.nodep < xnoh ? TWOPI : -TWOPI;
  }
  s.mp += pl;
  s.argpp = xls - s.mp - cosip * s.nodep;
}

/** Intermediates `dscom` hands to `dsinit`. */
export interface DeepCommon {
  sinim: number;
  cosim: number;
  em: number;
  emsq: number;
  nm: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  s5: number;
  ss1: number;
  ss2: number;
  ss3: number;
  ss4: number;
  ss5: number;
  sz1: number;
  sz3: number;
  sz11: number;
  sz13: number;
  sz21: number;
  sz23: number;
  sz31: number;
  sz33: number;
  z1: number;
  z3: number;
  z11: number;
  z13: number;
  z21: number;
  z23: number;
  z31: number;
  z33: number;
}

/** Common deep-space terms: lunar and solar geometry at epoch. */
export function dscom(sat: Satrec, epoch: number): DeepCommon {
  const C1SS = 2.9864797e-6;
  const C1L = 4.7968065e-7;
  const ZSINIS = 0.39785416;
  const ZCOSIS = 0.91744867;
  const ZCOSGS = 0.1945905;
  const ZSINGS = -0.98088458;

  const nm = sat.noUnkozai;
  const em = sat.ecco;
  const snodm = Math.sin(sat.nodeo);
  const cnodm = Math.cos(sat.nodeo);
  const sinomm = Math.sin(sat.argpo);
  const cosomm = Math.cos(sat.argpo);
  const sinim = Math.sin(sat.inclo);
  const cosim = Math.cos(sat.inclo);
  const emsq = em * em;
  const betasq = 1 - emsq;
  const rtemsq = Math.sqrt(betasq);

  const day = epoch + 18261.5;
  const xnodce = (4.523602 - 9.2422029e-4 * day) % TWOPI;
  const stem = Math.sin(xnodce);
  const ctem = Math.cos(xnodce);
  const zcosil = 0.91375164 - 0.03568096 * ctem;
  const zsinil = Math.sqrt(1 - zcosil * zcosil);
  const zsinhl = (0.089683511 * stem) / zsinil;
  const zcoshl = Math.sqrt(1 - zsinhl * zsinhl);
  const gam = 5.8351514 + 0.001944368 * day;
  let zx = (0.39785416 * stem) / zsinil;
  const zy = zcoshl * ctem + 0.91744867 * zsinhl * stem;
  zx = Math.atan2(zx, zy);
  zx = gam + zx - xnodce;
  const zcosgl = Math.cos(zx);
  const zsingl = Math.sin(zx);

  let zcosg = ZCOSGS;
  let zsing = ZSINGS;
  let zcosi = ZCOSIS;
  let zsini = ZSINIS;
  let zcosh = cnodm;
  let zsinh = snodm;
  let cc = C1SS;
  const xnoi = 1 / nm;

  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let s5 = 0;
  let s6 = 0;
  let s7 = 0;
  let z1 = 0;
  let z2 = 0;
  let z3 = 0;
  let z11 = 0;
  let z12 = 0;
  let z13 = 0;
  let z21 = 0;
  let z22 = 0;
  let z23 = 0;
  let z31 = 0;
  let z32 = 0;
  let z33 = 0;
  let ss1 = 0;
  let ss2 = 0;
  let ss3 = 0;
  let ss4 = 0;
  let ss5 = 0;
  let ss6 = 0;
  let ss7 = 0;
  let sz1 = 0;
  let sz2 = 0;
  let sz3 = 0;
  let sz11 = 0;
  let sz12 = 0;
  let sz13 = 0;
  let sz21 = 0;
  let sz22 = 0;
  let sz23 = 0;
  let sz31 = 0;
  let sz32 = 0;
  let sz33 = 0;

  // First pass is the sun, second the moon: the same expressions with
  // different geometry, so the solar results are copied aside after pass one.
  for (let pass = 1; pass <= 2; pass += 1) {
    const a1 = zcosg * zcosh + zsing * zcosi * zsinh;
    const a3 = -zsing * zcosh + zcosg * zcosi * zsinh;
    const a7 = -zcosg * zsinh + zsing * zcosi * zcosh;
    const a8 = zsing * zsini;
    const a9 = zsing * zsinh + zcosg * zcosi * zcosh;
    const a10 = zcosg * zsini;
    const a2 = cosim * a7 + sinim * a8;
    const a4 = cosim * a9 + sinim * a10;
    const a5 = -sinim * a7 + cosim * a8;
    const a6 = -sinim * a9 + cosim * a10;

    const x1 = a1 * cosomm + a2 * sinomm;
    const x2 = a3 * cosomm + a4 * sinomm;
    const x3 = -a1 * sinomm + a2 * cosomm;
    const x4 = -a3 * sinomm + a4 * cosomm;
    const x5 = a5 * sinomm;
    const x6 = a6 * sinomm;
    const x7 = a5 * cosomm;
    const x8 = a6 * cosomm;

    z31 = 12 * x1 * x1 - 3 * x3 * x3;
    z32 = 24 * x1 * x2 - 6 * x3 * x4;
    z33 = 12 * x2 * x2 - 3 * x4 * x4;
    z1 = 3 * (a1 * a1 + a2 * a2) + z31 * emsq;
    z2 = 6 * (a1 * a3 + a2 * a4) + z32 * emsq;
    z3 = 3 * (a3 * a3 + a4 * a4) + z33 * emsq;
    z11 = -6 * a1 * a5 + emsq * (-24 * x1 * x7 - 6 * x3 * x5);
    z12 = -6 * (a1 * a6 + a3 * a5) + emsq * (-24 * (x2 * x7 + x1 * x8) - 6 * (x3 * x6 + x4 * x5));
    z13 = -6 * a3 * a6 + emsq * (-24 * x2 * x8 - 6 * x4 * x6);
    z21 = 6 * a2 * a5 + emsq * (24 * x1 * x5 - 6 * x3 * x7);
    z22 = 6 * (a4 * a5 + a2 * a6) + emsq * (24 * (x2 * x5 + x1 * x6) - 6 * (x4 * x7 + x3 * x8));
    z23 = 6 * a4 * a6 + emsq * (24 * x2 * x6 - 6 * x4 * x8);
    z1 = z1 + z1 + betasq * z31;
    z2 = z2 + z2 + betasq * z32;
    z3 = z3 + z3 + betasq * z33;
    s3 = cc * xnoi;
    s2 = (-0.5 * s3) / rtemsq;
    s4 = s3 * rtemsq;
    s1 = -15 * em * s4;
    s5 = x1 * x3 + x2 * x4;
    s6 = x2 * x3 + x1 * x4;
    s7 = x2 * x4 - x1 * x3;

    if (pass === 1) {
      ss1 = s1;
      ss2 = s2;
      ss3 = s3;
      ss4 = s4;
      ss5 = s5;
      ss6 = s6;
      ss7 = s7;
      sz1 = z1;
      sz2 = z2;
      sz3 = z3;
      sz11 = z11;
      sz12 = z12;
      sz13 = z13;
      sz21 = z21;
      sz22 = z22;
      sz23 = z23;
      sz31 = z31;
      sz32 = z32;
      sz33 = z33;
      zcosg = zcosgl;
      zsing = zsingl;
      zcosi = zcosil;
      zsini = zsinil;
      zcosh = zcoshl * cnodm + zsinhl * snodm;
      zsinh = snodm * zcoshl - cnodm * zsinhl;
      cc = C1L;
    }
  }

  sat.zmol = (4.7199672 + 0.2299715 * day - gam) % TWOPI;
  sat.zmos = (6.2565837 + 0.017201977 * day) % TWOPI;

  sat.se2 = 2 * ss1 * ss6;
  sat.se3 = 2 * ss1 * ss7;
  sat.si2 = 2 * ss2 * sz12;
  sat.si3 = 2 * ss2 * (sz13 - sz11);
  sat.sl2 = -2 * ss3 * sz2;
  sat.sl3 = -2 * ss3 * (sz3 - sz1);
  sat.sl4 = -2 * ss3 * (-21 - 9 * emsq) * ZES;
  sat.sgh2 = 2 * ss4 * sz32;
  sat.sgh3 = 2 * ss4 * (sz33 - sz31);
  sat.sgh4 = -18 * ss4 * ZES;
  sat.sh2 = -2 * ss2 * sz22;
  sat.sh3 = -2 * ss2 * (sz23 - sz21);

  sat.ee2 = 2 * s1 * s6;
  sat.e3 = 2 * s1 * s7;
  sat.xi2 = 2 * s2 * z12;
  sat.xi3 = 2 * s2 * (z13 - z11);
  sat.xl2 = -2 * s3 * z2;
  sat.xl3 = -2 * s3 * (z3 - z1);
  sat.xl4 = -2 * s3 * (-21 - 9 * emsq) * ZEL;
  sat.xgh2 = 2 * s4 * z32;
  sat.xgh3 = 2 * s4 * (z33 - z31);
  sat.xgh4 = -18 * s4 * ZEL;
  sat.xh2 = -2 * s2 * z22;
  sat.xh3 = -2 * s2 * (z23 - z21);

  return {
    sinim,
    cosim,
    em,
    emsq,
    nm,
    s1,
    s2,
    s3,
    s4,
    s5,
    ss1,
    ss2,
    ss3,
    ss4,
    ss5,
    sz1,
    sz3,
    sz11,
    sz13,
    sz21,
    sz23,
    sz31,
    sz33,
    z1,
    z3,
    z11,
    z13,
    z21,
    z23,
    z31,
    z33,
  };
}

/** Secular lunar-solar rates and resonance coefficients. */
export function dsinit(sat: Satrec, c: DeepCommon, xpidot: number, eccsq: number): void {
  const Q22 = 1.7891679e-6;
  const Q31 = 2.1460748e-6;
  const Q33 = 2.2123015e-7;
  const ROOT22 = 1.7891679e-6;
  const ROOT44 = 7.3636953e-9;
  const ROOT54 = 2.1765803e-9;
  const ROOT32 = 3.7393792e-7;
  const ROOT52 = 1.1428639e-7;

  const { cosim, sinim, s1, s2, s3, s4, s5, ss1, ss2, ss3, ss4, ss5 } = c;
  const { sz1, sz3, sz11, sz13, sz21, sz23, sz31, sz33 } = c;
  const { z1, z3, z11, z13, z21, z23, z31, z33 } = c;
  const emsq = c.emsq;
  const nm = c.nm;
  const em = c.em;

  sat.irez = 0;
  if (nm < 0.0052359877 && nm > 0.0034906585) sat.irez = 1;
  if (nm >= 8.26e-3 && nm <= 9.24e-3 && em >= 0.5) sat.irez = 2;

  const ses = ss1 * ZNS * ss5;
  const sis = ss2 * ZNS * (sz11 + sz13);
  const sls = -ZNS * ss3 * (sz1 + sz3 - 14 - 6 * emsq);
  const sghs = ss4 * ZNS * (sz31 + sz33 - 6);
  let shs = -ZNS * ss2 * (sz21 + sz23);
  const nearEquatorial = sat.inclo < 5.2359877e-2 || sat.inclo > PI - 5.2359877e-2;
  if (nearEquatorial) shs = 0;
  if (sinim !== 0) shs /= sinim;
  const sgs = sghs - cosim * shs;

  sat.dedt = ses + s1 * ZNL * s5;
  sat.didt = sis + s2 * ZNL * (z11 + z13);
  sat.dmdt = sls - ZNL * s3 * (z1 + z3 - 14 - 6 * emsq);
  const sghl = s4 * ZNL * (z31 + z33 - 6);
  let shll = -ZNL * s2 * (z21 + z23);
  if (nearEquatorial) shll = 0;
  sat.domdt = sgs + sghl;
  sat.dnodt = shs;
  if (sinim !== 0) {
    sat.domdt -= (cosim / sinim) * shll;
    sat.dnodt += shll / sinim;
  }

  if (sat.irez === 0) return;

  const theta = sat.gsto % TWOPI;
  const aonv = Math.pow(nm / XKE, X2O3);

  if (sat.irez === 2) {
    // Half-day resonance polynomials are fitted separately either side of
    // these eccentricity breaks, and they evaluate at the epoch eccentricity.
    const ec = sat.ecco;
    const ecsq = eccsq;
    const eoc = ec * ecsq;
    const cosisq = cosim * cosim;
    const g201 = -0.306 - (ec - 0.64) * 0.44;

    let g211: number;
    let g310: number;
    let g322: number;
    let g410: number;
    let g422: number;
    let g520: number;
    if (ec <= 0.65) {
      g211 = 3.616 - 13.247 * ec + 16.29 * ecsq;
      g310 = -19.302 + 117.39 * ec - 228.419 * ecsq + 156.591 * eoc;
      g322 = -18.9068 + 109.7927 * ec - 214.6334 * ecsq + 146.5816 * eoc;
      g410 = -41.122 + 242.694 * ec - 471.094 * ecsq + 313.953 * eoc;
      g422 = -146.407 + 841.88 * ec - 1629.014 * ecsq + 1083.435 * eoc;
      g520 = -532.114 + 3017.977 * ec - 5740.032 * ecsq + 3708.276 * eoc;
    } else {
      g211 = -72.099 + 331.819 * ec - 508.738 * ecsq + 266.724 * eoc;
      g310 = -346.844 + 1582.851 * ec - 2415.925 * ecsq + 1246.113 * eoc;
      g322 = -342.585 + 1554.908 * ec - 2366.899 * ecsq + 1215.972 * eoc;
      g410 = -1052.797 + 4758.686 * ec - 7193.992 * ecsq + 3651.957 * eoc;
      g422 = -3581.69 + 16178.11 * ec - 24462.77 * ecsq + 12422.52 * eoc;
      g520 =
        ec > 0.715
          ? -5149.66 + 29936.92 * ec - 54087.36 * ecsq + 31324.56 * eoc
          : 1464.74 - 4664.75 * ec + 3763.64 * ecsq;
    }

    let g533: number;
    let g521: number;
    let g532: number;
    if (ec < 0.7) {
      g533 = -919.2277 + 4988.61 * ec - 9064.77 * ecsq + 5542.21 * eoc;
      g521 = -822.71072 + 4568.6173 * ec - 8491.4146 * ecsq + 5337.524 * eoc;
      g532 = -853.666 + 4690.25 * ec - 8624.77 * ecsq + 5341.4 * eoc;
    } else {
      g533 = -37995.78 + 161616.52 * ec - 229838.2 * ecsq + 109377.94 * eoc;
      g521 = -51752.104 + 218913.95 * ec - 309468.16 * ecsq + 146349.42 * eoc;
      g532 = -40023.88 + 170470.89 * ec - 242699.48 * ecsq + 115605.82 * eoc;
    }

    const sini2 = sinim * sinim;
    const f220 = 0.75 * (1 + 2 * cosim + cosisq);
    const f221 = 1.5 * sini2;
    const f321 = 1.875 * sinim * (1 - 2 * cosim - 3 * cosisq);
    const f322 = -1.875 * sinim * (1 + 2 * cosim - 3 * cosisq);
    const f441 = 35 * sini2 * f220;
    const f442 = 39.375 * sini2 * sini2;
    const f522 =
      9.84375 *
      sinim *
      (sini2 * (1 - 2 * cosim - 5 * cosisq) + 0.33333333 * (-2 + 4 * cosim + 6 * cosisq));
    const f523 =
      sinim *
      (4.92187512 * sini2 * (-2 - 4 * cosim + 10 * cosisq) +
        6.56250012 * (1 + 2 * cosim - 3 * cosisq));
    const f542 = 29.53125 * sinim * (2 - 8 * cosim + cosisq * (-12 + 8 * cosim + 10 * cosisq));
    const f543 = 29.53125 * sinim * (-2 - 8 * cosim + cosisq * (12 + 8 * cosim - 10 * cosisq));

    const xno2 = nm * nm;
    const ainv2 = aonv * aonv;
    let temp1 = 3 * xno2 * ainv2;
    let temp = temp1 * ROOT22;
    sat.d2201 = temp * f220 * g201;
    sat.d2211 = temp * f221 * g211;
    temp1 *= aonv;
    temp = temp1 * ROOT32;
    sat.d3210 = temp * f321 * g310;
    sat.d3222 = temp * f322 * g322;
    temp1 *= aonv;
    temp = 2 * temp1 * ROOT44;
    sat.d4410 = temp * f441 * g410;
    sat.d4422 = temp * f442 * g422;
    temp1 *= aonv;
    temp = temp1 * ROOT52;
    sat.d5220 = temp * f522 * g520;
    sat.d5232 = temp * f523 * g532;
    temp = 2 * temp1 * ROOT54;
    sat.d5421 = temp * f542 * g521;
    sat.d5433 = temp * f543 * g533;
    sat.xlamo = (sat.mo + sat.nodeo + sat.nodeo - theta - theta) % TWOPI;
    sat.xfact = sat.mdot + sat.dmdt + 2 * (sat.nodedot + sat.dnodt - RPTIM) - sat.noUnkozai;
  } else {
    const g200 = 1 + emsq * (-2.5 + 0.8125 * emsq);
    const g310 = 1 + 2 * emsq;
    const g300 = 1 + emsq * (-6 + 6.60937 * emsq);
    const f220 = 0.75 * (1 + cosim) * (1 + cosim);
    const f311 = 0.9375 * sinim * sinim * (1 + 3 * cosim) - 0.75 * (1 + cosim);
    let f330 = 1 + cosim;
    f330 = 1.875 * f330 * f330 * f330;
    let del1 = 3 * nm * nm * aonv * aonv;
    sat.del2 = 2 * del1 * f220 * g200 * Q22;
    sat.del3 = 3 * del1 * f330 * g300 * Q33 * aonv;
    del1 = del1 * f311 * g310 * Q31 * aonv;
    sat.del1 = del1;
    sat.xlamo = (sat.mo + sat.nodeo + sat.argpo - theta) % TWOPI;
    sat.xfact = sat.mdot + xpidot - RPTIM + sat.dmdt + sat.domdt + sat.dnodt - sat.noUnkozai;
  }

  sat.xli = sat.xlamo;
  sat.xni = sat.noUnkozai;
  sat.atime = 0;
}

/** Mean elements after the secular and resonance terms, written by `dspace`. */
export interface DeepSecular {
  em: number;
  argpm: number;
  inclm: number;
  mm: number;
  nodem: number;
  nm: number;
}

/**
 * Applies deep-space secular rates and integrates the resonance terms.
 *
 * The integrator keeps its last state in `atime/xli/xni`, stepping 720 minutes
 * at a time from epoch, so ascending time is cheap and the grid is fixed. That
 * fixed grid makes the result path-independent: a given `t` lands on the same
 * values however the caller reached it, which is why stored state is safe to
 * reuse between keyframes and pass searches.
 */
export function dspace(sat: Satrec, t: number, s: DeepSecular): void {
  const FASX2 = 0.13130908;
  const FASX4 = 2.8843198;
  const FASX6 = 0.37448087;
  const G22 = 5.7686396;
  const G32 = 0.95240898;
  const G44 = 1.8014998;
  const G52 = 1.050833;
  const G54 = 4.4108898;
  const STEPP = 720;
  const STEP2 = 259200;

  const theta = (sat.gsto + t * RPTIM) % TWOPI;
  s.em += sat.dedt * t;
  s.inclm += sat.didt * t;
  s.argpm += sat.domdt * t;
  s.nodem += sat.dnodt * t;
  s.mm += sat.dmdt * t;

  if (sat.irez === 0) return;

  if (sat.atime === 0 || t * sat.atime <= 0 || Math.abs(t) < Math.abs(sat.atime)) {
    sat.atime = 0;
    sat.xni = sat.noUnkozai;
    sat.xli = sat.xlamo;
  }

  const delt = t > 0 ? STEPP : -STEPP;
  let xndt = 0;
  let xldot = 0;
  let xnddt = 0;
  let ft = 0;

  for (;;) {
    const xli = sat.xli;
    const xni = sat.xni;
    if (sat.irez !== 2) {
      xndt =
        sat.del1 * Math.sin(xli - FASX2) +
        sat.del2 * Math.sin(2 * (xli - FASX4)) +
        sat.del3 * Math.sin(3 * (xli - FASX6));
      xldot = xni + sat.xfact;
      xnddt =
        sat.del1 * Math.cos(xli - FASX2) +
        2 * sat.del2 * Math.cos(2 * (xli - FASX4)) +
        3 * sat.del3 * Math.cos(3 * (xli - FASX6));
    } else {
      const xomi = sat.argpo + sat.argpdot * sat.atime;
      const x2omi = xomi + xomi;
      const x2li = xli + xli;
      xndt =
        sat.d2201 * Math.sin(x2omi + xli - G22) +
        sat.d2211 * Math.sin(xli - G22) +
        sat.d3210 * Math.sin(xomi + xli - G32) +
        sat.d3222 * Math.sin(-xomi + xli - G32) +
        sat.d4410 * Math.sin(x2omi + x2li - G44) +
        sat.d4422 * Math.sin(x2li - G44) +
        sat.d5220 * Math.sin(xomi + xli - G52) +
        sat.d5232 * Math.sin(-xomi + xli - G52) +
        sat.d5421 * Math.sin(xomi + x2li - G54) +
        sat.d5433 * Math.sin(-xomi + x2li - G54);
      xldot = xni + sat.xfact;
      xnddt =
        sat.d2201 * Math.cos(x2omi + xli - G22) +
        sat.d2211 * Math.cos(xli - G22) +
        sat.d3210 * Math.cos(xomi + xli - G32) +
        sat.d3222 * Math.cos(-xomi + xli - G32) +
        sat.d5220 * Math.cos(xomi + xli - G52) +
        sat.d5232 * Math.cos(-xomi + xli - G52) +
        2 *
          (sat.d4410 * Math.cos(x2omi + x2li - G44) +
            sat.d4422 * Math.cos(x2li - G44) +
            sat.d5421 * Math.cos(xomi + x2li - G54) +
            sat.d5433 * Math.cos(-xomi + x2li - G54));
    }
    xnddt *= xldot;

    if (Math.abs(t - sat.atime) < STEPP) {
      ft = t - sat.atime;
      break;
    }
    sat.xli = xli + xldot * delt + xndt * STEP2;
    sat.xni = xni + xndt * delt + xnddt * STEP2;
    sat.atime += delt;
  }

  const nm = sat.xni + xndt * ft + xnddt * ft * ft * 0.5;
  const xl = sat.xli + xldot * ft + xndt * ft * ft * 0.5;
  s.mm = sat.irez !== 1 ? xl - 2 * s.nodem + 2 * theta : xl - s.nodem - s.argpm + theta;
  s.nm = nm;
}
