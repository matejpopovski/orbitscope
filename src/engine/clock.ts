/**
 * Simulation time as a linear function of wall time. Keeping an anchor rather
 * than adding per-frame deltas means dropped frames cannot accumulate drift.
 */
export class SimClock {
  private anchorSimMs: number;
  private anchorWallMs: number;
  private currentRate: number;

  constructor(startSimMs: number, wallMs: number, rate = 1) {
    this.anchorSimMs = startSimMs;
    this.anchorWallMs = wallMs;
    this.currentRate = rate;
  }

  get rate(): number {
    return this.currentRate;
  }

  now(wallMs: number): number {
    return this.anchorSimMs + (wallMs - this.anchorWallMs) * this.currentRate;
  }

  setRate(rate: number, wallMs: number): void {
    this.anchorSimMs = this.now(wallMs);
    this.anchorWallMs = wallMs;
    this.currentRate = rate;
  }

  jump(simMs: number, wallMs: number): void {
    this.anchorSimMs = simMs;
    this.anchorWallMs = wallMs;
  }
}
