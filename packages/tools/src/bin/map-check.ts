import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMapOutputs, MAP_OUTPUTS, navMeshBudgetError } from '../nav/mapOutputs';

// map:check (part of `pnpm check`): regenerates the city, navmesh and POI table into a temp dir and byte-compares each
// with the committed file (all three are deterministic: two builds give identical bytes), then validates the POI
// table and the navmesh size budget. Exits 1 with a short summary when a file differs or validation fails.

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const MAX_LINES = 5;

/** A short account of how `fresh` differs from `committed`: changed line numbers (text) or the first byte (binary). */
function diffSummary(path: string, committed: Uint8Array, fresh: Uint8Array): string {
  if (path.endsWith('.json')) {
    const a = new TextDecoder().decode(committed).split('\n');
    const b = new TextDecoder().decode(fresh).split('\n');
    const changed: string[] = [];
    let count = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === b[i]) continue;
      count++;
      if (changed.length < MAX_LINES) changed.push(`  line ${i + 1}: committed ${JSON.stringify(a[i] ?? '')} vs fresh ${JSON.stringify(b[i] ?? '')}`);
    }
    return [`${path}: ${count} line(s) differ (${a.length} → ${b.length} lines)`, ...changed].join('\n');
  }
  let at = 0;
  while (at < Math.min(committed.length, fresh.length) && committed[at] === fresh[at]) at++;
  return `${path}: ${committed.length} → ${fresh.length} bytes, first difference at byte ${at}`;
}

const t0 = performance.now();
const build = await buildMapOutputs(repo);
const dir = mkdtempSync(join(tmpdir(), 'map-check-'));
const problems: string[] = [];
try {
  for (const [path, bytes] of Object.entries(build.files)) {
    const freshPath = join(dir, basename(path));
    writeFileSync(freshPath, bytes);
    let committed: Uint8Array;
    try {
      committed = readFileSync(join(repo, path));
    } catch {
      problems.push(`${path}: not committed (run pnpm map:build)`);
      continue;
    }
    const fresh = readFileSync(freshPath);
    if (!fresh.equals(committed)) problems.push(diffSummary(path, committed, fresh));
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const overBudget = navMeshBudgetError(build.files[MAP_OUTPUTS.navMesh]!.length);
if (overBudget) problems.push(overBudget);
for (const e of build.errors) problems.push(`validation: ${e}`);

const seconds = ((performance.now() - t0) / 1000).toFixed(1);
if (problems.length > 0) {
  for (const p of problems) console.error(`map:check: ${p}`);
  console.error(`map:check FAILED in ${seconds} s: the committed map is stale or invalid; run pnpm map:build and commit map/`);
  process.exit(1);
}
const reachable = build.table.pois.filter((p) => p.reachable).length;
console.log(`map:check OK in ${seconds} s: ${Object.keys(build.files).join(', ')} match; ${reachable}/${build.table.pois.length} POIs reachable`);
