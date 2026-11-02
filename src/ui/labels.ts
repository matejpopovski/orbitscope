import type { Stage } from '../render/stage';
import {
  cullLabels,
  LABEL_OFFSET_X,
  LABEL_OFFSET_Y,
  type LabelCandidate,
  type ScreenRect,
} from '../render/label-culling';
import { occludedByEarth, project } from '../render/pick';

export interface LabelTarget {
  index: number;
  text: string;
  priority: number;
}

const MAX_LABELS = 24;
const CHAR_WIDTH_PX = 6.4;
const LABEL_HEIGHT_PX = 13;

export interface LabelStats {
  candidates: number;
  occluded: number;
  offscreen: number;
  overlapped: number;
  shown: number;
}

const point = { x: 0, y: 0 };

/**
 * Name labels for a short list of well-known satellites. Elements are pooled and
 * only moved with transforms, so a frame touches no layout. Candidates are
 * rejected in order of cost: behind Earth, then off screen, then overlapping.
 */
export class LabelLayer {
  private readonly pool: HTMLDivElement[] = [];
  private readonly boxes: LabelCandidate[] = [];
  private readonly boxTargets: { target: LabelTarget; x: number; y: number }[] = [];
  private shownLast = 0;
  stats: LabelStats = { candidates: 0, occluded: 0, offscreen: 0, overlapped: 0, shown: 0 };

  constructor(
    overlay: HTMLElement,
    private readonly targets: readonly LabelTarget[],
  ) {
    for (let i = 0; i < MAX_LABELS; i += 1) {
      const element = document.createElement('div');
      element.className = 'label';
      element.hidden = true;
      overlay.append(element);
      this.pool.push(element);
    }
  }

  update(
    stage: Stage,
    position: (index: number) => readonly [number, number, number] | null,
    visible: (index: number) => boolean,
    blocked: readonly ScreenRect[],
  ): void {
    const camera = stage.camera.position;
    const cameraTuple = [camera.x, camera.y, camera.z] as const;
    const matrix = stage.viewProjection.elements;
    this.boxes.length = 0;
    this.boxTargets.length = 0;
    let occluded = 0;

    for (const target of this.targets) {
      if (!visible(target.index)) continue;
      const p = position(target.index);
      if (!p) continue;
      if (occludedByEarth(cameraTuple, p[0], p[1], p[2])) {
        occluded += 1;
        continue;
      }
      if (!project(matrix, p[0], p[1], p[2], stage.widthPx, stage.heightPx, point)) {
        occluded += 1;
        continue;
      }
      this.boxes.push({
        x: point.x,
        y: point.y,
        width: target.text.length * CHAR_WIDTH_PX,
        height: LABEL_HEIGHT_PX,
        priority: target.priority,
      });
      this.boxTargets.push({ target, x: point.x, y: point.y });
    }

    const result = cullLabels(this.boxes, stage.widthPx, stage.heightPx, MAX_LABELS, blocked);
    result.kept.forEach((boxIndex, i) => {
      const element = this.pool[i] as HTMLDivElement;
      const placed = this.boxTargets[boxIndex] as (typeof this.boxTargets)[number];
      if (element.textContent !== placed.target.text) element.textContent = placed.target.text;
      element.hidden = false;
      element.style.transform = `translate3d(${placed.x + LABEL_OFFSET_X}px, ${placed.y + LABEL_OFFSET_Y}px, 0)`;
    });
    for (let i = result.kept.length; i < this.shownLast; i += 1) {
      (this.pool[i] as HTMLDivElement).hidden = true;
    }
    this.shownLast = result.kept.length;
    this.stats = {
      candidates: this.targets.length,
      occluded,
      offscreen: result.offscreen,
      overlapped: result.overlapped,
      shown: result.kept.length,
    };
  }
}

export function notableTargets(names: readonly string[]): LabelTarget[] {
  const targets: LabelTarget[] = [];
  NOTABLE.forEach((pattern, priority) => {
    const index = names.findIndex((name) => pattern.test(name));
    if (index >= 0) {
      targets.push({ index, text: names[index] as string, priority });
    }
  });
  return targets;
}

const NOTABLE: readonly RegExp[] = [
  /^ISS \(ZARYA\)/,
  /^CSS \(TIANHE\)/,
  /^HST$/,
  /^CXO$/,
  /^XMM-NEWTON/,
  /^TERRA$/,
  /^AQUA$/,
  /^AURA$/,
  /^LANDSAT 8/,
  /^LANDSAT 9/,
  /^NOAA 20/,
  /^NOAA 21/,
  /^SENTINEL-2A/,
  /^SENTINEL-2B/,
  /^SENTINEL-1A/,
  /^JASON-3/,
  /^GOES 16/,
  /^GOES 18/,
  /^GOES 19/,
  /^HIMAWARI-9/,
  /^METEOSAT-12/,
  /^INTELSAT 39/,
  /^TDRS 13/,
  /^NAVSTAR 8\d/,
  /^GSAT0219/,
  /^BEIDOU-3 M1/,
  /^QZS-2/,
  /^O3B FM01/,
];
