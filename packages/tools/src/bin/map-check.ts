import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initNav, NAV_TIERS, NavRouter } from '@dm/shared';
import { buildTierBinaries, readGreyboxMap } from '../nav/build';
import { navBinPath, REPO } from '../nav/files';
import { validateGreyboxNav } from '../nav/validate';

// map:check (part of `pnpm check`): rebuilds the five navmeshes in memory, byte-compares each with the committed
// map/nav/greybox-<tier>.bin, and runs the navigation validator on them. Exits 1 with every problem.

const t0 = performance.now();
await initNav();
const map = readGreyboxMap(REPO);
const bins = buildTierBinaries(map);
const problems: string[] = [];
let matching = 0;
for (const t of NAV_TIERS) {
  const path = navBinPath(t);
  let committed: Buffer;
  try {
    committed = readFileSync(join(REPO, path));
  } catch {
    problems.push(`${path}: not committed (run pnpm map:build)`);
    continue;
  }
  const fresh = Buffer.from(bins[t]);
  if (fresh.equals(committed)) {
    matching++;
    continue;
  }
  let at = 0;
  while (at < Math.min(fresh.length, committed.length) && fresh[at] === committed[at]) at++;
  problems.push(`${path}: stale (${committed.length} → ${fresh.length} bytes, first difference at byte ${at}); run pnpm map:build`);
}
const router = NavRouter.fromBinaries(bins);
problems.push(...validateGreyboxNav(map, router));
router.destroy();

const seconds = ((performance.now() - t0) / 1000).toFixed(1);
for (const p of problems) console.error(`map:check: ${p}`);
console.log(`map:check: ${matching} navmeshes match, ${problems.length} problems`);
console.log(`map:check took ${seconds} s`);
if (problems.length > 0) process.exit(1);
