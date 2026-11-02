/**
 * Propagator state for one satellite.
 *
 * Field names follow Hoots & Roehrich and Vallado's reference code on purpose.
 * Anyone auditing this against the published theory needs to match names like
 * `cc4` and `d5421` line by line, and friendlier names would break that.
 *
 * Every field is declared with a numeric initial value so all instances share
 * one V8 hidden class. Propagation runs across thousands of these in a tight
 * loop, and a polymorphic shape there is measurably slower.
 */
export class Satrec {
  satnum = 0;
  jdEpoch = 0;
  jdEpochFrac = 0;

  bstar = 0;
  ecco = 0;
  argpo = 0;
  inclo = 0;
  mo = 0;
  noKozai = 0;
  nodeo = 0;
  noUnkozai = 0;

  /** Simplified drag equations, used for perigee under 220 km and deep space. */
  isimp = false;
  /** Period of 225 minutes or more selects the SDP4 deep-space terms. */
  deep = false;

  aycof = 0;
  con41 = 0;
  cc1 = 0;
  cc4 = 0;
  cc5 = 0;
  d2 = 0;
  d3 = 0;
  d4 = 0;
  delmo = 0;
  eta = 0;
  argpdot = 0;
  omgcof = 0;
  sinmao = 0;
  t2cof = 0;
  t3cof = 0;
  t4cof = 0;
  t5cof = 0;
  x1mth2 = 0;
  x7thm1 = 0;
  mdot = 0;
  nodedot = 0;
  xlcof = 0;
  xmcof = 0;
  nodecf = 0;

  /** 0 none, 1 one-day resonance (GEO), 2 half-day resonance (Molniya). */
  irez = 0;
  d2201 = 0;
  d2211 = 0;
  d3210 = 0;
  d3222 = 0;
  d4410 = 0;
  d4422 = 0;
  d5220 = 0;
  d5232 = 0;
  d5421 = 0;
  d5433 = 0;
  dedt = 0;
  del1 = 0;
  del2 = 0;
  del3 = 0;
  didt = 0;
  dmdt = 0;
  dnodt = 0;
  domdt = 0;
  e3 = 0;
  ee2 = 0;
  se2 = 0;
  se3 = 0;
  sgh2 = 0;
  sgh3 = 0;
  sgh4 = 0;
  sh2 = 0;
  sh3 = 0;
  si2 = 0;
  si3 = 0;
  sl2 = 0;
  sl3 = 0;
  sl4 = 0;
  gsto = 0;
  xfact = 0;
  xgh2 = 0;
  xgh3 = 0;
  xgh4 = 0;
  xh2 = 0;
  xh3 = 0;
  xi2 = 0;
  xi3 = 0;
  xl2 = 0;
  xl3 = 0;
  xl4 = 0;
  xlamo = 0;
  zmol = 0;
  zmos = 0;
  atime = 0;
  xli = 0;
  xni = 0;

  /** Result of `sgp4init`'s check at epoch. Non-zero means the record is unusable. */
  error = 0;
}

/** Inputs to `sgp4init`, in the units the theory uses. */
export interface MeanElements {
  satnum: number;
  jdEpoch: number;
  jdEpochFrac: number;
  bstar: number;
  ecco: number;
  /** Radians. */
  argpo: number;
  /** Radians. */
  inclo: number;
  /** Radians. */
  mo: number;
  /** Radians per minute, Kozai convention as carried by GP data. */
  noKozai: number;
  /** Radians. */
  nodeo: number;
}

/**
 * Codes returned by `sgp4`, matching the published reference code. Code 5 from
 * the original (epoch elements are sub-orbital) was retired upstream and is not
 * produced here either.
 */
export const SGP4_ERRORS: Readonly<Record<number, string>> = {
  1: 'mean eccentricity out of range',
  2: 'mean motion is not positive',
  3: 'perturbed eccentricity out of range',
  4: 'semi-latus rectum is negative',
  6: 'orbit has decayed',
};
