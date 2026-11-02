const TWOPI = 2 * Math.PI;
const DEG2RAD = Math.PI / 180;

/** A Julian date split so day-scale and sub-second parts keep their precision. */
export interface JulianDate {
  jd: number;
  frac: number;
}

export function jday(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): JulianDate {
  const jd =
    367 * year -
    Math.floor(7 * (year + Math.floor((month + 9) / 12)) * 0.25) +
    Math.floor((275 * month) / 9) +
    day +
    1721013.5;
  let frac = (second + minute * 60 + hour * 3600) / 86400;
  let whole = jd;
  if (Math.abs(frac) > 1) {
    const carry = Math.floor(frac);
    whole += carry;
    frac -= carry;
  }
  return { jd: whole, frac };
}

/** Converts a day-of-year epoch, as carried by TLEs, to a calendar time. */
export function days2mdhms(
  year: number,
  days: number,
): { month: number; day: number; hour: number; minute: number; second: number } {
  const lengths = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year % 4 === 0) lengths[2] = 29;
  const dayOfYear = Math.floor(days);
  let month = 1;
  let elapsed = 0;
  while (dayOfYear > elapsed + (lengths[month] as number) && month < 12) {
    elapsed += lengths[month] as number;
    month += 1;
  }
  let temp = (days - dayOfYear) * 24;
  const hour = Math.floor(temp);
  temp = (temp - hour) * 60;
  const minute = Math.floor(temp);
  const second = (temp - minute) * 60;
  return { month, day: dayOfYear - elapsed, hour, minute, second };
}

/**
 * Greenwich mean sidereal time (IAU 1982) in radians. This is the angle the
 * TEME frame is defined against, so it stays even though newer models exist.
 */
export function gstime(jdut1: number): number {
  const tut1 = (jdut1 - 2451545) / 36525;
  let temp =
    -6.2e-6 * tut1 * tut1 * tut1 +
    0.093104 * tut1 * tut1 +
    (876600 * 3600 + 8640184.812866) * tut1 +
    67310.54841;
  temp = ((temp * DEG2RAD) / 240) % TWOPI;
  return temp < 0 ? temp + TWOPI : temp;
}

export function jdFromUnixMs(ms: number): JulianDate {
  const days = ms / 86400000;
  const whole = Math.floor(days);
  return { jd: whole + 2440587.5, frac: days - whole };
}

export function unixMsFromJd(jd: number, frac: number): number {
  return (jd - 2440587.5 + frac) * 86400000;
}
