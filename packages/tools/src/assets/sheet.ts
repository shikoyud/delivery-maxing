import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname, extname, join, normalize, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { AssetsConfig } from './pipeline';

export interface SheetOptions {
  /** Repository root (serves assets/ and map/) */
  repo: string;
  cfg: AssetsConfig;
  /** PNG to write */
  out: string;
  /** Only pieces whose id matches this regex */
  filter?: string;
  tile?: number;
  cols?: number;
  /** 'front' looks from +x +z, 'back' from −x −z */
  view?: 'front' | 'back';
  /** Chromium executable; defaults to Playwright's own browser */
  executablePath?: string;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
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

/** Renders every piece (model, collider wireframes, roofY plane, +z arrow) on a grid into a PNG via headless Chromium. */
export async function renderContactSheet(o: SheetOptions): Promise<{ count: number }> {
  const here = dirname(fileURLToPath(import.meta.url));
  // 'three' resolves to <pkg>/build/three.cjs
  const threeDir = dirname(dirname(createRequire(import.meta.url).resolve('three')));
  const palettes = Object.fromEntries(o.cfg.pieces.map((p) => [p.id, p.palette ?? o.cfg.defaultPalette]));
  const rows = o.cfg.palettes.map((p) => basename(p, extname(p)));
  const server = await serve(
    { '/three/': threeDir, '/assets/': join(o.repo, 'assets'), '/map/': join(o.repo, 'map') },
    {
      '/': readFileSync(join(here, 'sheet.html'), 'utf8'),
      '/sheet-data.json': JSON.stringify({ rows, palettes }),
      '/favicon.ico': '',
    },
  );
  const browser = await chromium.launch({
    executablePath: o.executablePath,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => {
      if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    });
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
    });
    const q = new URLSearchParams({
      tile: String(o.tile ?? 300),
      cols: String(o.cols ?? 8),
      filter: o.filter ?? '.',
      view: o.view ?? 'front',
    });
    const { port } = server.address() as AddressInfo;
    await page.goto(`http://127.0.0.1:${port}/?${q}`);
    const ready = await page
      .waitForFunction(() => (window as unknown as { sheetReady?: { count: number } }).sheetReady, null, { timeout: 120_000 })
      .catch((e: Error) => {
        throw new Error(`contact sheet did not render: ${errors.join('; ') || e.message}`);
      });
    const { count } = (await ready.jsonValue()) as { count: number };
    if (errors.length) throw new Error(`contact sheet page errors: ${errors.join('; ')}`);
    await page.locator('#sheet').screenshot({ path: o.out });
    return { count };
  } finally {
    await browser.close();
    server.close();
  }
}
