import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { AssetsConfig } from '../assets/pipeline';
import { renderContactSheet } from '../assets/sheet';

// Usage: assets:sheet [--out file.png] [--filter regex] [--tile px] [--cols n] [--view front|back]
// Chromium: $PW_CHROMIUM_PATH, else Playwright's own browser.
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: join(repo, 'docs/playtest/sp2/pieces-sheet.png') },
    filter: { type: 'string' },
    tile: { type: 'string' },
    cols: { type: 'string' },
    view: { type: 'string' },
  },
});
const cfg = JSON.parse(readFileSync(join(here, '../../assets.config.json'), 'utf8')) as AssetsConfig;
const out = resolve(values.out);
mkdirSync(dirname(out), { recursive: true });
const { count } = await renderContactSheet({
  repo,
  cfg,
  out,
  filter: values.filter,
  tile: values.tile ? Number(values.tile) : undefined,
  cols: values.cols ? Number(values.cols) : undefined,
  view: values.view === 'back' ? 'back' : 'front',
  executablePath: process.env.PW_CHROMIUM_PATH,
});
console.log(`assets:sheet rendered ${count} pieces → ${out}`);
