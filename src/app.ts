import { gstime, jdFromUnixMs } from './astro/time';
import './bench-api';
import { sunDirection } from './astro/sun';
import type { Geodetic } from './astro/frames';
import { CATEGORIES, classify } from './catalog/classify';
import type { CatalogEntry, SnapshotManifest } from './catalog/snapshot';
import { SimClock } from './engine/clock';
import { hermite } from './engine/hermite';
import { PropagationPool, type KeyframeTiming } from './engine/pool';
import { STRIDE, type PassReply, type PassRequest } from './engine/protocol';
import { KeyframeScheduler, type FrameState } from './engine/scheduler';
import { Selection } from './engine/selection';
import { Globe } from './render/globe';
import { GpuTimer } from './render/gpu-timer';
import type { ScreenRect } from './render/label-culling';
import { OrbitTrack } from './render/orbit-track';
import { occludedByEarth, pickNearest, project } from './render/pick';
import { SatelliteField } from './render/satellites';
import { Stage } from './render/stage';
import { PALETTE, renderCategories, wireSearch } from './ui/catalog-panel';
import { formatRate, formatUtc } from './ui/format';
import { LabelLayer, notableTargets } from './ui/labels';
import { PerfMeter } from './ui/perf';
import { TrackPanel } from './ui/track-panel';

const RATES = [0, 1, 10, 60, 600, 3600];
const PASS_HORIZON_HOURS = 48;
const OBSERVER_KEY = 'orbitscope.observer';
const CLICK_SLOP_PX = 5;
const PICK_RADIUS_PX = 10;
const TOUCH_PICK_RADIUS_PX = 24;
const DOM_REFRESH_MS = 250;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

interface ObserverSettings extends Geodetic {
  maskDeg: number;
}

function loadObserver(): ObserverSettings {
  const fallback = { latDeg: 51.48, lonDeg: 0, altKm: 0, maskDeg: 10 };
  try {
    const stored = localStorage.getItem(OBSERVER_KEY);
    return stored ? { ...fallback, ...(JSON.parse(stored) as ObserverSettings) } : fallback;
  } catch {
    return fallback;
  }
}

function saveObserver(observer: ObserverSettings): void {
  try {
    localStorage.setItem(OBSERVER_KEY, JSON.stringify(observer));
  } catch {
    // Private windows can refuse storage. The observer then lasts for the visit.
  }
}

export interface Options {
  startMs: number;
  rate: number;
  scale: number;
  workers: number;
  satellite: number | null;
  observer: [number, number] | null;
  bench: boolean;
}

export function parseOptions(search: string, now: number): Options {
  const params = new URLSearchParams(search);
  const parsedTime = Date.parse(params.get('t') ?? '');
  const number = (name: string, fallback: number): number => {
    const value = Number(params.get(name));
    return params.has(name) && Number.isFinite(value) ? value : fallback;
  };
  const obs = params.get('obs')?.split(',').map(Number);
  return {
    startMs: Number.isNaN(parsedTime) ? now : parsedTime,
    rate: number('rate', 1),
    scale: Math.max(1, Math.floor(number('scale', 1))),
    workers: Math.max(
      1,
      Math.floor(number('workers', Math.min(4, Math.max(1, navigator.hardwareConcurrency - 2)))),
    ),
    satellite: params.has('sat') ? number('sat', 0) : null,
    observer:
      obs?.length === 2 && obs.every(Number.isFinite) ? [obs[0] as number, obs[1] as number] : null,
    bench: params.has('bench'),
  };
}

export class App {
  private readonly stage: Stage;
  private readonly globe: Globe;
  private readonly field: SatelliteField;
  private readonly track = new TrackPanel();
  private readonly orbit: OrbitTrack;
  private readonly labels: LabelLayer;
  private readonly clock: SimClock;
  private readonly scheduler: KeyframeScheduler;
  private readonly perf = new PerfMeter();
  private readonly passWorker: Worker;
  private readonly gpuTimer: GpuTimer;

  private readonly categories: Uint8Array;
  private readonly fetchedMs: number;
  private readonly selectionReticle: HTMLDivElement;
  private readonly hoverReticle: HTMLDivElement;
  private readonly observerReticle: HTMLDivElement;
  private readonly tooltip: HTMLDivElement;
  private readonly perfPanel = byId('perf');
  private readonly utc = byId('utc');

