import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect, type Plugin } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The navmeshes and the distance table are gzip files (map/**\/*.bin.gz): served as `application/gzip` bytes, never
 * with `Content-Encoding: gzip` (the browser would inflate them, and the loader would get other bytes than it fetched)
 * and never re-compressed. The loader inflates them itself (and passes already-inflated bytes through).
 */
function gzipAssets(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (/\.gz(\?|$)/.test(req.url ?? '')) {
      const setHeader = res.setHeader.bind(res);
      res.setHeader = (name, value) => {
        const n = name.toLowerCase();
        if (n === 'content-encoding') return res;
        return setHeader(name, n === 'content-type' ? 'application/gzip' : value);
      };
      setHeader('Content-Type', 'application/gzip');
    }
    next();
  };
  return {
    name: 'dm-gzip-assets',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig({
  // GitHub Pages serves the site from a sub-path (Task 15 sets PAGES_BASE).
  base: process.env.PAGES_BASE ?? '/',
  plugins: [gzipAssets()],
  server: {
    // config/ and map/ live at the repo root, outside this package.
    fs: { allow: [repoRoot] },
  },
  build: {
    target: 'es2022',
    // three.js plus Rapier's base64-embedded WASM make one large game chunk by design (~4.9 MB, ~1.8 MB gzip).
    chunkSizeWarningLimit: 6144,
    // Never inline map data into the bundle as data: URLs (the city layout, catalog and .gz files stay assets).
    assetsInlineLimit: (file) => (/\.(json|gz)$/.test(file) ? false : undefined),
  },
});
