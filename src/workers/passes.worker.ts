import type { PassReply, PassRequest } from '../engine/protocol';
import { predictPasses } from '../passes/predictor';
import { ommToElements, sgp4init } from '../sgp4';

self.onmessage = (event: MessageEvent<PassRequest>) => {
  const { id, record, observer, startMs, options } = event.data;
  const start = performance.now();
  const passes = predictPasses(sgp4init(ommToElements(record)), observer, startMs, options);
  const message: PassReply = { id, passes, elapsedMs: performance.now() - start };
  (self as unknown as Worker).postMessage(message);
};
