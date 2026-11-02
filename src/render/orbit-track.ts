import type { Group } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

function fadedLine(width: number, opacity: number): Line2 {
  const material = new LineMaterial({
    linewidth: width,
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const line = new Line2(new LineGeometry(), material);
  line.frustumCulled = false;
  line.visible = false;
  return line;
}

/** Colours each point by how far it is from the middle of the line. */
function fadeColors(points: number, r: number, g: number, b: number): Float32Array {
  const colors = new Float32Array(points * 3);
  for (let i = 0; i < points; i += 1) {
    const distance = Math.abs(i / (points - 1) - 0.5) * 2;
    const fade = 1 - 0.8 * distance;
    colors[i * 3] = r * fade;
    colors[i * 3 + 1] = g * fade;
    colors[i * 3 + 2] = b * fade;
  }
  return colors;
}

/**
 * The selected satellite's orbit in the inertial frame and its ground track in
 * the Earth-fixed frame. Each is a child of the frame it is defined in, so the
 * ground track rotates with the planet without being recomputed every frame.
 */
export class OrbitTrack {
  private readonly orbit = fadedLine(1.6, 0.9);
  private readonly ground = fadedLine(1.2, 0.55);

  constructor(inertial: Group, earthFixed: Group) {
    inertial.add(this.orbit);
    earthFixed.add(this.ground);
  }

  private static assign(line: Line2, points: Float32Array, color: [number, number, number]): void {
    const count = points.length / 3;
    if (count < 2) {
      line.visible = false;
      return;
    }
    const geometry = new LineGeometry();
    geometry.setPositions(points);
    geometry.setColors(fadeColors(count, ...color));
    line.geometry.dispose();
    line.geometry = geometry;
    line.computeLineDistances();
    line.visible = true;
  }

  setPaths(orbitPoints: Float32Array, groundPoints: Float32Array): void {
    OrbitTrack.assign(this.orbit, orbitPoints, [0.35, 0.82, 1]);
    OrbitTrack.assign(this.ground, groundPoints, [1, 0.72, 0.32]);
  }

  hide(): void {
    this.orbit.visible = false;
    this.ground.visible = false;
  }
}
