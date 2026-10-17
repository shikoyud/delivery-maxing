import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cityConfig, initNav, layoutToMap, namesConfig, NAV_TIERS, NavRouter, type MapData } from '@dm/shared';
import { readCatalog, writeLayout } from '../city/files';
import { generateLayout } from '../city/generate';
import { buildTierBinaries, readGreyboxMap } from '../nav/build';
import { buildDistanceTable, serialize } from '../nav/distances';
import { CITY_LAYOUT, DISTANCES, gzip, navBinPath, REPO } from '../nav/files';

// map:build: generates map/city.layout.json from config/city.json, config/names.json and the catalog; builds one
// navmesh per tier for the greybox (map/greybox.json) and the city and writes them gzipped to
// map/nav/<kind>-<tier>.bin.gz; then the city's pickup→dropoff walk distances to map/city.distances.bin.gz.

const t0 = performance.now();
const secs = (from: number): string => `${((performance.now() - from) / 1000).toFixed(1)} s`;
const kb = (n: number): string => `${(n / 1024).toFixed(0)} KB`;
const write = (path: string, bytes: Uint8Array): void => {
  const abs = join(REPO, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
};

const cat = readCatalog(REPO);
const layout = generateLayout(cityConfig, namesConfig, cat);
writeLayout(REPO, layout);
console.log(`map:build wrote ${CITY_LAYOUT}: ${layout.lots.length} lots, ${layout.blocks.length} blocks, ${layout.roads.length} roads`);
await initNav();

const city = layoutToMap(layout, cat);
let total = 0;
let cityRouter: NavRouter | undefined;
for (const map of [readGreyboxMap(REPO), city] as MapData[]) {
  const t1 = performance.now();
  const bins = buildTierBinaries(map);
  let sum = 0;
  for (const t of NAV_TIERS) {
    const gz = gzip(bins[t]);
    write(navBinPath(map.kind, t), gz);
    sum += gz.length;
    console.log(`map:build wrote ${navBinPath(map.kind, t)}: ${kb(gz.length)} (${kb(bins[t].length)} inflated)`);
  }
  total += sum;
  console.log(`map:build: ${map.kind} navmeshes ${(sum / 1e6).toFixed(2)} MB gzipped, built in ${secs(t1)}`);
  if (map.kind === 'city') cityRouter = NavRouter.fromBinaries(bins);
}
console.log(`map:build: navmesh total ${(total / 1e6).toFixed(2)} MB gzipped`);

const t2 = performance.now();
const table = buildDistanceTable(city, cityRouter!);
cityRouter!.destroy();
const raw = serialize(table);
const gz = gzip(raw);
write(DISTANCES, gz);
const unreachable = table.values.filter((v) => !Number.isFinite(v)).length;
console.log(
  `map:build wrote ${DISTANCES}: ${table.pickups.length} pickups × ${table.dropoffs.length} dropoffs, ${unreachable} unreachable, ` +
    `${kb(gz.length)} (${kb(raw.length)} inflated), in ${secs(t2)}`,
);
console.log(`map:build took ${secs(t0)}`);
