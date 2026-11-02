import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/engine/clock';
import { intervalSeconds, KeyframeScheduler, MAX_INTERVAL_S } from '../src/engine/scheduler';

/** A scheduler whose worker answers only when the test tells it to. */
function harness() {
  const requests: { timeMs: number; generation: number; target: Float32Array }[] = [];
  const scheduler = new KeyframeScheduler(6, (timeMs, generation, target) => {
    requests.push({ timeMs, generation, target });
  });
  const deliverNext = (): number | undefined => {
    const job = requests.shift();
    if (!job) return undefined;
    job.target.fill(job.timeMs);
    scheduler.deliver(job.timeMs, job.generation, job.target);
    return job.timeMs;
  };
  return { scheduler, requests, deliverNext };
}

/** Runs frames until both slots and the look-ahead keyframe are in place. */
function prime(h: ReturnType<typeof harness>, simMs: number, rate = 1): void {
  for (let i = 0; i < 3; i += 1) {
    h.scheduler.update(simMs, rate);
    h.deliverNext();
  }
  h.scheduler.update(simMs, rate);
}

describe('SimClock', () => {
  it('scales wall time by the rate', () => {
    const clock = new SimClock(1000, 0, 60);
    expect(clock.now(2)).toBe(1120);
  });

  it('keeps time continuous across a rate change', () => {
    const clock = new SimClock(0, 0, 10);
    clock.setRate(1000, 5);
    expect(clock.now(5)).toBe(50);
    expect(clock.now(6)).toBe(1050);
  });

  it('stands still when paused', () => {
    const clock = new SimClock(500, 0, 1);
    clock.setRate(0, 100);
    expect(clock.now(100000)).toBe(600);
  });
});

describe('keyframe spacing', () => {
  it('never drops below the floor at real time', () => {
    expect(intervalSeconds(1)).toBe(5);
    expect(intervalSeconds(0)).toBe(5);
  });

  it('grows with the time rate up to the limit the interpolation error allows', () => {
    expect(intervalSeconds(60)).toBe(15);
    expect(intervalSeconds(3600)).toBe(MAX_INTERVAL_S);
  });
});

describe('KeyframeScheduler', () => {
  it('reports not ready until both slots are filled', () => {
    const h = harness();
    expect(h.scheduler.update(0, 1).ready).toBe(false);
    h.deliverNext();
    expect(h.scheduler.update(0, 1).ready).toBe(false);
    h.deliverNext();
    expect(h.scheduler.update(0, 1).ready).toBe(true);
  });

  it('brackets the current time and interpolates across it', () => {
    const h = harness();
    prime(h, 0);
    const frame = h.scheduler.update(2500, 1);
    expect(frame.ready).toBe(true);
    expect(frame.u).toBeCloseTo(0.5, 9);
    expect(frame.spanSeconds).toBe(5);
  });

  it('keeps exactly one request in flight', () => {
    const h = harness();
    h.scheduler.update(0, 1);
    h.scheduler.update(0, 1);
    h.scheduler.update(0, 1);
    expect(h.requests).toHaveLength(1);
  });

  it('fetches the next keyframe before it is needed', () => {
    const h = harness();
    prime(h, 0);
    expect(h.deliverNext() ?? 10_000).toBe(10_000);
  });

  it('rotates without a gap when the look-ahead keyframe is ready', () => {
    const h = harness();
    prime(h, 0);
    const before = h.scheduler.update(4999, 1);
    const after = h.scheduler.update(5001, 1);
    expect(after.fromSlot).not.toBe(before.fromSlot);
    expect(after.u).toBeCloseTo(0.0002, 3);
    expect(h.scheduler.stalls).toBe(0);
  });

  it('marks only the replaced slot for upload', () => {
    const h = harness();
    prime(h, 0);
    h.scheduler.dirty[0] = false;
    h.scheduler.dirty[1] = false;
    h.scheduler.update(5001, 1);
    expect(h.scheduler.dirty).toEqual([true, false]);
  });

  it('counts a stall and holds at the last keyframe when the worker is late', () => {
    const h = harness();
    h.scheduler.update(0, 1);
    h.deliverNext();
    h.scheduler.update(0, 1);
    h.deliverNext();
    const frame = h.scheduler.update(6000, 1);
    expect(frame.u).toBe(1);
    expect(h.scheduler.stalls).toBe(1);
  });

  it('does not count a stall while paused', () => {
    const h = harness();
    prime(h, 0);
    h.scheduler.update(5000, 0);
    expect(h.scheduler.stalls).toBe(0);
  });

  it('restarts from the new time after a jump backwards', () => {
    const h = harness();
    prime(h, 100_000);
    h.requests.length = 0;
    expect(h.scheduler.update(0, 1).ready).toBe(false);
    prime(h, 0);
    expect(h.scheduler.update(0, 1).ready).toBe(true);
  });

  it('restarts after a jump far ahead', () => {
    const h = harness();
    prime(h, 0);
    expect(h.scheduler.update(10_000_000, 1).ready).toBe(false);
  });

  it('discards a result that was requested before a jump', () => {
    const h = harness();
    prime(h, 100_000);
    const stale = h.requests.shift();
    h.scheduler.update(0, 1);
    if (stale) {
      stale.target.fill(99);
      h.scheduler.deliver(stale.timeMs, stale.generation, stale.target);
    }
    expect(h.scheduler.slots[0]).toBeNull();
  });

  it('recycles buffers instead of allocating new ones in steady state', () => {
    const h = harness();
    prime(h, 0);
    const seen = new Set<Float32Array>();
    for (let t = 0; t < 60_000; t += 1000) {
      h.scheduler.update(t, 1);
      const job = h.requests[0];
      if (job) seen.add(job.target);
      h.deliverNext();
    }
    expect(seen.size).toBeLessThanOrEqual(4);
  });

  it('catches up through a jump in rate without dropping the timeline', () => {
    const h = harness();
    const rate = 3600;
    prime(h, 0, 1);
    let t = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      t += (rate * 1000) / 60;
      const state = h.scheduler.update(t, rate);
      h.deliverNext();
      expect(state.ready).toBe(true);
    }
    expect(h.scheduler.slots.every(Boolean)).toBe(true);
  });
});
