import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { STRIDE } from '../src/engine/protocol';
import { cullLabels, type LabelCandidate } from '../src/render/label-culling';
import { occludedByEarth, pickNearest, project, type ProjectionInputs } from '../src/render/pick';

const WIDTH = 1000;
const HEIGHT = 1000;

function inputs(): ProjectionInputs {
  const camera = new PerspectiveCamera(40, 1, 0.01, 100);
  camera.position.set(0, -6, 0);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const viewProjection = new Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .toArray();
  return { viewProjection, camera: [0, -6, 0], widthPx: WIDTH, heightPx: HEIGHT };
}

function positions(points: [number, number, number][]): Float32Array {
  const data = new Float32Array(points.length * STRIDE);
  points.forEach((p, i) => data.set(p, i * STRIDE));
  return data;
}

describe('occlusion by Earth', () => {
  const camera = [0, -6, 0] as const;

  it('hides a satellite directly behind the planet', () => {
    expect(occludedByEarth(camera, 0, 2, 0)).toBe(true);
  });

  it('shows one in front of the planet', () => {
    expect(occludedByEarth(camera, 0, -2, 0)).toBe(false);
  });

  it('shows one beyond the limb', () => {
    expect(occludedByEarth(camera, 1.5, 2, 0)).toBe(false);
  });
});

describe('projection', () => {
  it('sends the world origin to the viewport centre', () => {
    const point = { x: 0, y: 0 };
    expect(project(inputs().viewProjection, 0, 0, 0, WIDTH, HEIGHT, point)).toBe(true);
    expect(point.x).toBeCloseTo(500, 6);
    expect(point.y).toBeCloseTo(500, 6);
  });

  it('agrees with three.js', () => {
    const { viewProjection } = inputs();
    const point = { x: 0, y: 0 };
    project(viewProjection, 0.7, 0.3, -0.4, WIDTH, HEIGHT, point);
    const ndc = new Vector3(0.7, 0.3, -0.4).applyMatrix4(new Matrix4().fromArray(viewProjection));
    expect(point.x).toBeCloseTo(((ndc.x + 1) / 2) * WIDTH, 6);
    expect(point.y).toBeCloseTo(((1 - ndc.y) / 2) * HEIGHT, 6);
  });

  it('rejects points behind the camera', () => {
    expect(project(inputs().viewProjection, 0, -9, 0, WIDTH, HEIGHT, { x: 0, y: 0 })).toBe(false);
  });
});

describe('pickNearest', () => {
  const data = positions([
    [1.5, 0, 0],
    [-1.5, 0, 0],
    [0, 3, 0],
  ]);
  const categories = new Uint8Array([0, 1, 0]);
  const screen = (x: number, y: number, z: number): { x: number; y: number } => {
    const point = { x: 0, y: 0 };
    project(inputs().viewProjection, x, y, z, WIDTH, HEIGHT, point);
    return point;
  };
  const pick = (mx: number, my: number, mask = 0b11, radius = 12): number =>
    pickNearest(data, data, categories, mask, 0, 1, inputs(), mx, my, radius);

  it('picks the satellite under the cursor', () => {
    const { x, y } = screen(1.5, 0, 0);
    expect(pick(x + 3, y - 3)).toBe(0);
  });

  it('returns nothing outside the radius', () => {
    const { x, y } = screen(1.5, 0, 0);
    expect(pick(x + 40, y)).toBe(-1);
  });

  it('skips categories filtered out of view', () => {
    const { x, y } = screen(-1.5, 0, 0);
    expect(pick(x, y)).toBe(1);
    expect(pick(x, y, 0b01)).toBe(-1);
  });

  it('skips a satellite hidden behind Earth', () => {
    const { x, y } = screen(0, 3, 0);
    expect(pick(x, y)).toBe(-1);
  });

  it('skips objects that failed to propagate', () => {
    const failed = positions([[0, 0, 0]]);
    const none = pickNearest(failed, failed, new Uint8Array([0]), 1, 0, 1, inputs(), 500, 500, 50);
    expect(none).toBe(-1);
  });
});

describe('label culling', () => {
  const label = (x: number, y: number, priority: number): LabelCandidate => ({
    x,
    y,
    width: 60,
    height: 12,
    priority,
  });

  it('keeps separated labels', () => {
    const result = cullLabels([label(10, 10, 0), label(200, 200, 1)], WIDTH, HEIGHT, 10);
    expect(result.kept).toHaveLength(2);
  });

  it('gives an overlap to the higher priority label', () => {
    const result = cullLabels([label(100, 100, 5), label(110, 102, 1)], WIDTH, HEIGHT, 10);
    expect(result.kept).toEqual([1]);
    expect(result.overlapped).toBe(1);
  });

  it('drops labels outside the viewport', () => {
    const result = cullLabels([label(-5, 10, 0), label(990, 10, 0)], WIDTH, HEIGHT, 10);
    expect(result.kept).toEqual([]);
    expect(result.offscreen).toBe(2);
  });

  it('keeps labels out of UI panels', () => {
    const panel = { left: 0, top: 0, right: 300, bottom: 300 };
    const result = cullLabels([label(100, 100, 0), label(500, 500, 1)], WIDTH, HEIGHT, 10, [panel]);
    expect(result.kept).toEqual([1]);
  });

  it('stops at the limit, in priority order', () => {
    const many = Array.from({ length: 20 }, (_, i) => label(i * 90, 50 * i, 19 - i));
    const result = cullLabels(many, 5000, 5000, 3);
    expect(result.kept).toEqual([19, 18, 17]);
  });
});
