/**
 * Decides which keyframes must exist for a given simulation time.
 *
 * Two keyframes sit on the GPU and bracket the current time, and a third waits
 * on the CPU so that crossing the upper one never blocks on a worker. Each frame
 * then only advances `u`, whatever the object count.
 */

export const MIN_INTERVAL_S = 5;
/** Worst-case interpolation error at this spacing is in results/interpolation.json. */
export const MAX_INTERVAL_S = 120;
/** Wall-clock gap between keyframes when the interval is not clamped. */
const TARGET_WALL_INTERVAL_S = 0.25;
/** Falling this many intervals behind is treated as a jump, not a slow worker. */
const LOST_AFTER_SPANS = 4;

export function intervalSeconds(rate: number): number {
  const wanted = Math.abs(rate) * TARGET_WALL_INTERVAL_S;
  return Math.min(MAX_INTERVAL_S, Math.max(MIN_INTERVAL_S, wanted));
}

export interface Keyframe {
  timeMs: number;
  data: Float32Array;
}

export interface FrameState {
  /** False until both bracketing keyframes exist. */
  ready: boolean;
  /** Which GPU slot holds the older keyframe. */
  fromSlot: 0 | 1;
  /** Position between keyframes, in 0..1. */
  u: number;
  /** Time between the bracketing keyframes in seconds. */
  spanSeconds: number;
}

export type KeyframeRequest = (timeMs: number, generation: number, target: Float32Array) => void;

export class KeyframeScheduler {
  /** GPU slots. `dirty` marks those the renderer must upload. */
  readonly slots: [Keyframe | null, Keyframe | null] = [null, null];
  readonly dirty: [boolean, boolean] = [false, false];

  private fromSlot: 0 | 1 = 0;
  private queued: Keyframe | null = null;
  private inFlight = false;
  /** Results requested before a jump belong to a timeline that no longer exists. */
  private generation = 0;
  private readonly spares: Float32Array[] = [];

  /** Frames that needed a keyframe before a worker had delivered it. */
  stalls = 0;

  constructor(
    private readonly floats: number,
    private readonly request: KeyframeRequest,
  ) {}

  private get toSlot(): 0 | 1 {
    return this.fromSlot === 0 ? 1 : 0;
  }

  /** Hands back a buffer a worker has finished filling. */
  deliver(timeMs: number, generation: number, data: Float32Array): void {
    this.inFlight = false;
    if (generation !== this.generation) {
      this.spares.push(data);
      return;
    }
    const keyframe = { timeMs, data };
    if (!this.slots[0]) this.store(0, keyframe);
    else if (!this.slots[1]) this.store(1, keyframe);
    else this.queued = keyframe;
  }

  private store(slot: 0 | 1, keyframe: Keyframe): void {
    const old = this.slots[slot];
    if (old) this.spares.push(old.data);
    this.slots[slot] = keyframe;
    this.dirty[slot] = true;
  }

  private ask(timeMs: number): void {
    this.inFlight = true;
    this.request(timeMs, this.generation, this.spares.pop() ?? new Float32Array(this.floats));
  }

  private rotate(simMs: number): void {
    let to = this.slots[this.toSlot];
    while (to && this.queued && simMs >= to.timeMs) {
      this.store(this.fromSlot, this.queued);
      this.queued = null;
      this.fromSlot = this.toSlot;
      to = this.slots[this.toSlot];
    }
  }

  private dropTimeline(): void {
    this.generation += 1;
    for (const slot of [0, 1] as const) {
      const old = this.slots[slot];
      if (old) this.spares.push(old.data);
      this.slots[slot] = null;
    }
    if (this.queued) {
      this.spares.push(this.queued.data);
      this.queued = null;
    }
    this.fromSlot = 0;
  }

  private refill(simMs: number, spanMs: number): void {
    if (this.inFlight) return;
    const first = this.slots[0];
    const second = this.slots[1];
    if (!first) {
      this.ask(simMs);
    } else if (!second) {
      this.ask(first.timeMs + spanMs);
    } else if (!this.queued) {
      this.ask((this.slots[this.toSlot] as Keyframe).timeMs + spanMs);
    }
  }

  update(simMs: number, rate: number): FrameState {
    const spanMs = intervalSeconds(rate) * 1000;
    this.rotate(simMs);

    let from = this.slots[this.fromSlot];
    let to = this.slots[this.toSlot];
    if (from && to && (simMs < from.timeMs || simMs > to.timeMs + LOST_AFTER_SPANS * spanMs)) {
      this.dropTimeline();
      from = null;
      to = null;
    }

    this.refill(simMs, spanMs);

    if (!from || !to) {
      return { ready: false, fromSlot: this.fromSlot, u: 0, spanSeconds: 1 };
    }
    if (simMs > to.timeMs && rate !== 0) this.stalls += 1;

    const bracketMs = to.timeMs - from.timeMs;
    return {
      ready: true,
      fromSlot: this.fromSlot,
      u: Math.min(1, Math.max(0, (simMs - from.timeMs) / bracketMs)),
      spanSeconds: bracketMs / 1000,
    };
  }
}
