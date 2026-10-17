import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCatalog } from '@dm/shared';
import { importPacks } from '../assets/import';
import { REPO } from '../nav/files';

// Usage: assets:import [packs-folder]   (default assets/packs, relative to the directory pnpm was started in)
// Writes the runtime models of every used catalog entry into packages/client/public/packs/ (git-ignored: pack models
// are never committed), quantised and meshopt-compressed, with LOD1 files where simplification pays. The manifest is
// also written to packages/client/src/packs/manifest.json (git-ignored too), where the client bundles it from.
const arg = process.argv[2] ?? 'assets/packs';
const folder = resolve(process.env.INIT_CWD ?? process.cwd(), arg);
if (!existsSync(folder)) {
  console.error('assets:import: packs folder not found');
  process.exit(1);
}
const outDir = join(REPO, 'packages/client/public/packs');
const manifestCopy = join(REPO, 'packages/client/src/packs/manifest.json');
const cat = parseCatalog(JSON.parse(readFileSync(join(REPO, 'map/catalog.json'), 'utf8')));
const t0 = performance.now();
const r = await importPacks(folder, cat, outDir, undefined, manifestCopy);
console.log(`assets:import: ${r.written} models (${r.lod1} with LOD1) into ${outDir}`);
for (const id of r.skipped) console.log(`skipped ${id}: ${r.skipReasons[id]}`);
console.log(`total ${(r.bytes / 1e6).toFixed(1)} MB in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
