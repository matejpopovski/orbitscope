import { minutesSinceEpoch, RADIUS_EARTH_KM, sgp4, type Satrec } from '../sgp4';
import { STRIDE } from './protocol';

const state = new Float64Array(6);

/**
 * Propagates a shard into `target` as Earth radii and Earth radii per second,
 * the units of the scene. Float32 resolves about 0.8 m in LEO and 3 m at GEO,
 * well under a pixel at any zoom the app allows. A failed object is written as
 * the origin, which the vertex shader treats as "do not draw".
 */
export function propagateShard(
  sats: readonly Satrec[],
  jd: number,
  frac: number,
  target: Float32Array,
): number {
  const scale = 1 / RADIUS_EARTH_KM;
  let failed = 0;
  for (let i = 0; i < sats.length; i += 1) {
    const sat = sats[i] as Satrec;
    const offset = i * STRIDE;
    if (sgp4(sat, minutesSinceEpoch(sat, jd, frac), state, 0) === 0) {
      target[offset] = (state[0] as number) * scale;
      target[offset + 1] = (state[1] as number) * scale;
      target[offset + 2] = (state[2] as number) * scale;
      target[offset + 3] = (state[3] as number) * scale;
      target[offset + 4] = (state[4] as number) * scale;
      target[offset + 5] = (state[5] as number) * scale;
    } else {
      target.fill(0, offset, offset + STRIDE);
      failed += 1;
    }
  }
  return failed;
}
