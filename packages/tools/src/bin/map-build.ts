import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildMapOutputs, MAP_OUTPUTS, navMeshBudgetError } from '../nav/mapOutputs';

// map:build: generates map/city.json, its navmesh (map/city.navmesh.bin) and POI table (map/city.poi.json). Exits 1
// when the POI table fails validation (unless --allow-unreachable) or the navmesh is over its size budget (always).

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const allowUnreachable = process.argv.includes('--allow-unreachable');

const t0 = performance.now();
const build = await buildMapOutputs(repo);
for (const [path, bytes] of Object.entries(build.files)) writeFileSync(join(repo, path), bytes);

const { city, table, seconds } = build;
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
const cityBytes = build.files[MAP_OUTPUTS.city]!;
const navBytes = build.files[MAP_OUTPUTS.navMesh]!.length;
const reachable = table.pois.filter((p) => p.reachable);
console.log(
  `map:build wrote ${MAP_OUTPUTS.city}: ${city.props.length} props, ${city.solids.length} solids, ` +
    `${city.streets.nodes.length} street nodes, ${city.checkpoints.length} checkpoints, ${city.navLinks.length} nav links; ` +
    `${kb(cityBytes.length)} (gzip ${kb(gzipSync(cityBytes).length)}) in ${seconds.city.toFixed(1)} s`,
);
console.log(`map:build wrote ${MAP_OUTPUTS.navMesh}: ${(navBytes / 1024 / 1024).toFixed(2)} MB in ${seconds.navMesh.toFixed(1)} s`);
console.log(
  `map:build wrote ${MAP_OUTPUTS.poi}: ${reachable.length}/${table.pois.length} POIs reachable ` +
    `(${reachable.filter((p) => p.elevated).length} elevated); ${kb(build.files[MAP_OUTPUTS.poi]!.length)} in ${seconds.table.toFixed(1)} s`,
);
console.log(`map:build total ${((performance.now() - t0) / 1000).toFixed(1)} s`);

const overBudget = navMeshBudgetError(navBytes);
if (overBudget) {
  console.error(`map:build: ${overBudget}`);
  process.exit(1);
}
if (build.errors.length > 0) {
  for (const e of build.errors) console.error(`map:build: ${e}`);
  if (!allowUnreachable) {
    console.error(`map:build: ${build.errors.length} validation error(s); outputs written for inspection (--allow-unreachable exits 0)`);
    process.exit(1);
  }
}
