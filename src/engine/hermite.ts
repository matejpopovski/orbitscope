/**
 * Cubic Hermite interpolation between two keyframes of position and velocity.
 * The vertex shader in `render/satellites.ts` evaluates the same polynomial, so
 * picking and labels on the CPU land exactly where the GPU draws the dot.
 *
 * `h` is the keyframe spacing in the time unit of the velocities.
 */
export function hermite(
  p0: number,
  v0: number,
  p1: number,
  v1: number,
  u: number,
  h: number,
): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * p0 +
    (u3 - 2 * u2 + u) * h * v0 +
    (-2 * u3 + 3 * u2) * p1 +
    (u3 - u2) * h * v1
  );
}
