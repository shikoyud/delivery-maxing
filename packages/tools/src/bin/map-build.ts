import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cityConfig, initNav, namesConfig, NAV_TIERS } from '@dm/shared';
import { readCatalog, writeLayout } from '../city/files';
import { generateLayout } from '../city/generate';
import { buildTierBinaries, readGreyboxMap } from '../nav/build';
import { CITY_LAYOUT, navBinPath, REPO } from '../nav/files';

// map:build: generates map/city.layout.json from config/city.json, config/names.json and the catalog, then builds one
// navmesh per tier from map/greybox.json and writes them to map/nav/greybox-<tier>.bin.

const t0 = performance.now();
const layout = generateLayout(cityConfig, namesConfig, readCatalog(REPO));
writeLayout(REPO, layout);
console.log(`map:build wrote ${CITY_LAYOUT}: ${layout.lots.length} lots, ${layout.blocks.length} blocks, ${layout.roads.length} roads`);
await initNav();
const bins = buildTierBinaries(readGreyboxMap(REPO));
for (const t of NAV_TIERS) {
  const path = join(REPO, navBinPath(t));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bins[t]);
  console.log(`map:build wrote ${navBinPath(t)}: ${(bins[t].length / 1024).toFixed(0)} KB`);
}
console.log(`map:build: ${NAV_TIERS.length} navmeshes in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
