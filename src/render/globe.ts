import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  RepeatWrapping,
  ShaderMaterial,
  Texture,
  TextureLoader,
  Uniform,
  Vector3,
  type Scene,
  type WebGLRenderer,
} from 'three';

/**
 * A unit sphere with Z through the poles and X through Greenwich. Generated
 * rather than taken from SphereGeometry, which is Y-up, so that Earth-fixed
 * coordinates are mesh coordinates and rotating by GMST is all it takes to
 * place Earth in TEME.
 */
function earthGeometry(rings: number, segments: number): BufferGeometry {
  const positions = new Float32Array((rings + 1) * (segments + 1) * 3);
  const uvs = new Float32Array((rings + 1) * (segments + 1) * 2);
  const indices = new Uint32Array(rings * segments * 6);

  let vertex = 0;
  for (let i = 0; i <= rings; i += 1) {
    const lat = -Math.PI / 2 + (Math.PI * i) / rings;
    for (let j = 0; j <= segments; j += 1) {
      const lon = -Math.PI + (2 * Math.PI * j) / segments;
      positions[vertex * 3] = Math.cos(lat) * Math.cos(lon);
      positions[vertex * 3 + 1] = Math.cos(lat) * Math.sin(lon);
      positions[vertex * 3 + 2] = Math.sin(lat);
      uvs[vertex * 2] = j / segments;
      uvs[vertex * 2 + 1] = i / rings;
      vertex += 1;
    }
  }

  let index = 0;
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = i * (segments + 1) + j;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices[index] = a;
      indices[index + 1] = b;
      indices[index + 2] = d;
      indices[index + 3] = a;
      indices[index + 4] = d;
      indices[index + 5] = c;
      index += 6;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

const EARTH_VERTEX = /* glsl */ `
  out vec2 vUv;
  out vec3 vNormal;
  out vec3 vWorld;
  void main() {
    vUv = uv;
    vNormal = mat3(modelMatrix) * position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const EARTH_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform vec3 uSun;
  in vec2 vUv;
  in vec3 vNormal;
  in vec3 vWorld;
  out vec4 fragColor;

  float graticule(float degrees, float spacing) {
    float distance = abs(fract(degrees / spacing - 0.5) - 0.5) * spacing;
    float width = fwidth(degrees);
    return 1.0 - smoothstep(0.0, 1.4 * width, distance);
  }

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 toCamera = normalize(cameraPosition - vWorld);
    float sun = dot(normal, uSun);
    float daylight = smoothstep(-0.10, 0.16, sun);

    // The imagery is graded dark and cool: this is a backdrop for the satellites.
    vec3 day = texture(uDay, vUv).rgb;
    day = pow(day, vec3(1.1)) * vec3(0.78, 0.88, 1.0);
    day *= 0.42 + 0.78 * max(sun, 0.0);

    vec3 lights = texture(uNight, vUv).rgb;
    lights = pow(lights, vec3(1.6)) * vec3(1.45, 1.15, 0.80);
    vec3 night = vec3(0.012, 0.022, 0.040) + lights;

    vec3 color = mix(night, day, daylight);

    float lon = vUv.x * 360.0;
    float lat = vUv.y * 180.0;
    float lines = max(graticule(lon, 30.0), graticule(lat, 30.0));
    color += lines * vec3(0.05, 0.11, 0.16);

    float rim = pow(1.0 - max(dot(normal, toCamera), 0.0), 3.5);
    color += rim * vec3(0.10, 0.26, 0.42) * (0.25 + 0.75 * daylight);

    fragColor = vec4(color, 1.0);
  }
`;

const HALO_VERTEX = /* glsl */ `
  out vec3 vNormal;
  out vec3 vWorld;
  void main() {
    vNormal = normalize(position);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const HALO_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uSun;
  in vec3 vNormal;
  in vec3 vWorld;
  out vec4 fragColor;
  void main() {
    vec3 toCamera = normalize(cameraPosition - vWorld);
    float limb = 1.0 - abs(dot(normalize(vNormal), toCamera));
    float glow = pow(max(limb - 0.62, 0.0) / 0.38, 3.0);
    float daylight = 0.25 + 0.75 * smoothstep(-0.3, 0.4, dot(normalize(vNormal), uSun));
    vec3 color = vec3(0.16, 0.42, 0.78) * glow * daylight;
    fragColor = vec4(color, 1.0);
  }
`;

export class Globe {
  readonly group = new Group();
  private readonly halo: Mesh;
  private readonly sun = new Uniform(new Vector3(1, 0, 0));

  constructor(scene: Scene, renderer: WebGLRenderer, baseUrl: string) {
    const loader = new TextureLoader();
    const anisotropy = renderer.capabilities.getMaxAnisotropy();
    const load = (name: string): Texture => {
      const texture = loader.load(`${baseUrl}textures/${name}`);
      texture.anisotropy = anisotropy;
      texture.wrapS = RepeatWrapping;
      texture.minFilter = LinearMipmapLinearFilter;
      texture.magFilter = LinearFilter;
      return texture;
    };

    const earth = new Mesh(
      earthGeometry(128, 256),
      new ShaderMaterial({
        glslVersion: '300 es',
        vertexShader: EARTH_VERTEX,
        fragmentShader: EARTH_FRAGMENT,
        uniforms: {
          uDay: new Uniform(load('earth-day.jpg')),
          uNight: new Uniform(load('earth-night.jpg')),
          uSun: this.sun,
        },
      }),
    );
    this.group.add(earth);
    scene.add(this.group);

    this.halo = new Mesh(
      earthGeometry(48, 96),
      new ShaderMaterial({
        glslVersion: '300 es',
        vertexShader: HALO_VERTEX,
        fragmentShader: HALO_FRAGMENT,
        uniforms: { uSun: this.sun },
        side: BackSide,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.halo.scale.setScalar(1.035);
    scene.add(this.halo);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    this.halo.visible = visible;
  }

  /** Places Earth for a sidereal angle and a sun direction in TEME. */
  update(gmst: number, sun: readonly [number, number, number]): void {
    this.group.rotation.z = gmst;
    this.sun.value.set(sun[0], sun[1], sun[2]);
  }
}
