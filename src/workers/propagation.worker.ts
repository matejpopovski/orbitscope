import type { PropagationReply, PropagationRequest } from '../engine/protocol';
import { propagateShard } from '../engine/shard';
import { ommToElements, sgp4init, type Satrec } from '../sgp4';

let sats: Satrec[] = [];

const reply = (message: PropagationReply, transfer: Transferable[] = []): void => {
  (self as unknown as Worker).postMessage(message, transfer);
};

self.onmessage = (event: MessageEvent<PropagationRequest>) => {
  const message = event.data;
  if (message.type === 'init') {
    const start = performance.now();
    sats = message.records.map((record) => sgp4init(ommToElements(record)));
    reply({ type: 'ready', initMs: performance.now() - start });
    return;
  }
  const start = performance.now();
  const failed = propagateShard(sats, message.jd, message.frac, new Float32Array(message.buffer));
  reply(
    {
      type: 'keyframe',
      id: message.id,
      buffer: message.buffer,
      failed,
      elapsedMs: performance.now() - start,
    },
    [message.buffer],
  );
};
