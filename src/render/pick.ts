import { hermite } from '../engine/hermite';
import { STRIDE } from '../engine/protocol';

export interface ProjectionInputs {
  /** Column-major view-projection matrix, as `Matrix4.elements`. */
  viewProjection: ArrayLike<number>;
  camera: readonly [number, number, number];
  widthPx: number;
  heightPx: number;
}

/**
 * True if the segment from the camera to a point in Earth radii enters the unit
 * sphere before reaching the point. Matches the test in the vertex shader.
 */
export function occludedByEarth(
  camera: readonly [number, number, number],
  x: number,
  y: number,
  z: number,
): boolean {
  const dx = x - camera[0];
  const dy = y - camera[1];
  const dz = z - camera[2];
  const a = dx * dx + dy * dy + dz * dz;
  const b = camera[0] * dx + camera[1] * dy + camera[2] * dz;
  const c = camera[0] * camera[0] + camera[1] * camera[1] + camera[2] * camera[2] - 1;
  const discriminant = b * b - a * c;
  if (discriminant <= 0) return false;
  const entry = (-b - Math.sqrt(discriminant)) / a;
  return entry > 0 && entry < 1;
}

/** Projects a world point to pixels, or returns false when behind the camera. */
export function project(
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  widthPx: number,
  heightPx: number,
  out: { x: number; y: number },
): boolean {
  const w = (m[3] as number) * x + (m[7] as number) * y + (m[11] as number) * z + (m[15] as number);
  if (w <= 0) return false;
  const cx = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
  const cy = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
  out.x = (cx / w + 1) * 0.5 * widthPx;
  out.y = (1 - cy / w) * 0.5 * heightPx;
  return true;
}

const point = { x: 0, y: 0 };

/**
 * Finds the visible satellite nearest a screen position.
 *
 * GPU colour-ID picking was rejected: `readPixels` stalls the pipeline, which
 * shows up as a hitch on every hover. A linear scan of 17 000 points takes well
 * under a millisecond and uses the same polynomial as the shader, so it agrees
 * with what is drawn without touching the GPU.
 */
export function pickNearest(
  from: Float32Array,
  to: Float32Array,
  categories: Uint8Array,
  visibleMask: number,
  u: number,
  spanSeconds: number,
  inputs: ProjectionInputs,
  mouseX: number,
  mouseY: number,
  radiusPx: number,
): number {
  const { viewProjection, camera, widthPx, heightPx } = inputs;
  const count = categories.length;
  let best = -1;
  let bestDistance = radiusPx * radiusPx;

  for (let i = 0; i < count; i += 1) {
    if (((visibleMask >> (categories[i] as number)) & 1) === 0) continue;
    const o = i * STRIDE;
    const x0 = from[o] as number;
    const y0 = from[o + 1] as number;
    const z0 = from[o + 2] as number;
    if (x0 === 0 && y0 === 0 && z0 === 0) continue;
    const x = hermite(
      x0,
      from[o + 3] as number,
      to[o] as number,
      to[o + 3] as number,
      u,
      spanSeconds,
    );
    const y = hermite(
      y0,
      from[o + 4] as number,
      to[o + 1] as number,
      to[o + 4] as number,
      u,
      spanSeconds,
    );
    const z = hermite(
      z0,
      from[o + 5] as number,
      to[o + 2] as number,
      to[o + 5] as number,
      u,
      spanSeconds,
    );
    if (!project(viewProjection, x, y, z, widthPx, heightPx, point)) continue;
    const dx = point.x - mouseX;
    const dy = point.y - mouseY;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance && !occludedByEarth(camera, x, y, z)) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}
