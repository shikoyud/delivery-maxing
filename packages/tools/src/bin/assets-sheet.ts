import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BUILDING_CATEGORIES } from '@dm/shared';
import { renderContactSheets } from '../assets/sheet';
import { REPO } from '../nav/files';

// Usage: assets:sheet [--packs dir] [--out dir] [--category food] [--filter regex] [--tile px] [--cols n]
// Renders every placed building from its front side into <out>/sheet-<category>.png (default docs/playtest/sp5).
// Needs the packs (git-ignored); the PNGs show pack models and must not be committed. Chromium: $PW_CHROMIUM_PATH.
const base = process.env.INIT_CWD ?? process.cwd();
const { values } = parseArgs({
  options: {
    packs: { type: 'string', default: 'assets/packs' },
    out: { type: 'string', default: join(REPO, 'docs/playtest/sp5') },
    category: { type: 'string' },
    filter: { type: 'string' },
    tile: { type: 'string' },
    cols: { type: 'string' },
  },
});
const packs = resolve(base, values.packs!);
if (!existsSync(packs)) {
  console.error('assets:sheet: packs folder not found');
  process.exit(1);
}
const outDir = resolve(base, values.out!);
mkdirSync(outDir, { recursive: true });
const done = await renderContactSheets({
  repo: REPO,
  packs,
  outDir,
  categories: values.category ? [values.category] : [...BUILDING_CATEGORIES],
  filter: values.filter,
  tile: values.tile ? Number(values.tile) : undefined,
  cols: values.cols ? Number(values.cols) : undefined,
  executablePath: process.env.PW_CHROMIUM_PATH,
});
for (const d of done) console.log(`assets:sheet ${d.category}: ${d.count} buildings${d.count ? ` -> ${d.file}` : ''}`);
