import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
} from 'three';
import { STRIDE } from '../engine/protocol';
import type { FrameState } from '../engine/scheduler';

const VERTEX = /* glsl */ `
  precision highp float;
  precision highp int;

  in vec3 aPosA;
  in vec3 aVelA;
  in vec3 aPosB;
  in vec3 aVelB;
  in float aCategory;

  uniform bool uFlip;
  uniform float uU;
  uniform float uSpan;
  uniform int uMask;
  uniform vec3 uCamera;
  uniform vec2 uViewport;
  uniform float uPointPx;
  uniform vec3 uPalette[8];

  out vec2 vCorner;
  out vec3 vColor;

  // Must stay identical to src/engine/hermite.ts: picking relies on it.
  vec3 hermite(vec3 p0, vec3 v0, vec3 p1, vec3 v1, float u, float h) {
    float u2 = u * u;
    float u3 = u2 * u;
    return (2.0 * u3 - 3.0 * u2 + 1.0) * p0
      + (u3 - 2.0 * u2 + u) * h * v0
      + (-2.0 * u3 + 3.0 * u2) * p1
      + (u3 - u2) * h * v1;
  }

  // Past the clip volume, so the rasterizer drops the whole quad.
  const vec4 CULLED = vec4(2.0, 2.0, 2.0, 1.0);

  void main() {
    vec3 p0 = uFlip ? aPosB : aPosA;
    vec3 v0 = uFlip ? aVelB : aVelA;
    vec3 p1 = uFlip ? aPosA : aPosB;
    vec3 v1 = uFlip ? aVelA : aVelB;

    int category = int(aCategory);
    bool filtered = ((uMask >> category) & 1) == 0;
    // Propagation failures are written as the origin.
    bool failed = dot(p0, p0) < 0.25;
    if (filtered || failed) {
      gl_Position = CULLED;
      return;
    }

    vec3 position = hermite(p0, v0, p1, v1, uU, uSpan);

    // Rejecting here saves fragment work on the far side of the planet, where
    // about half the catalog is at any moment.
    vec3 ray = position - uCamera;
    float a = dot(ray, ray);
    float b = dot(uCamera, ray);
    float c = dot(uCamera, uCamera) - 1.0;
    float discriminant = b * b - a * c;
    if (discriminant > 0.0) {
      float entry = (-b - sqrt(discriminant)) / a;
      if (entry > 0.0 && entry < 1.0) {
        gl_Position = CULLED;
        return;
      }
    }

    vec4 clip = projectionMatrix * viewMatrix * vec4(position, 1.0);
    vec2 reach = abs(clip.xy) - clip.w;
    if (clip.w <= 0.0 || reach.x > 0.05 * clip.w || reach.y > 0.05 * clip.w) {
      gl_Position = CULLED;
      return;
    }

    vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
    vCorner = corner;
    vColor = uPalette[category];
    clip.xy += corner * uPointPx * clip.w / uViewport * 2.0;
    gl_Position = clip;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uIntensity;
  in vec2 vCorner;
  in vec3 vColor;
  out vec4 fragColor;
  void main() {
    float d = length(vCorner);
    if (d > 1.0) discard;
    float core = 1.0 - smoothstep(0.2, 1.0, d);
    fragColor = vec4(vColor * core * uIntensity, core);
  }
`;

/** One GPU-instanced quad per satellite, positioned entirely in the vertex shader. */
export class SatelliteField {
  readonly mesh: Mesh;
  private readonly buffers: [InstancedInterleavedBuffer, InstancedInterleavedBuffer];
  private readonly material: ShaderMaterial;
  private readonly uniforms = {
    uFlip: new Uniform(false),
    uU: new Uniform(0),
    uSpan: new Uniform(1),
    uMask: new Uniform(0xff),
    uCamera: new Uniform(new Vector3()),
    uViewport: new Uniform(new Vector2(1, 1)),
    uPointPx: new Uniform(1.6),
    uIntensity: new Uniform(0.8),
    uPalette: new Uniform<Vector3[]>([]),
  };

  constructor(count: number, categories: Uint8Array, palette: readonly string[]) {
    const geometry = new InstancedBufferGeometry();
    // Corners come from gl_VertexID; this attribute only sets the vertex count.
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    geometry.setIndex([0, 1, 3, 0, 3, 2]);
    geometry.instanceCount = count;

    const slot = (): InstancedInterleavedBuffer => {
      const buffer = new InstancedInterleavedBuffer(new Float32Array(count * STRIDE), STRIDE);
      buffer.setUsage(DynamicDrawUsage);
      return buffer;
    };
    this.buffers = [slot(), slot()];
    const [a, b] = this.buffers;
    geometry.setAttribute('aPosA', new InterleavedBufferAttribute(a, 3, 0));
    geometry.setAttribute('aVelA', new InterleavedBufferAttribute(a, 3, 3));
    geometry.setAttribute('aPosB', new InterleavedBufferAttribute(b, 3, 0));
    geometry.setAttribute('aVelB', new InterleavedBufferAttribute(b, 3, 3));
    geometry.setAttribute(
      'aCategory',
      new InstancedBufferAttribute(Float32Array.from(categories), 1),
    );

    this.uniforms.uPalette.value = palette.map((hex) => {
      const c = new Color().setStyle(hex, 'srgb-linear');
      return new Vector3(c.r, c.g, c.b);
    });
    while (this.uniforms.uPalette.value.length < 8) {
      this.uniforms.uPalette.value.push(new Vector3());
    }

    this.material = new ShaderMaterial({
      glslVersion: '300 es',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.mesh = new Mesh(geometry, this.material);
    // The vertex shader moves everything, so the geometry's bounds mean nothing.
    this.mesh.frustumCulled = false;
  }

  upload(slot: 0 | 1, data: Float32Array): void {
    const buffer = this.buffers[slot];
    (buffer.array as Float32Array).set(data);
    buffer.needsUpdate = true;
  }

  setFrame(frame: FrameState): void {
    this.uniforms.uFlip.value = frame.fromSlot === 1;
    this.uniforms.uU.value = frame.u;
    this.uniforms.uSpan.value = frame.spanSeconds;
  }

  setCamera(x: number, y: number, z: number): void {
    this.uniforms.uCamera.value.set(x, y, z);
  }

  setViewport(width: number, height: number): void {
    this.uniforms.uViewport.value.set(width, height);
  }

  setPointSize(pixels: number, intensity: number): void {
    this.uniforms.uPointPx.value = pixels;
    this.uniforms.uIntensity.value = intensity;
  }

  setMask(mask: number): void {
    this.uniforms.uMask.value = mask;
  }
}
