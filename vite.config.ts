import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages serves a project site under its repository name.
  base: '/orbitscope/',
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js alone is most of this, and all of it is needed on first paint.
    chunkSizeWarningLimit: 700,
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
