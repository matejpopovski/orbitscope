const CAPACITY = 240;

/** Fixed-size ring so measuring the frame loop never allocates in it. */
class Ring {
  private readonly values = new Float64Array(CAPACITY);
  private count = 0;
  private head = 0;

  push(value: number): void {
    this.values[this.head] = value;
    this.head = (this.head + 1) % CAPACITY;
    this.count = Math.min(this.count + 1, CAPACITY);
  }

  percentile(p: number): number {
    if (this.count === 0) return 0;
    const sorted = this.values.slice(0, this.count).sort();
    return sorted[Math.min(this.count - 1, Math.floor(p * this.count))] as number;
  }
}

export interface PerfSnapshot {
  frameMedianMs: number;
  frameP99Ms: number;
  cpuMedianMs: number;
  keyframeRoundTripMs: number;
  keyframeShardMs: number;
}

export class PerfMeter {
  private readonly frames = new Ring();
  private readonly cpu = new Ring();
  private readonly keyframes = new Ring();
  private readonly shards = new Ring();
  private last = 0;

  frame(wallMs: number, cpuMs: number): void {
    if (this.last !== 0) this.frames.push(wallMs - this.last);
    this.last = wallMs;
    this.cpu.push(cpuMs);
  }

  keyframe(roundTripMs: number, shardMs: number): void {
    this.keyframes.push(roundTripMs);
    this.shards.push(shardMs);
  }

  snapshot(): PerfSnapshot {
    return {
      frameMedianMs: this.frames.percentile(0.5),
      frameP99Ms: this.frames.percentile(0.99),
      cpuMedianMs: this.cpu.percentile(0.5),
      keyframeRoundTripMs: this.keyframes.percentile(0.5),
      keyframeShardMs: this.shards.percentile(0.5),
    };
  }
}
