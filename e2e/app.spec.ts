import { expect, test, type Page } from '@playwright/test';
import '../src/bench-api';

const APP = '/orbitscope/?bench=1&t=2026-11-02T14:00:00Z&rate=0';
const LEO_CATEGORY = 3;
const HEO_CATEGORY = 6;

async function open(page: Page, url = APP): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.__orbitscope?.ready());
  await page.waitForTimeout(500);
}

test('starts without errors and only ever talks to its own origin', async ({ page }) => {
  const problems: string[] = [];
  const hosts = new Set<string>();
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('request', (request) => hosts.add(new URL(request.url()).host));

  await open(page);

  expect(problems).toEqual([]);
  expect([...hosts]).toEqual(['localhost:42161']);
  await expect(page.locator('#total-count')).not.toHaveText('0');
});

test('credits the data sources on the page', async ({ page }) => {
  await open(page);
  await expect(page.locator('#credits')).toContainText('CelesTrak');
  await expect(page.locator('#credits')).toContainText('Space-Track.org');
  await expect(page.locator('#credits')).toContainText('NASA');
});

test('search selects a satellite and solves its passes off the main thread', async ({ page }) => {
  await open(page);
  await page.locator('#search').fill('25544');
  await page.locator('#results button').first().click();
  await expect(page.locator('#track-name')).toHaveText('ISS (ZARYA)');
  await expect(page.locator('#passes tbody tr').first()).toBeVisible();
  await expect(page.locator('#pass-status')).toContainText('Solved in');
});

test('clicking a dot selects that satellite', async ({ page }) => {
  await open(page);
  await page.evaluate((mask) => window.__orbitscope.setMask(mask), 1 << HEO_CATEGORY);
  await page.waitForTimeout(200);
  const points = await page.evaluate(
    (category) => window.__orbitscope.projectCategory(category),
    HEO_CATEGORY,
  );
  const target = points.find((p) => p.x > 320 && p.x < 1000 && p.y > 100 && p.y < 760);
  expect(target).toBeDefined();
  if (!target) return;
  await page.mouse.click(target.x, target.y);
  await expect(page.locator('#track')).toBeVisible();
});

test('a category filter hides its dots on the GPU', async ({ page }) => {
  await open(page);
  const before = await litPixels(page);
  await page.evaluate(() => window.__orbitscope.setMask(0));
  await page.waitForTimeout(200);
  expect(await litPixels(page)).toBeLessThan(before);
});

test('works at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Search is collapsed by default here, and touch has no hover to reveal it.
  await expect(page.locator('#search')).toBeHidden();
  await page.locator('#catalog .total').click();
  await expect(page.locator('#search')).toBeVisible();

  await page.locator('#search').fill('25544');
  await page.locator('#results button').first().click();
  await expect(page.locator('#track-name')).toHaveText('ISS (ZARYA)');
  await expect(page.locator('#credits')).toBeVisible();

  // The attribution is a condition of redistributing the data, so nothing may cover it.
  const overlaps = await page.evaluate(() => {
    const rect = (id: string): DOMRect =>
      (document.getElementById(id) as HTMLElement).getBoundingClientRect();
    const touching = (a: DOMRect, b: DOMRect): boolean =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return [
      ['credits', 'timebar'],
      ['timebar', 'track'],
      ['credits', 'track'],
    ].filter(([a, b]) => touching(rect(a as string), rect(b as string)));
  });
  expect(overlaps).toEqual([]);
});

test('reports a clear error when the catalog is missing', async ({ page }) => {
  await page.route('**/data/manifest.json', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(APP);
  await expect(page.locator('#status')).toContainText('could not start');
});

test('the vertex shader draws each dot where the CPU says it is', async ({ page }) => {
  // This only means anything mid-interval on a long span. At u = 0 the Hermite
  // reduces to p0, and on a short span the tangent terms move a dot by less than
  // a pixel, so either way a wrong polynomial would pass unseen.
  await open(page, '/orbitscope/?bench=1&t=2026-11-02T14:00:00Z&rate=3600');
  await page.evaluate((mask) => {
    window.__orbitscope.setMask(mask);
    window.__orbitscope.setEarthVisible(false);
    window.__orbitscope.setCamera(0, -3.6, 1.1);
  }, 1 << LEO_CATEGORY);
  await page.addStyleTag({
    content: '#brand,#catalog,#track,#timebar,#perf,#credits,#overlay{display:none!important}',
  });

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const bench = window.__orbitscope;
          bench.setRate(3600);
          await new Promise((resolve) => setTimeout(resolve, 12));
          bench.setRate(0);
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          const { u, spanSeconds } = bench.frame();
          return spanSeconds === 120 && u > 0.3 && u < 0.7;
        }),
      { intervals: [50], timeout: 20_000 },
    )
    .toBe(true);
  // Lets camera damping finish, so CPU and screenshot share one view.
  await page.waitForTimeout(1500);

  const expected = await page.evaluate(
    (category) => window.__orbitscope.projectCategory(category),
    LEO_CATEGORY,
  );

  // A dot with a neighbour this close can be outshone by it, which says nothing
  // about where either was drawn.
  const isolated = expected.filter(
    (p, i) => !expected.some((q, j) => i !== j && Math.hypot(p.x - q.x, p.y - q.y) < 10),
  );
  expect(isolated.length).toBeGreaterThan(30);

  const shot = (await page.screenshot()).toString('base64');
  const misses = await page.evaluate(
    async ({ png, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('no 2d context');
      context.drawImage(image, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
      const brightness = (x: number, y: number): number => {
        const i = (y * width + x) * 4;
        return (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0);
      };
      const distances: number[] = [];
      for (const point of points) {
        const px = Math.round(point.x);
        const py = Math.round(point.y);
        if (px < 4 || py < 4 || px >= width - 4 || py >= height - 4) continue;
        let peak = 0;
        let best = Infinity;
        for (let dy = -4; dy <= 4; dy += 1) {
          for (let dx = -4; dx <= 4; dx += 1) {
            const value = brightness(px + dx, py + dy);
            if (value > peak) {
              peak = value;
              best = Math.hypot(dx, dy);
            }
          }
        }
        distances.push(peak > 60 ? best : Infinity);
      }
      return distances;
    },
    { png: shot, points: isolated },
  );

  expect(misses.length).toBeGreaterThan(30);
  expect(misses.filter((distance) => !Number.isFinite(distance))).toHaveLength(0);
  // Within rounding of one pixel diagonally: the shader and hermite.ts agree.
  expect(Math.max(...misses)).toBeLessThanOrEqual(1.5);
});

async function litPixels(page: Page): Promise<number> {
  const shot = (await page.screenshot()).toString('base64');
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no 2d context');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 120) lit += 1;
    }
    return lit;
  }, shot);
}
