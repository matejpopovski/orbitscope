import { defineConfig } from '@playwright/test';

// Browser tests need a GPU to be meaningful, so they run locally and not in CI.
const metal = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'e2e',
  timeout: 15 * 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:42161',
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: process.platform === 'darwin' ? metal : [] },
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:42161/orbitscope/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
