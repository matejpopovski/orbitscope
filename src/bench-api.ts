import type { LabelStats } from './ui/labels';
import type { PerfSnapshot } from './ui/perf';

export interface BenchRecording {
  frameMs: number[];
  cpuMs: number[];
  gpuMs: number[];
  stalls: number;
  keyframe: PerfSnapshot;
  labels: LabelStats;
  failed: number;
}

/**
 * The surface browser tests drive. It exists only with `?bench` in the URL, so
 * ordinary visits do not carry it.
 */
export interface BenchApi {
  objects: number;
  workers: number;
  renderer: string;
  gpuTimerSupported: boolean;
  ready(): boolean;
  selectByCatalogNumber(id: number): number;
  setRate(rate: number): void;
  setCamera(x: number, y: number, z: number): void;
  setMask(mask: number): void;
  setEarthVisible(visible: boolean): void;
  /** Interpolation state of the frame just drawn. */
  frame(): { u: number; spanSeconds: number };
  projectCategory(category: number): { x: number; y: number }[];
  startRecording(): void;
  stopRecording(): BenchRecording;
  pickTimings(samples: number): number[];
}

declare global {
  interface Window {
    __orbitscope: BenchApi;
  }
}
