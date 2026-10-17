import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cityConfig, initNav, layoutToMap, namesConfig, NAV_TIERS, navConfig, NavRouter, type MapData } from '@dm/shared';
import { readCatalog } from '../city/files';
import { generateLayout } from '../city/generate';
import { stableStringify } from '../city/stableJson';
import { validateCityNav, validateLayout } from '../city/validate';
import { buildTierBinaries, readGreyboxMap } from '../nav/build';
import { buildDistanceTable, serialize } from '../nav/distances';
import { CITY_LAYOUT, DISTANCES, navBinPath, readGz, REPO } from '../nav/files';
import { validateMapNav } from '../nav/validate';

// map:check (part of `pnpm check`): regenerates map/city.layout.json, the ten navmeshes (greybox and city, five tiers
// each) and the city's distance table in memory and byte-compares each with the committed file (the .gz files
// inflated), checks the gzipped navmeshes of each map against nav.maxNavMeshMB, and runs the validators: the layout
// validator, the navigation checks on both maps and the city's own. Exits 1 with every problem.

const t0 = performance.now();
const secs = (from: number): string => `${((performance.now() - from) / 1000).toFixed(1)} s`;
const problems: string[] = [];

/** Compares fresh bytes with a committed .gz file's contents; pushes a problem and returns false when they differ. */
function matches(path: string, fresh: Uint8Array): boolean {
  let committed: Uint8Array;
  try {
    committed = readGz(REPO, path);
  } catch {
    problems.push(`${path}: not committed or not gzip (run pnpm map:build)`);
    return false;
  }
  const a = Buffer.from(fresh);
  if (a.equals(Buffer.from(committed))) return true;
  let at = 0;
  while (at < Math.min(a.length, committed.length) && a[at] === committed[at]) at++;
  problems.push(`${path}: stale (${committed.length} → ${a.length} bytes inflated, first difference at byte ${at}); run pnpm map:build`);
  return false;
}

const cat = readCatalog(REPO);
const layout = generateLayout(cityConfig, namesConfig, cat);
let layoutMatches = false;
try {
  layoutMatches = readFileSync(join(REPO, CITY_LAYOUT), 'utf8') === stableStringify(layout);
  if (!layoutMatches) problems.push(`${CITY_LAYOUT}: stale; run pnpm map:build`);
} catch {
  problems.push(`${CITY_LAYOUT}: not committed (run pnpm map:build)`);
}
problems.push(...validateLayout(layout, cat));

await initNav();
const city = layoutToMap(layout, cat);
let matching = 0;
let distancesMatch = false;
for (const map of [readGreyboxMap(REPO), city] as MapData[]) {
  const t1 = performance.now();
  const bins = buildTierBinaries(map);
  let gzBytes = 0;
  for (const t of NAV_TIERS) {
    if (matches(navBinPath(map.kind, t), bins[t])) matching++;
    try {
      gzBytes += statSync(join(REPO, navBinPath(map.kind, t))).size;
    } catch {
      // reported by matches
    }
  }
  const mb = gzBytes / 1e6;
  if (mb > navConfig.maxNavMeshMB) problems.push(`${map.kind} navmeshes: ${mb.toFixed(2)} MB gzipped, over nav.maxNavMeshMB (${navConfig.maxNavMeshMB})`);
  const built = secs(t1);
  const t2 = performance.now();
  const router = NavRouter.fromBinaries(bins);
  if (map.kind === 'city') {
    problems.push(...validateCityNav(city, router));
    const validated = secs(t2);
    const t3 = performance.now();
    distancesMatch = matches(DISTANCES, serialize(buildDistanceTable(city, router)));
    console.log(`map:check: city navmeshes ${mb.toFixed(2)} MB gzipped, built in ${built}, validated in ${validated}, distances in ${secs(t3)}`);
  } else {
    problems.push(...validateMapNav(map, router));
    console.log(`map:check: ${map.kind} navmeshes ${mb.toFixed(2)} MB gzipped, built in ${built}, validated in ${secs(t2)}`);
  }
  router.destroy();
}

for (const p of problems) console.error(`map:check: ${p}`);
const same = layoutMatches && distancesMatch ? 'layout and distances match' : `layout ${layoutMatches ? 'matches' : 'does not match'}, distances ${distancesMatch ? 'match' : 'do not match'}`;
console.log(`map:check: ${matching} navmeshes match, ${same}, ${problems.length} problems`);
console.log(`map:check took ${secs(t0)}`);
if (problems.length > 0) process.exit(1);