  private frameState: FrameState = { ready: false, fromSlot: 0, u: 0, spanSeconds: 1 };
  private mask = (1 << CATEGORIES.length) - 1;
  private observer = loadObserver();
  private selection: Selection | null = null;
  private lastPathMs = 0;
  private lastDomMs = 0;
  private passRequestId = 0;
  private nextPassRefreshMs = Infinity;
  private pointer = { x: 0, y: 0, moved: false, inside: false };
  private pressed: { x: number; y: number } | null = null;
  private failed = 0;
  private recording: { frameMs: number[]; cpuMs: number[]; last: number } | null = null;
  private readonly rateButtons = new Map<number, HTMLButtonElement>();
  private readonly tempPosition: [number, number, number] = [0, 0, 0];
  /** Cached because reading layout every frame would defeat the transform-only overlay. */
  private panelRects: ScreenRect[] = [];

  constructor(
    private readonly entries: CatalogEntry[],
    private readonly pool: PropagationPool,
    private readonly options: Options,
    manifest: SnapshotManifest,
    baseUrl: string,
  ) {
    const canvas = byId<HTMLCanvasElement>('view');
    this.stage = new Stage(canvas);
    this.globe = new Globe(this.stage.scene, this.stage.renderer, baseUrl);
    this.gpuTimer = new GpuTimer(this.stage.gl);

    this.categories = Uint8Array.from(entries, classify);
    this.field = new SatelliteField(entries.length, this.categories, PALETTE);
    this.stage.inertial.add(this.field.mesh);
    this.orbit = new OrbitTrack(this.stage.inertial, this.globe.group);

    this.clock = new SimClock(options.startMs, performance.now(), options.rate);
    this.fetchedMs = Date.parse(manifest.fetchedAt);
    this.scheduler = new KeyframeScheduler(
      entries.length * STRIDE,
      (timeMs, generation, target) => {
        this.pool.propagate(timeMs, target, (timing) => {
          this.onKeyframe(timeMs, generation, target, timing);
        });
      },
    );

    const overlay = byId('overlay');
    const reticle = (className: string): HTMLDivElement => {
      const element = document.createElement('div');
      element.className = className;
      element.hidden = true;
      overlay.append(element);
      return element;
    };
    this.labels = new LabelLayer(
      overlay,
      notableTargets(entries.map((entry) => entry.OBJECT_NAME)),
    );
    this.observerReticle = reticle('reticle observer');
    this.hoverReticle = reticle('reticle hover');
    this.selectionReticle = reticle('reticle');
    this.tooltip = reticle('');
    this.tooltip.id = 'tooltip';

    this.passWorker = new Worker(new URL('./workers/passes.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.passWorker.onmessage = (event: MessageEvent<PassReply>) => {
      if (event.data.id !== this.passRequestId) return;
      this.track.showPasses(event.data.passes, event.data.elapsedMs, PASS_HORIZON_HOURS);
      const first = event.data.passes[0];
      this.nextPassRefreshMs = first ? first.losMs : Infinity;
    };

    this.wirePanels();
    this.wireInput(canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    if (options.observer) {
      this.observer = {
        ...this.observer,
        latDeg: options.observer[0],
        lonDeg: options.observer[1],
      };
    }
    this.syncObserverInputs();
  }

  private onKeyframe(
    timeMs: number,
    generation: number,
    target: Float32Array,
    timing: KeyframeTiming,
  ): void {
    this.failed = timing.failed;
    this.perf.keyframe(timing.roundTripMs, timing.slowestShardMs);
    this.scheduler.deliver(timeMs, generation, target);
  }

  private wirePanels(): void {
    const counts = CATEGORIES.map(() => 0);
    for (const category of this.categories) {
      counts[category] = (counts[category] as number) + 1;
    }
    byId('total-count').textContent = this.entries.length.toLocaleString('en-US');
    renderCategories(counts, (mask) => {
      this.mask = mask;
      this.field.setMask(mask);
    });
    wireSearch(this.entries, (index) => this.select(index));
    // Narrow screens collapse this panel, and touch has no hover to open it.
    const catalog = byId('catalog');
    catalog.querySelector('.total')?.addEventListener('click', () => {
      catalog.classList.toggle('open');
    });

    if (this.options.scale > 1) {
      const banner = byId('synthetic');
      banner.hidden = false;
      banner.textContent = `Load test: catalog copied ${this.options.scale} times`;
    }

    const snapshotDate = formatUtc(this.fetchedMs).slice(0, 16);
    byId('data-credit').textContent =
      `Orbital data: CelesTrak, from US Space Force 18 SDS element sets via Space-Track.org. ` +
      `Snapshot ${snapshotDate} UTC.`;

    const rates = byId('rates');
    for (const rate of RATES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = formatRate(rate);
      button.setAttribute('aria-label', rate === 0 ? 'Pause' : `${rate} times real time`);
      button.addEventListener('click', () => this.setRate(rate));
      rates.append(button);
      this.rateButtons.set(rate, button);
    }
    this.syncRateButtons();
    byId('time-now').addEventListener('click', () => {
      this.clock.jump(Date.now(), performance.now());
      this.setRate(1);
      this.requestPasses();
    });

    byId('track-close').addEventListener('click', () => this.clearSelection());

    const inputs: [string, (value: number) => void][] = [
      ['obs-lat', (value) => (this.observer.latDeg = Math.max(-90, Math.min(90, value)))],
      ['obs-lon', (value) => (this.observer.lonDeg = Math.max(-180, Math.min(180, value)))],
      ['obs-mask', (value) => (this.observer.maskDeg = Math.max(0, Math.min(80, value)))],
    ];
    for (const [id, assign] of inputs) {
      byId<HTMLInputElement>(id).addEventListener('change', (event) => {
        const value = (event.target as HTMLInputElement).valueAsNumber;
        if (Number.isFinite(value)) {
          assign(value);
          this.observerChanged();
        }
      });
    }

    byId('obs-locate').addEventListener('click', () => {
      const status = byId('pass-status');
      if (!('geolocation' in navigator)) {
        status.textContent = 'This browser cannot report a location';
        return;
      }
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          this.observer.latDeg = Number(coords.latitude.toFixed(2));
          this.observer.lonDeg = Number(coords.longitude.toFixed(2));
          this.observer.altKm = (coords.altitude ?? 0) / 1000;
          this.syncObserverInputs();
          this.observerChanged();
        },
        (error) => {
          status.textContent = `Location unavailable: ${error.message}`;
        },
      );
    });
  }

