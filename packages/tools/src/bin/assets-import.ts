import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCatalog } from '@dm/shared';
import { importPacks } from '../assets/import';
import { REPO } from '../nav/files';

// Usage: assets:import [packs-folder]   (default assets/packs, relative to the directory pnpm was started in)
// Writes the runtime models of every used catalog entry into packages/client/public/packs/ (git-ignored: pack models
// are never committed), quantised and meshopt-compressed, with LOD1 files where simplification pays.
const arg = process.argv[2] ?? 'assets/packs';
const folder = resolve(process.env.INIT_CWD ?? process.cwd(), arg);
if (!existsSync(folder)) {
  console.error('assets:import: packs folder not found');
  process.exit(1);
}
const outDir = join(REPO, 'packages/client/public/packs');
const cat = parseCatalog(JSON.parse(readFileSync(join(REPO, 'map/catalog.json'), 'utf8')));
const t0 = performance.now();
const r = await importPacks(folder, cat, outDir);
console.log(`assets:import: ${r.written} models (${r.lod1} with LOD1) into ${outDir}`);
if (r.skipped.length) console.log(`skipped (absent, unreadable or empty): ${r.skipped.join(', ')}`);
console.log(`total ${(r.bytes / 1e6).toFixed(1)} MB in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
