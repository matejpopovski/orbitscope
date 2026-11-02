import { jdFromUnixMs } from '../astro/time';
import type { OmmRecord } from '../sgp4';
import { STRIDE, type PropagationReply, type PropagationRequest } from './protocol';

interface Shard {
  worker: Worker;
  start: number;
  count: number;
  /** Null while the worker owns it. */
  buffer: ArrayBuffer | null;
}

export interface KeyframeTiming {
  /** Wall time from request to the last shard arriving. */
  roundTripMs: number;
  /** Slowest worker's propagation time, excluding messaging. */
  slowestShardMs: number;
  failed: number;
}

interface Pending {
  remaining: number;
  target: Float32Array;
  startedAt: number;
  slowestShardMs: number;
  failed: number;
  done: (timing: KeyframeTiming) => void;
}

/**
 * A fixed set of workers, each owning one contiguous slice of the catalog.
 *
 * SharedArrayBuffer would avoid the copy back into the keyframe, but it needs
 * COOP and COEP response headers and GitHub Pages cannot set headers. So each
 * shard's buffer is transferred to its worker and back, which is allocation-free
 * and costs one memcpy of the result.
 */
export class PropagationPool {
  private readonly shards: Shard[] = [];
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;

  readonly ready: Promise<number>;
  /** Called if a worker dies after start-up, when no promise is left to reject. */
  onFailure: (message: string) => void = () => undefined;

  constructor(records: OmmRecord[], workerCount: number) {
    const count = records.length;
    const perShard = Math.ceil(count / workerCount);
    const initialised: Promise<number>[] = [];

    for (let index = 0; index < workerCount; index += 1) {
      const start = index * perShard;
      const slice = records.slice(start, start + perShard);
      const worker = new Worker(new URL('../workers/propagation.worker.ts', import.meta.url), {
        type: 'module',
      });
      const shard: Shard = {
        worker,
        start,
        count: slice.length,
        buffer: new ArrayBuffer(slice.length * STRIDE * Float32Array.BYTES_PER_ELEMENT),
      };
      this.shards.push(shard);

      initialised.push(
        new Promise((resolve, reject) => {
          worker.onerror = (event) => {
            reject(new Error(event.message));
            this.onFailure(event.message);
          };
          worker.onmessage = (event: MessageEvent<PropagationReply>) => {
            const message = event.data;
            if (message.type === 'ready') resolve(message.initMs);
            else this.onKeyframe(shard, message);
          };
        }),
      );
      const init: PropagationRequest = { type: 'init', records: slice };
      worker.postMessage(init);
    }

    this.ready = Promise.all(initialised).then((times) => Math.max(...times));
  }

  private onKeyframe(shard: Shard, message: Extract<PropagationReply, { type: 'keyframe' }>): void {
    shard.buffer = message.buffer;
    const job = this.pending.get(message.id);
    if (!job) return;
    job.target.set(new Float32Array(message.buffer), shard.start * STRIDE);
    job.failed += message.failed;
    job.slowestShardMs = Math.max(job.slowestShardMs, message.elapsedMs);
    job.remaining -= 1;
    if (job.remaining === 0) {
      this.pending.delete(message.id);
      job.done({
        roundTripMs: performance.now() - job.startedAt,
        slowestShardMs: job.slowestShardMs,
        failed: job.failed,
      });
    }
  }

  /** Fills `target` for a time. Callers wait for `done` before asking again. */
  propagate(timeMs: number, target: Float32Array, done: (timing: KeyframeTiming) => void): void {
    const { jd, frac } = jdFromUnixMs(timeMs);
    const id = this.nextId;
    this.nextId += 1;
    this.pending.set(id, {
      remaining: this.shards.length,
      target,
      startedAt: performance.now(),
      slowestShardMs: 0,
      failed: 0,
      done,
    });
    for (const shard of this.shards) {
      const buffer = shard.buffer;
      if (!buffer) throw new Error('propagate called while a keyframe is in flight');
      shard.buffer = null;
      const request: PropagationRequest = { type: 'propagate', id, jd, frac, buffer };
      shard.worker.postMessage(request, [buffer]);
    }
  }

  dispose(): void {
    for (const shard of this.shards) shard.worker.terminate();
  }
}
