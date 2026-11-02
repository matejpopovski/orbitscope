const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;

/**
 * GPU time for the scene, for the benchmark only. Results arrive frames later,
 * so finished queries are collected without blocking. Some drivers, including
 * ANGLE's Metal backend, do not expose the extension; `available` says so, and
 * the measurement script reports the absence rather than a number.
 */
export class GpuTimer {
  private readonly available: boolean;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  readonly samplesMs: number[] = [];

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.available = gl.getExtension('EXT_disjoint_timer_query_webgl2') !== null;
  }

  get supported(): boolean {
    return this.available;
  }

  begin(): void {
    if (!this.available || this.active) return;
    this.active = this.gl.createQuery();
    if (this.active) this.gl.beginQuery(TIME_ELAPSED_EXT, this.active);
  }

  end(): void {
    if (!this.active) return;
    this.gl.endQuery(TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    this.collect();
  }

  private collect(): void {
    const { gl } = this;
    while (this.pending.length > 0) {
      const query = this.pending[0] as WebGLQuery;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return;
      if (!gl.getParameter(GPU_DISJOINT_EXT)) {
        const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
        this.samplesMs.push(nanoseconds / 1e6);
      }
      gl.deleteQuery(query);
      this.pending.shift();
    }
  }
}
