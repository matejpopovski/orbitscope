import { geodeticToEcef, lookAngles, temeToEcef, type Geodetic, type Vec3 } from '../astro/frames';
import { isSunlit, sunDirection } from '../astro/sun';
import { gstime, jdFromUnixMs } from '../astro/time';
import { minutesSinceEpoch, RADIUS_EARTH_KM, sgp4, type Satrec } from '../sgp4';

export interface Pass {
  /** Unix ms. When `startsInProgress`, this is the search start, not a real rise. */
  aosMs: number;
  tcaMs: number;
  /** Unix ms. When `endsInProgress`, this is the search end, not a real set. */
  losMs: number;
  maxElevationDeg: number;
  aosAzimuthDeg: number;
  tcaAzimuthDeg: number;
  losAzimuthDeg: number;
  startsInProgress: boolean;
  endsInProgress: boolean;
  /** Satellite sunlit at closest approach while the observer is in darkness. */
  visible: boolean;
}

export interface PassOptions {
  horizonHours?: number;
  minElevationDeg?: number;
  maxPasses?: number;
}

/** Elevation of the sun below which the sky counts as dark enough to see a satellite. */
const DARK_SKY_SUN_ELEVATION_DEG = -6;
const TIME_TOLERANCE_MS = 100;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

const scratch = new Float64Array(6);

interface Sample {
  elevationDeg: number;
  azimuthDeg: number;
}

/**
 * Finds passes of `sat` over `observer` from `startMs` onwards.
 *
 * A fixed sweep by itself would miss a grazing pass shorter than its step, and
 * a smaller step costs every pass to protect a rare one. So the sweep also
 * treats any local maximum of elevation as a candidate, and refines it even
 * when no sample reached the mask. Elevation is smooth over the step, so a
 * short pass cannot hide between samples without producing that local maximum.
 */
export function predictPasses(
  sat: Satrec,
  observer: Geodetic,
  startMs: number,
  options: PassOptions = {},
): Pass[] {
  const horizonHours = options.horizonHours ?? 48;
  const minElevationDeg = options.minElevationDeg ?? 0;
  const maxPasses = options.maxPasses ?? 12;

  const observerEcef = geodeticToEcef(observer);
  const sample = (ms: number): Sample | null => {
    const { jd, frac } = jdFromUnixMs(ms);
    const code = sgp4(sat, minutesSinceEpoch(sat, jd, frac), scratch, 0);
    if (code !== 0) return null;
    const r: Vec3 = [scratch[0] as number, scratch[1] as number, scratch[2] as number];
    const look = lookAngles(observer, observerEcef, temeToEcef(r, gstime(jd + frac)));
    return { elevationDeg: look.elevationDeg, azimuthDeg: look.azimuthDeg };
  };
  const margin = (ms: number): number => (sample(ms)?.elevationDeg ?? -90) - minElevationDeg;

  // A LEO pass never lasts under a few tens of seconds at any useful mask, and
  // deep-space geometry changes slowly even near a Molniya perigee.
  const stepMs = sat.deep ? 120_000 : 30_000;
  const endMs = startMs + horizonHours * 3_600_000;

  const crossing = (below: number, above: number): number => {
    let lo = below;
    let hi = above;
    while (Math.abs(hi - lo) > TIME_TOLERANCE_MS) {
      const mid = (lo + hi) / 2;
      if (margin(mid) > 0) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };

  const peak = (from: number, to: number): number => {
    let a = from;
    let b = to;
    let c = b - GOLDEN * (b - a);
    let d = a + GOLDEN * (b - a);
    let fc = margin(c);
    let fd = margin(d);
    while (b - a > TIME_TOLERANCE_MS) {
      if (fc > fd) {
        b = d;
        d = c;
        fd = fc;
        c = b - GOLDEN * (b - a);
        fc = margin(c);
      } else {
        a = c;
        c = d;
        fc = fd;
        d = a + GOLDEN * (b - a);
        fd = margin(d);
      }
    }
    return (a + b) / 2;
  };

  const passes: Pass[] = [];

  const finish = (
    aosMs: number,
    losMs: number,
    tcaMs: number,
    startsInProgress: boolean,
    endsInProgress: boolean,
  ): void => {
    const aos = sample(aosMs);
    const tca = sample(tcaMs);
    const los = sample(losMs);
    if (!aos || !tca || !los) return;
    passes.push({
      aosMs,
      tcaMs,
      losMs,
      maxElevationDeg: tca.elevationDeg,
      aosAzimuthDeg: aos.azimuthDeg,
      tcaAzimuthDeg: tca.azimuthDeg,
      losAzimuthDeg: los.azimuthDeg,
      startsInProgress,
      endsInProgress,
      visible: isVisible(sat, observer, observerEcef, tcaMs),
    });
  };

  let t = startMs;
  let current = margin(t);
  let previous = Number.NaN;
  let inPass = current > 0;
  let aosMs = t;
  let startsInProgress = inPass;
  let bestMs = t;
  let best = current;

  while (t < endMs && passes.length < maxPasses) {
    const next = Math.min(t + stepMs, endMs);
    const nextSample = sample(next);
    if (!nextSample) break;
    const value = nextSample.elevationDeg - minElevationDeg;

    if (inPass) {
      if (value > best) {
        best = value;
        bestMs = next;
      }
      if (value <= 0) {
        const losMs = crossing(next, t);
        const tcaMs = peak(Math.max(aosMs, bestMs - stepMs), Math.min(losMs, bestMs + stepMs));
        finish(aosMs, losMs, tcaMs, startsInProgress, false);
        inPass = false;
        startsInProgress = false;
      }
    } else if (value > 0) {
      aosMs = crossing(t, next);
      inPass = true;
      best = value;
      bestMs = next;
    } else if (previous <= current && current >= value) {
      const tcaMs = peak(t - stepMs, next);
      if (margin(tcaMs) > 0) {
        finish(crossing(t - stepMs, tcaMs), crossing(next, tcaMs), tcaMs, false, false);
      }
    }

    previous = current;
    current = value;
    t = next;
  }

  if (inPass && passes.length < maxPasses) {
    const tcaMs = peak(Math.max(aosMs, bestMs - stepMs), Math.min(endMs, bestMs + stepMs));
    finish(aosMs, endMs, tcaMs, startsInProgress, true);
  }
  return passes;
}

function isVisible(sat: Satrec, observer: Geodetic, observerEcef: Vec3, ms: number): boolean {
  const { jd, frac } = jdFromUnixMs(ms);
  if (sgp4(sat, minutesSinceEpoch(sat, jd, frac), scratch, 0) !== 0) return false;
  const sun = sunDirection(jd, frac);
  const r: Vec3 = [scratch[0] as number, scratch[1] as number, scratch[2] as number];
  if (!isSunlit(r, sun, RADIUS_EARTH_KM)) return false;

  const gmst = gstime(jd + frac);
  const astronomicalUnitKm = 149_597_870.7;
  const sunEcef = temeToEcef(
    [sun[0] * astronomicalUnitKm, sun[1] * astronomicalUnitKm, sun[2] * astronomicalUnitKm],
    gmst,
  );
  return lookAngles(observer, observerEcef, sunEcef).elevationDeg < DARK_SKY_SUN_ELEVATION_DEG;
}
