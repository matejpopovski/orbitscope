// WGS-72 is not a choice to modernise: GP element sets are fitted with these
// constants, so propagating them with WGS-84 values adds error rather than
// removing it.
export const RADIUS_EARTH_KM = 6378.135;
export const MU_KM3_S2 = 398600.8;
export const XKE =
  60 / Math.sqrt((RADIUS_EARTH_KM * RADIUS_EARTH_KM * RADIUS_EARTH_KM) / MU_KM3_S2);
export const TUMIN = 1 / XKE;
export const J2 = 0.001082616;
export const J3 = -0.00000253881;
export const J4 = -0.00000165597;
export const J3OJ2 = J3 / J2;

export const PI = Math.PI;
export const TWOPI = 2 * Math.PI;
export const DEG2RAD = Math.PI / 180;
export const X2O3 = 2 / 3;
export const VKMPERSEC = (RADIUS_EARTH_KM * XKE) / 60;

/** Modified-epoch origin used by SGP4: days from 1949 December 31 00:00 UT. */
export const JD_1950 = 2433281.5;
