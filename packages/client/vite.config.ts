import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  // GitHub Pages serves the site from a sub-path (Task 15 sets PAGES_BASE).
  base: process.env.PAGES_BASE ?? '/',
  server: {
    // config/ and map/ live at the repo root, outside this package.
    fs: { allow: [repoRoot] },
  },
  build: {
    target: 'es2022',
    // three.js plus Rapier's base64-embedded WASM make one large game chunk by design (~4.9 MB, ~1.8 MB gzip).
    chunkSizeWarningLimit: 6144,
    // Map JSON and city models are fetched at start: never inline them into the bundle, however small.
    assetsInlineLimit: (file) => (/\.(glb|json)$/.test(file) ? false : undefined),
  },
});
