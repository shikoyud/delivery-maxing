import { afterAll, beforeAll, expect, test } from 'vitest';
import { accessAllowed, initNav, NAV_TIERS } from '@dm/shared';
import { exportNavMesh, getNavMeshPositionsAndIndices, NavMeshQuery, type NavMesh } from 'recast-navigation';
import { buildTierNavMesh, readGreyboxMap } from '../../src/nav/build';
import { REPO } from '../../src/nav/files';

const map = readGreyboxMap(REPO);
const meshes: NavMesh[] = [];
const build = (tier: (typeof NAV_TIERS)[number]): NavMesh => {
  const m = buildTierNavMesh(map, tier);
  meshes.push(m);
  return m;
};

beforeAll(initNav);
afterAll(() => meshes.forEach((m) => m.destroy()));

test('the car mesh has no polygon inside an alley, steep-lane, stairs or path zone; the walk mesh covers the stairs', () => {
  const car = build('car');
  const kinds = new Set(map.accessZones.map((z) => z.kind));
  expect([...kinds].sort()).toEqual(['alley', 'path', 'stairs', 'steepLane']);
  for (const z of map.accessZones) expect(accessAllowed('car', z.kind)).toBe(false);

  const [pos, idx] = getNavMeshPositionsAndIndices(car);
  expect(idx.length).toBeGreaterThan(0);
  const inside: string[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const c = [0, 1, 2].map((a) => (pos[idx[t]! * 3 + a]! + pos[idx[t + 1]! * 3 + a]! + pos[idx[t + 2]! * 3 + a]!) / 3);
    const [x, y, zz] = c as [number, number, number];
    for (const z of map.accessZones) {
      const r = z.rect;
      const e = 0.05;
      if (x > r.minX + e && x < r.maxX - e && zz > r.minZ + e && zz < r.maxZ - e && y > z.minY - 0.5 && y < z.maxY + 0.5) {
        inside.push(`${z.id} @ ${x.toFixed(1)},${y.toFixed(1)},${zz.toFixed(1)}`);
      }
    }
  }
  expect(inside).toEqual([]);

  const walk = build('walk');
  const q = new NavMeshQuery(walk);
  const stairs = map.solids.filter((s) => /^town-stair-\d+$/.test(s.id));
  expect(stairs).toHaveLength(20);
  for (const s of stairs) {
    const top = { x: s.center.x, y: s.center.y + s.size.y / 2, z: s.center.z };
    const r = q.findClosestPoint(top, { halfExtents: { x: 0.2, y: 0.5, z: 0.2 } });
    expect(r.success && r.isPointOverPoly, s.id).toBe(true);
  }
  q.destroy();
}, 60_000);

test('building twice gives byte-identical binaries', () => {
  for (const t of NAV_TIERS) {
    const a = exportNavMesh(build(t));
    const b = exportNavMesh(build(t));
    expect(a.length, t).toBeGreaterThan(0);
    expect(Buffer.from(a).equals(Buffer.from(b)), t).toBe(true);
  }
}, 120_000);
