import { writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { test, type Browser, type BrowserContext } from '@playwright/test';
import { chromium } from '@playwright/test';
import '../src/bench-api';

// Measures frame times in a real browser. Run on its own:
//
//   npx playwright test e2e/measure.spec.ts
//
// Numbers come from whatever GPU Chromium reports, and the report records that
// string, so a software rasterizer can never pass for hardware.

const SETTLE_MS = 4000;
const RECORD_MS = 12000;
const VIEWPORT = { width: 1440, height: 900 };

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
};

const round = (value: number): number => Math.round(value * 1000) / 1000;

async function measure(
  context: BrowserContext,
  params: { scale: number; rate: number; workers: number },
): Promise<Record<string, unknown>> {
  const page = await context.newPage();
  const started = Date.now();
  await page.goto(
    `/orbitscope/?bench=1&t=2026-11-02T14:00:00Z&rate=${params.rate}&scale=${params.scale}&workers=${params.workers}`,
  );
  await page.waitForFunction(() => window.__orbitscope?.ready(), null, { timeout: 180_000 });
  const startupMs = Date.now() - started;
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(() => window.__orbitscope.startRecording());
  await page.waitForTimeout(RECORD_MS);
  const recording = await page.evaluate(() => window.__orbitscope.stopRecording());
  const meta = await page.evaluate(() => ({
    objects: window.__orbitscope.objects,
    workers: window.__orbitscope.workers,
    renderer: window.__orbitscope.renderer,
    gpuTimerSupported: window.__orbitscope.gpuTimerSupported,
  }));
  const pick = await page.evaluate(() => window.__orbitscope.pickTimings(200));
  await page.close();

  const { frameMs, cpuMs, gpuMs } = recording;
  const row = {
    ...params,
    ...meta,
    startupMs,
    frames: frameMs.length,
    fps: round(1000 / (frameMs.reduce((a, b) => a + b, 0) / frameMs.length)),
    frameMedianMs: round(percentile(frameMs, 0.5)),
    frameP95Ms: round(percentile(frameMs, 0.95)),
    frameP99Ms: round(percentile(frameMs, 0.99)),
    frameMaxMs: round(Math.max(...frameMs)),
    framesOver20Ms: frameMs.filter((ms) => ms > 20).length,
    cpuMedianMs: round(percentile(cpuMs, 0.5)),
    cpuP99Ms: round(percentile(cpuMs, 0.99)),
    gpuMedianMs: gpuMs.length > 0 ? round(percentile(gpuMs, 0.5)) : null,
    gpuP99Ms: gpuMs.length > 0 ? round(percentile(gpuMs, 0.99)) : null,
    keyframeShardMedianMs: round(recording.keyframe.keyframeShardMs),
    keyframeRoundTripMedianMs: round(recording.keyframe.keyframeRoundTripMs),
    stalledFrames: recording.stalls,
    failedObjects: recording.failed,
    pickMedianMs: round(percentile(pick, 0.5)),
  };
  console.log(JSON.stringify(row));
  return row;
}

async function open(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: 'http://localhost:42161',
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
}

test('frame times', async () => {
  test.setTimeout(45 * 60_000);
  const rows: Record<string, Record<string, unknown>[]> = {};

  const gpu = await chromium.launch({
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const gpuContext = await open(gpu);

  rows.scaling = [];
  for (const scale of [1, 2, 4, 8, 16, 32]) {
    rows.scaling.push(await measure(gpuContext, { scale, rate: 60, workers: 4 }));
  }

  rows.timeRates = [];
  for (const rate of [1, 60, 600, 3600]) {
    rows.timeRates.push(await measure(gpuContext, { scale: 1, rate, workers: 4 }));
  }

  rows.workers = [];
  for (const workers of [1, 2, 4, 8]) {
    rows.workers.push(await measure(gpuContext, { scale: 4, rate: 3600, workers }));
  }
  await gpu.close();

  const software = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const softwareContext = await open(software);
  rows.softwareRasterizer = [await measure(softwareContext, { scale: 1, rate: 60, workers: 4 })];
  await software.close();

  writeFileSync(
    'results/frame-times.json',
    `${JSON.stringify(
      {
        command: 'npx playwright test e2e/measure.spec.ts',
        machine: `${cpus()[0]?.model}, ${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GB`,
        browser: 'Playwright Chromium 1.49.1 (headless)',
        viewport: `${VIEWPORT.width}x${VIEWPORT.height} at device scale 2`,
        settleMs: SETTLE_MS,
        recordMs: RECORD_MS,
        caveats: [
          'Headless Chromium paces requestAnimationFrame at 60 Hz, so frame interval cannot show headroom above that. cpu and gpu times do.',
          'The machine was running other jobs in parallel, so these are contended numbers.',
          'performance.now() is coarsened to 0.1 ms without cross-origin isolation, which limits the cpu columns.',
        ],
        ...rows,
      },
      null,
      2,
    )}\n`,
  );
});
