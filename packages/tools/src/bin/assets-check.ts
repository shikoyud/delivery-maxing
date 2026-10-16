import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCatalog } from '@dm/shared';
import { checkPacks, formatReport } from '../assets/check';
import { REPO } from '../nav/files';

// Usage: assets:check [packs-folder]   (default assets/packs, relative to the directory pnpm was started in)
// Compares map/catalog.json with the owner's packs. Exits 1 when the folder is absent, or when a placed entry is
// missing, empty or changed size. Everything else (extra files, duplicates, unused entries) is only reported.
const arg = process.argv[2] ?? 'assets/packs';
const folder = resolve(process.env.INIT_CWD ?? process.cwd(), arg);
if (!existsSync(folder)) {
  console.error('assets:check: packs folder not found');
  process.exit(1);
}
const cat = parseCatalog(JSON.parse(readFileSync(join(REPO, 'map/catalog.json'), 'utf8')));
const report = await checkPacks(folder, cat);
console.log(formatReport(report));
const placed = new Set(cat.entries.filter((e) => e.use === 'placed').map((e) => e.id));
const failing = [...report.missing, ...report.empty, ...report.sizeChanged.map((c) => c.id)].filter((id) => placed.has(id));
if (failing.length) {
  console.error(`assets:check: ${failing.length} placed entries need attention`);
  process.exit(1);
}
console.log('assets:check: ok');