  private syncObserverInputs(): void {
    byId<HTMLInputElement>('obs-lat').value = String(this.observer.latDeg);
    byId<HTMLInputElement>('obs-lon').value = String(this.observer.lonDeg);
    byId<HTMLInputElement>('obs-mask').value = String(this.observer.maskDeg);
    byId('pass-horizon').textContent = `${PASS_HORIZON_HOURS} h`;
  }

  private observerChanged(): void {
    saveObserver(this.observer);
    this.requestPasses();
  }

  private wireInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      const status = byId('status');
      status.hidden = false;
      status.classList.add('error');
      status.textContent = 'The graphics context was lost. Reload the page to continue.';
    });
    canvas.addEventListener('pointerdown', (event) => {
      this.pressed = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('pointerup', (event) => {
      if (!this.pressed) return;
      const moved = Math.hypot(event.clientX - this.pressed.x, event.clientY - this.pressed.y);
      this.pressed = null;
      if (moved > CLICK_SLOP_PX) return;
      const radius = event.pointerType === 'touch' ? TOUCH_PICK_RADIUS_PX : PICK_RADIUS_PX;
      const index = this.pickAt(event.clientX, event.clientY, radius);
      if (index >= 0) this.select(index);
      else this.clearSelection();
    });
    canvas.addEventListener('pointermove', (event) => {
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.pointer.moved = true;
      this.pointer.inside = true;
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer.inside = false;
      this.pointer.moved = true;
    });
    window.addEventListener('keydown', (event) => {
      if ((event.target as HTMLElement).tagName === 'INPUT') {
        if (event.key === 'Escape') (event.target as HTMLElement).blur();
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        this.setRate(this.clock.rate === 0 ? 1 : 0);
      } else if (event.key === 'Escape') {
        this.clearSelection();
      } else if (event.key === '/') {
        event.preventDefault();
        byId('search').focus();
      }
    });
  }

  private resize(): void {
    const { innerWidth: width, innerHeight: height } = window;
    this.stage.resize(width, height);
    this.field.setViewport(width, height);
    this.measurePanels();
  }

  private measurePanels(): void {
    this.panelRects = ['brand', 'catalog', 'track', 'timebar', 'perf', 'credits']
      .map((id) => byId(id))
      .filter((panel) => !panel.hidden)
      .map((panel) => panel.getBoundingClientRect());
  }

  private setRate(rate: number): void {
    this.clock.setRate(rate, performance.now());
    this.syncRateButtons();
  }

  private syncRateButtons(): void {
    for (const [rate, button] of this.rateButtons) {
      button.setAttribute('aria-pressed', String(rate === this.clock.rate));
    }
  }

  select(index: number): void {
    const entry = this.entries[index];
    if (!entry) return;
    this.selection = new Selection(entry, index);
    this.track.show(entry, this.selection.periodMin);
    this.measurePanels();
    this.lastPathMs = -Infinity;
    this.lastDomMs = 0;
    this.requestPasses();
    if (!this.options.bench) {
      const url = new URL(window.location.href);
      url.searchParams.set('sat', String(entry.NORAD_CAT_ID));
      window.history.replaceState(null, '', url);
    }
  }

  clearSelection(): void {
    this.selection = null;
    this.track.hide();
    this.measurePanels();
    this.orbit.hide();
    this.selectionReticle.hidden = true;
    this.nextPassRefreshMs = Infinity;
    this.passRequestId += 1;
    if (!this.options.bench) {
      const url = new URL(window.location.href);
      url.searchParams.delete('sat');
      window.history.replaceState(null, '', url);
    }
  }

  private requestPasses(): void {
    if (!this.selection) return;
    this.passRequestId += 1;
    const { entry } = this.selection;
    const simMs = this.clock.now(performance.now());
    const message: PassRequest = {
      id: this.passRequestId,
      record: {
        NORAD_CAT_ID: entry.NORAD_CAT_ID,
        EPOCH: entry.EPOCH,
        MEAN_MOTION: entry.MEAN_MOTION,
        ECCENTRICITY: entry.ECCENTRICITY,
        INCLINATION: entry.INCLINATION,
        RA_OF_ASC_NODE: entry.RA_OF_ASC_NODE,
        ARG_OF_PERICENTER: entry.ARG_OF_PERICENTER,
        MEAN_ANOMALY: entry.MEAN_ANOMALY,
        BSTAR: entry.BSTAR,
      },
      observer: {
        latDeg: this.observer.latDeg,
        lonDeg: this.observer.lonDeg,
        altKm: this.observer.altKm,
      },
      startMs: simMs,
      options: {
        horizonHours: PASS_HORIZON_HOURS,
        minElevationDeg: this.observer.maskDeg,
        maxPasses: 8,
      },
    };
    this.passWorker.postMessage(message);
  }

  private pickAt(x: number, y: number, radius = PICK_RADIUS_PX): number {
    const from = this.scheduler.slots[this.frameState.fromSlot];
    const to = this.scheduler.slots[this.frameState.fromSlot === 0 ? 1 : 0];
    if (!from || !to) return -1;
    const camera = this.stage.camera.position;
    return pickNearest(
      from.data,
      to.data,
      this.categories,
      this.mask,
      this.frameState.u,
      this.frameState.spanSeconds,
      {
        viewProjection: this.stage.viewProjection.elements,
        camera: [camera.x, camera.y, camera.z],
        widthPx: this.stage.widthPx,
        heightPx: this.stage.heightPx,
      },
      x,
      y,
      radius,
    );
  }

  /** Current interpolated position, in the same way the vertex shader finds it. */
  private positionOf = (index: number): readonly [number, number, number] | null => {
    const from = this.scheduler.slots[this.frameState.fromSlot];
    const to = this.scheduler.slots[this.frameState.fromSlot === 0 ? 1 : 0];
    if (!from || !to) return null;
    const a = from.data;
    const b = to.data;
    const o = index * STRIDE;
    const { u, spanSeconds: h } = this.frameState;
    const p = this.tempPosition;
    p[0] = hermite(a[o] as number, a[o + 3] as number, b[o] as number, b[o + 3] as number, u, h);
    p[1] = hermite(
      a[o + 1] as number,
      a[o + 4] as number,
      b[o + 1] as number,
      b[o + 4] as number,
      u,
      h,
    );
    p[2] = hermite(
      a[o + 2] as number,
      a[o + 5] as number,
      b[o + 2] as number,
      b[o + 5] as number,
      u,
      h,
    );
    return p[0] === 0 && p[1] === 0 && p[2] === 0 ? null : p;
  };

  private placeReticle(element: HTMLElement, p: readonly [number, number, number] | null): void {
    const point = { x: 0, y: 0 };
    const camera = this.stage.camera.position;
    const visible =
      p !== null &&
      !occludedByEarth([camera.x, camera.y, camera.z], p[0], p[1], p[2]) &&
      project(
        this.stage.viewProjection.elements,
        p[0],
        p[1],
        p[2],
        this.stage.widthPx,
        this.stage.heightPx,
        point,
      );
    element.hidden = !visible;
    if (visible) element.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
  }

  private updateHover(): void {
    if (!this.pointer.moved) return;
    this.pointer.moved = false;
    const index = this.pointer.inside ? this.pickAt(this.pointer.x, this.pointer.y) : -1;
    const entry = this.entries[index];
    if (!entry) {
      this.hoverReticle.hidden = true;
      this.tooltip.hidden = true;
      this.stage.renderer.domElement.style.cursor = '';
      return;
    }
    this.stage.renderer.domElement.style.cursor = 'pointer';
    this.placeReticle(this.hoverReticle, this.positionOf(index));
    this.tooltip.hidden = false;
    this.tooltip.textContent = `${entry.OBJECT_NAME} `;
    const id = document.createElement('span');
    id.textContent = String(entry.NORAD_CAT_ID);
    this.tooltip.append(id);
    this.tooltip.style.transform = `translate3d(${this.pointer.x + 14}px, ${this.pointer.y + 14}px, 0)`;
  }

  private updateObserverMarker(gmst: number): void {
    const lat = (this.observer.latDeg * Math.PI) / 180;
    const lon = (this.observer.lonDeg * Math.PI) / 180 + gmst;
    this.placeReticle(this.observerReticle, [
      1.001 * Math.cos(lat) * Math.cos(lon),
      1.001 * Math.cos(lat) * Math.sin(lon),
      1.001 * Math.sin(lat),
    ]);
  }

  private updateSelection(simMs: number, wallMs: number): void {
    const selection = this.selection;
    if (!selection) return;
    this.placeReticle(this.selectionReticle, selection.positionEr(simMs));

    const stepMs = (selection.periodMin * 60_000) / 120;
    if (Math.abs(simMs - this.lastPathMs) > stepMs) {
      const { orbit, ground } = selection.paths(simMs);
      this.orbit.setPaths(orbit, ground);
      this.lastPathMs = simMs;
    }
    if (wallMs - this.lastDomMs > DOM_REFRESH_MS) {
      this.track.update(
        selection.telemetry(simMs, this.observer),
        Date.parse(`${selection.entry.EPOCH}Z`),
        simMs,
      );
    }
    if (simMs > this.nextPassRefreshMs) {
      this.nextPassRefreshMs = Infinity;
      this.requestPasses();
    }
  }

  private updateDom(simMs: number, wallMs: number): void {
    if (wallMs - this.lastDomMs <= DOM_REFRESH_MS) return;
    this.lastDomMs = wallMs;
    this.utc.textContent = `${formatUtc(simMs)} UTC`;
    const perf = this.perf.snapshot();
    const ageDays = (simMs - this.fetchedMs) / 86_400_000;
    this.perfPanel.textContent =
      `frame ${perf.frameMedianMs.toFixed(1)} ms  p99 ${perf.frameP99Ms.toFixed(1)}\n` +
      `cpu   ${perf.cpuMedianMs.toFixed(2)} ms\n` +
      `prop  ${perf.keyframeShardMs.toFixed(1)} ms  rt ${perf.keyframeRoundTripMs.toFixed(1)}\n` +
      `labels ${this.labels.stats.shown}/${this.labels.stats.candidates}  ` +
      `failed ${this.failed}  late ${this.scheduler.stalls}\n` +
      `elements ${ageDays >= 0 ? '+' : ''}${ageDays.toFixed(1)} d`;
  }

  private frame = (wallMs: number): void => {
    requestAnimationFrame(this.frame);
    const start = performance.now();

    const simMs = this.clock.now(wallMs);
    const { rate } = this.clock;
    this.frameState = this.scheduler.update(simMs, rate);
    for (const slot of [0, 1] as const) {
      const keyframe = this.scheduler.slots[slot];
      if (this.scheduler.dirty[slot] && keyframe) {
        this.field.upload(slot, keyframe.data);
        this.scheduler.dirty[slot] = false;
      }
    }
    if (this.frameState.ready) this.field.setFrame(this.frameState);

    const { jd, frac } = jdFromUnixMs(simMs);
    const gmst = gstime(jd + frac);
    this.globe.update(gmst, sunDirection(jd, frac));

    this.stage.updateCamera();
    const camera = this.stage.camera.position;
    this.field.setCamera(camera.x, camera.y, camera.z);
    // Dots grow and brighten as the camera nears, when each one is an individual
    // object and not part of a shell. From afar the sum of many faint dots reads
    // as density without hiding the planet.
    const closeness = Math.min(1, 1.6 / this.stage.cameraDistance);
    this.field.setPointSize(0.95 + 1.7 * closeness, 0.5 + 0.6 * closeness);

    if (this.frameState.ready) {
      this.labels.update(
        this.stage,
        this.positionOf,
        (index) => ((this.mask >> (this.categories[index] as number)) & 1) === 1,
        this.panelRects,
      );
      this.updateHover();
    }
    this.updateObserverMarker(gmst);
    this.updateSelection(simMs, wallMs);
    this.updateDom(simMs, wallMs);

    if (this.options.bench) this.gpuTimer.begin();
    this.stage.renderer.render(this.stage.scene, this.stage.camera);
    if (this.options.bench) this.gpuTimer.end();

    const cpuMs = performance.now() - start;
    this.perf.frame(wallMs, cpuMs);
    if (this.recording) {
      if (this.recording.last !== 0) this.recording.frameMs.push(wallMs - this.recording.last);
      this.recording.last = wallMs;
      this.recording.cpuMs.push(cpuMs);
    }
  };

  start(): void {
    requestAnimationFrame(this.frame);
    const wanted = this.options.satellite;
    if (wanted !== null) {
      const index = this.entries.findIndex((entry) => entry.NORAD_CAT_ID === wanted);
      if (index >= 0) this.select(index);
    }
    if (this.options.bench) this.exposeBenchApi();
  }

  private exposeBenchApi(): void {
    const gl = this.stage.gl;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    window.__orbitscope = {
      objects: this.entries.length,
      workers: this.options.workers,
      renderer: debug ? (gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string) : 'unknown',
      gpuTimerSupported: this.gpuTimer.supported,
      ready: () => this.frameState.ready,
      selectByCatalogNumber: (id: number) => {
        const index = this.entries.findIndex((entry) => entry.NORAD_CAT_ID === id);
        if (index >= 0) this.select(index);
        return index;
      },
      setRate: (rate: number) => this.setRate(rate),
      setCamera: (x: number, y: number, z: number) => {
        this.stage.camera.position.set(x, y, z);
      },
      setMask: (mask: number) => {
        this.mask = mask;
        this.field.setMask(mask);
      },
      setEarthVisible: (visible: boolean) => {
        this.globe.setVisible(visible);
      },
      frame: () => ({ u: this.frameState.u, spanSeconds: this.frameState.spanSeconds }),
      /** Pixel positions the CPU expects for a category, for the shader agreement test. */
      projectCategory: (category: number) => {
        const points: { x: number; y: number }[] = [];
        const camera = this.stage.camera.position;
        const tuple = [camera.x, camera.y, camera.z] as const;
        this.categories.forEach((value, index) => {
          if (value !== category) return;
          const p = this.positionOf(index);
          const point = { x: 0, y: 0 };
          if (
            p &&
            !occludedByEarth(tuple, p[0], p[1], p[2]) &&
            project(
              this.stage.viewProjection.elements,
              p[0],
              p[1],
              p[2],
              this.stage.widthPx,
              this.stage.heightPx,
              point,
            )
          ) {
            points.push(point);
          }
        });
        return points;
      },
      startRecording: () => {
        this.recording = { frameMs: [], cpuMs: [], last: 0 };
        this.gpuTimer.samplesMs.length = 0;
        this.scheduler.stalls = 0;
      },
      stopRecording: () => {
        const recording = this.recording;
        this.recording = null;
        return {
          frameMs: recording?.frameMs ?? [],
          cpuMs: recording?.cpuMs ?? [],
          gpuMs: [...this.gpuTimer.samplesMs],
          stalls: this.scheduler.stalls,
          keyframe: this.perf.snapshot(),
          labels: this.labels.stats,
          failed: this.failed,
        };
      },
      pickTimings: (samples: number) => {
        const timings: number[] = [];
        for (let i = 0; i < samples; i += 1) {
          const start = performance.now();
          this.pickAt(100 + i, 100 + i);
          timings.push(performance.now() - start);
        }
        return timings;
      },
    };
  }
}
