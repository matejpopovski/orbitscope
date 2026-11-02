export interface LabelCandidate {
  /** Pixel position of the satellite the label belongs to. */
  x: number;
  y: number;
  /** Label box size in pixels. */
  width: number;
  height: number;
  /** Lower draws first and so wins any overlap. */
  priority: number;
}

/** A screen rectangle labels must stay out of, such as a UI panel. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CullResult {
  kept: number[];
  offscreen: number;
  overlapped: number;
}

const OFFSET_X = 8;
const OFFSET_Y = -6;
const MARGIN = 3;

function intersects(a: ScreenRect, b: ScreenRect): boolean {
  return (
    a.left < b.right + MARGIN &&
    a.right + MARGIN > b.left &&
    a.top < b.bottom + MARGIN &&
    a.bottom + MARGIN > b.top
  );
}

/**
 * Greedy screen-space culling. Candidates are taken in priority order and any
 * label overlapping one already placed is dropped, which keeps a stable set of
 * important names on screen as the view moves. Occlusion by Earth is decided by
 * the caller before candidates get here.
 */
export function cullLabels(
  candidates: readonly LabelCandidate[],
  viewportWidth: number,
  viewportHeight: number,
  limit: number,
  blocked: readonly ScreenRect[] = [],
): CullResult {
  const order = candidates.map((_, i) => i);
  order.sort(
    (a, b) =>
      (candidates[a] as LabelCandidate).priority - (candidates[b] as LabelCandidate).priority,
  );

  const kept: number[] = [];
  const placed: ScreenRect[] = [];
  let offscreen = 0;
  let overlapped = 0;

  for (const index of order) {
    const c = candidates[index] as LabelCandidate;
    const left = c.x + OFFSET_X;
    const top = c.y + OFFSET_Y;
    const right = left + c.width;
    const bottom = top + c.height;
    const box = { left, top, right, bottom };
    const covered = blocked.some((b) => intersects(box, b));
    if (c.x < 0 || c.y < 0 || right > viewportWidth || bottom > viewportHeight || covered) {
      offscreen += 1;
      continue;
    }
    if (kept.length >= limit) {
      overlapped += 1;
      continue;
    }
    if (placed.some((p) => intersects(box, p))) {
      overlapped += 1;
      continue;
    }
    placed.push(box);
    kept.push(index);
  }
  return { kept, offscreen, overlapped };
}

export { OFFSET_X as LABEL_OFFSET_X, OFFSET_Y as LABEL_OFFSET_Y };
