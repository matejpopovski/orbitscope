import { test, type Page } from '@playwright/test';
import '../src/bench-api';

// Captures the README images from the running app:
//
//   npx playwright test e2e/screenshots.spec.ts

async function capture(
  page: Page,
  query: string,
  file: string,
  camera?: [number, number, number],
): Promise<void> {
  await page.goto(`/orbitscope/?bench=1&t=2026-11-02T14:00:00Z&${query}`);
  await page.waitForFunction(() => window.__orbitscope?.ready());
  if (camera) {
    await page.evaluate(([x, y, z]) => window.__orbitscope.setCamera(x, y, z), camera);
  }
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `docs/${file}` });
}

test.use({ deviceScaleFactor: 2 });

test('README screenshots', async ({ page }) => {
  await capture(page, 'rate=0&sat=25544&obs=40.71,-74.01', 'overview.png', [-2.2, 6.0, 2.6]);
  await capture(page, 'rate=0', 'shell.png', [2.6, -1.3, 0.75]);
  await capture(page, 'rate=0&sat=41328', 'gnss.png', [12, -16, 8]);

  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'rate=0&sat=25544', 'phone.png', [-2.8, 7.6, 3.3]);
});
