import type { OmmRecord } from '../sgp4';
import type { Geodetic } from '../astro/frames';
import type { Pass, PassOptions } from '../passes/predictor';

/** Floats per satellite in a keyframe: position then velocity. */
export const STRIDE = 6;

export type PropagationRequest =
  | { type: 'init'; records: OmmRecord[] }
  | { type: 'propagate'; id: number; jd: number; frac: number; buffer: ArrayBuffer };

export type PropagationReply =
  | { type: 'ready'; initMs: number }
  | { type: 'keyframe'; id: number; buffer: ArrayBuffer; failed: number; elapsedMs: number };

export interface PassRequest {
  id: number;
  record: OmmRecord;
  observer: Geodetic;
  startMs: number;
  options: PassOptions;
}

export interface PassReply {
  id: number;
  passes: Pass[];
  elapsedMs: number;
}
