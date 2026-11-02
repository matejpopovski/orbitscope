import {
  Group,
  LinearSRGBColorSpace,
  Matrix4,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MIN_CAMERA_DISTANCE = 1.25;
const MAX_CAMERA_DISTANCE = 40;

/** Renderer, camera and controls. World space is TEME in Earth radii, Z up. */
export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly inertial = new Group();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly viewProjection = new Matrix4();
  readonly gl: WebGL2RenderingContext;
  widthPx = 1;
  heightPx = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Shaders here work directly in display values, so no output transform.
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.setClearColor(0x04070c);

    this.camera = new PerspectiveCamera(32, 1, 0.02, 200);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(5.2, -4.2, 2.1);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = MIN_CAMERA_DISTANCE;
    this.controls.maxDistance = MAX_CAMERA_DISTANCE;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.8;

    this.scene.add(this.inertial);
  }

  resize(width: number, height: number): void {
    this.widthPx = width;
    this.heightPx = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Call once per frame before anything reads the camera. */
  updateCamera(): void {
    this.controls.update();
    this.camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
  }

  get cameraDistance(): number {
    return this.camera.position.length();
  }
}
