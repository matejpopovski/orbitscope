import { days2mdhms, jday } from '../astro/time';
import { DEG2RAD, TWOPI } from './constants';
import type { MeanElements } from './satrec';

const XPDOTP = 1440 / TWOPI;

function field(line: string, start: number, end: number): number {
  return Number.parseFloat(line.slice(start, end));
}

/** "ddddd-e" with an implied leading decimal point, as used for B* and nddot. */
function impliedDecimal(text: string): number {
  const compact = text.replace(/\s+/g, '');
  const match = /^([+-]?)(\d+)([+-]\d+)$/.exec(compact);
  if (!match) return 0;
  const [, sign, digits, exponent] = match;
  const mantissa = Number.parseFloat(`${sign}.${digits}`);
  return mantissa * Math.pow(10, Number.parseInt(exponent as string, 10));
}

/**
 * Parses a two-line element set. The site itself reads OMM records because TLE
 * cannot hold catalog numbers above 99999; this exists for the published
 * verification vectors, which are distributed as TLEs.
 */
export function parseTle(line1: string, line2: string): MeanElements {
  const shortYear = field(line1, 18, 20);
  const year = shortYear < 57 ? 2000 + shortYear : 1900 + shortYear;
  const days = field(line1, 20, 32);
  const { month, day, hour, minute, second } = days2mdhms(year, days);
  const { jd, frac } = jday(year, month, day, hour, minute, second);
  return {
    satnum: Number.parseInt(line1.slice(2, 7).trim(), 10),
    jdEpoch: jd,
    jdEpochFrac: frac,
    bstar: impliedDecimal(line1.slice(53, 61)),
    inclo: field(line2, 8, 16) * DEG2RAD,
    nodeo: field(line2, 17, 25) * DEG2RAD,
    ecco: Number.parseFloat(`.${line2.slice(26, 33).replace(/ /g, '0')}`),
    argpo: field(line2, 34, 42) * DEG2RAD,
    mo: field(line2, 43, 51) * DEG2RAD,
    noKozai: field(line2, 52, 63) / XPDOTP,
  };
}

/** One record of a CCSDS OMM in CelesTrak's JSON keys. */
export interface OmmRecord {
  NORAD_CAT_ID: number;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  BSTAR: number;
}

const ISO_EPOCH = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/;

export function ommToElements(record: OmmRecord): MeanElements {
  const match = ISO_EPOCH.exec(record.EPOCH);
  if (!match) throw new Error(`unparseable OMM epoch: ${record.EPOCH}`);
  const [, y, mo, d, h, mi, s] = match;
  const { jd, frac } = jday(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s));
  return {
    satnum: record.NORAD_CAT_ID,
    jdEpoch: jd,
    jdEpochFrac: frac,
    bstar: record.BSTAR,
    ecco: record.ECCENTRICITY,
    argpo: record.ARG_OF_PERICENTER * DEG2RAD,
    inclo: record.INCLINATION * DEG2RAD,
    mo: record.MEAN_ANOMALY * DEG2RAD,
    noKozai: record.MEAN_MOTION / XPDOTP,
    nodeo: record.RA_OF_ASC_NODE * DEG2RAD,
  };
}
