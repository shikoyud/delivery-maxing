import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export interface SheetOptions {
  /** Repository root (serves map/catalog.json) */
  repo: string;
  /** The packs folder (served as /packs/) */
  packs: string;
  /** One PNG is written per building category, to <outDir>/sheet-<category>.png */
  outDir: string;
  categories: string[];
  /** Only entries whose id matches this regex */
  filter?: string;
  tile?: number;
  cols?: number;
  /** Chromium executable; defaults to Playwright's own browser */
  executablePath?: string;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
};

function serve(roots: Record<string, string>, extra: Record<string, string>): Promise<Server> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    if (extra[path] !== undefined) {
      res.writeHead(200, { 'content-type': path === '/' ? TYPES['.html']! : (TYPES[extname(path)] ?? 'text/plain') });
      res.end(extra[path]);
      return;
    }
    for (const [prefix, dir] of Object.entries(roots)) {
      if (!path.startsWith(prefix)) continue;
      const file = normalize(join(dir, path.slice(prefix.length)));
      if (!file.startsWith(normalize(dir) + sep)) break;
      try {
        const body = readFileSync(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        break;
      }
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/** Renders the placed buildings of each category, each seen from its front side, into sheet-<category>.png via headless Chromium. */
export async function renderContactSheets(o: SheetOptions): Promise<{ category: string; count: number; file: string }[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  // 'three' resolves to <pkg>/build/three.cjs
  const threeDir = dirname(dirname(createRequire(import.meta.url).resolve('three')));
  const server = await serve(
    { '/three/': threeDir, '/packs/': o.packs, '/map/': join(o.repo, 'map') },
    { '/': readFileSync(join(here, 'sheet.html'), 'utf8'), '/favicon.ico': '' },
  );
  const browser = await chromium.launch({
    executablePath: o.executablePath,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const done: { category: string; count: number; file: string }[] = [];
  try {
    const { port } = server.address() as AddressInfo;
    for (const category of o.categories) {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('response', (r) => {
        if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
      });
      const q = new URLSearchParams({ tile: String(o.tile ?? 300), cols: String(o.cols ?? 6), category, filter: o.filter ?? '.' });
      await page.goto(`http://127.0.0.1:${port}/?${q}`);
      const ready = await page
        .waitForFunction(() => (window as unknown as { sheetReady?: { count: number } }).sheetReady, null, { timeout: 180_000 })
        .catch((e: Error) => {
          throw new Error(`contact sheet ${category} did not render: ${errors.join('; ') || e.message}`);
        });
      const { count } = (await ready.jsonValue()) as { count: number };
      if (errors.length) throw new Error(`contact sheet ${category} page errors: ${errors.join('; ')}`);
      const file = join(o.outDir, `sheet-${category}.png`);
      if (count > 0) await page.locator('#sheet').screenshot({ path: file });
      done.push({ category, count, file });
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  return done;
}
