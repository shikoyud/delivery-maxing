import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { initNav, NAV_TIERS } from '@dm/shared';
import { buildTierBinaries, readGreyboxMap } from '../nav/build';
import { navBinPath, REPO } from '../nav/files';

// map:build: builds one navmesh per tier from map/greybox.json and writes them to map/nav/greybox-<tier>.bin.

const t0 = performance.now();
await initNav();
const bins = buildTierBinaries(readGreyboxMap(REPO));
for (const t of NAV_TIERS) {
  const path = join(REPO, navBinPath(t));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bins[t]);
  console.log(`map:build wrote ${navBinPath(t)}: ${(bins[t].length / 1024).toFixed(0)} KB`);
}
console.log(`map:build: ${NAV_TIERS.length} navmeshes in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
