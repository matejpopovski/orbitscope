import {
  ecefToGeodetic,
  geodeticToEcef,
  lookAngles,
  temeToEcef,
  type Geodetic,
  type LookAngles,
  type Vec3,
} from '../astro/frames';
import { isSunlit, sunDirection } from '../astro/sun';
import { gstime, jdFromUnixMs } from '../astro/time';
import type { CatalogEntry } from '../catalog/snapshot';
import {
  minutesSinceEpoch,
  ommToElements,
  periodMinutes,
  RADIUS_EARTH_KM,
  sgp4,
  sgp4init,
  type Satrec,
} from '../sgp4';

/** Line segments per revolution. Enough to look round at any zoom in the app. */
const PATH_POINTS = 240;
/** Lifts the ground track off the sphere so it wins the depth test cleanly. */
const GROUND_TRACK_RADIUS = 1.003;

export interface Telemetry {
  geodetic: Geodetic;
  speedKmS: number;
  sunlit: boolean;
  look: LookAngles;
}

const state = new Float64Array(6);

/** A satellite under inspection. Runs on the main thread: it is one object. */
export class Selection {
  readonly sat: Satrec;
  readonly periodMin: number;

  constructor(
    readonly entry: CatalogEntry,
    readonly index: number,
  ) {
    this.sat = sgp4init(ommToElements(entry));
    this.periodMin = periodMinutes(this.sat);
  }

  private propagate(ms: number): { r: Vec3; gmst: number; jd: number; frac: number } | null {
    const { jd, frac } = jdFromUnixMs(ms);
    if (sgp4(this.sat, minutesSinceEpoch(this.sat, jd, frac), state, 0) !== 0) return null;
    const r: Vec3 = [state[0] as number, state[1] as number, state[2] as number];
    return { r, gmst: gstime(jd + frac), jd, frac };
  }

  telemetry(simMs: number, observer: Geodetic): Telemetry | null {
    const now = this.propagate(simMs);
    if (!now) return null;
    const speedKmS = Math.hypot(state[3] as number, state[4] as number, state[5] as number);
    const ecef = temeToEcef(now.r, now.gmst);
    return {
      geodetic: ecefToGeodetic(ecef),
      speedKmS,
      sunlit: isSunlit(now.r, sunDirection(now.jd, now.frac), RADIUS_EARTH_KM),
      look: lookAngles(observer, geodeticToEcef(observer), ecef),
    };
  }

  /** Position in Earth radii in TEME for the screen-space marker. */
  positionEr(simMs: number): Vec3 | null {
    const now = this.propagate(simMs);
    if (!now) return null;
    const k = 1 / RADIUS_EARTH_KM;
    return [now.r[0] * k, now.r[1] * k, now.r[2] * k];
  }

  /**
   * One revolution centred on `simMs`: the inertial orbit, and the same samples
   * as a ground track. Sampling stops at the first failure so a decaying object
   * draws as far as it stays valid instead of spiking through the origin.
   */
  paths(simMs: number): { orbit: Float32Array; ground: Float32Array } {
    const orbit = new Float32Array((PATH_POINTS + 1) * 3);
    const ground = new Float32Array((PATH_POINTS + 1) * 3);
    const periodMs = this.periodMin * 60_000;
    const k = 1 / RADIUS_EARTH_KM;
    let written = 0;
    for (let i = 0; i <= PATH_POINTS; i += 1) {
      const ms = simMs + (i / PATH_POINTS - 0.5) * periodMs;
      const sample = this.propagate(ms);
      if (!sample) {
        if (written === 0) continue;
        break;
      }
      const offset = written * 3;
      orbit[offset] = sample.r[0] * k;
      orbit[offset + 1] = sample.r[1] * k;
      orbit[offset + 2] = sample.r[2] * k;
      const fixed = temeToEcef(sample.r, sample.gmst);
      const norm = GROUND_TRACK_RADIUS / Math.hypot(fixed[0], fixed[1], fixed[2]);
      ground[offset] = fixed[0] * norm;
      ground[offset + 1] = fixed[1] * norm;
      ground[offset + 2] = fixed[2] * norm;
      written += 1;
    }
    return { orbit: orbit.subarray(0, written * 3), ground: ground.subarray(0, written * 3) };
  }
}
