import { afterAll, beforeAll, expect, test } from 'vitest';
import { accessAllowed, initNav, NAV_TIERS, navConfig, switchbackGeometry, cityConfig } from '@dm/shared';
import { exportNavMesh, getNavMeshPositionsAndIndices, NavMeshQuery, type NavMesh } from 'recast-navigation';
import { areaBlockers, buildTierNavMesh, navAgent, readCityMap, readGreyboxMap } from '../../src/nav/build';
import { REPO } from '../../src/nav/files';

const map = readGreyboxMap(REPO);
const meshes: NavMesh[] = [];
const build = (tier: (typeof NAV_TIERS)[number]): NavMesh => {
  const m = buildTierNavMesh(map, tier);
  meshes.push(m);
  return m;
};
/** One car mesh shared by the tests (each build of the whole greybox takes seconds). */
let carMesh: NavMesh | undefined;
const car = (): NavMesh => (carMesh ??= build('car'));
let walkMesh: NavMesh | undefined;
const walk = (): NavMesh => (walkMesh ??= build('walk'));

beforeAll(initNav);
afterAll(() => meshes.forEach((m) => m.destroy()));

test('the car mesh has no polygon inside an alley, steep-lane, stairs or path zone; the walk mesh covers the stairs', () => {
  const kinds = new Set(map.accessZones.map((z) => z.kind));
  expect([...kinds].sort()).toEqual(['alley', 'path', 'stairs', 'steepLane']);
  for (const z of map.accessZones) expect(accessAllowed('car', z.kind)).toBe(false);

  const [pos, idx] = getNavMeshPositionsAndIndices(car());
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

  const q = new NavMeshQuery(walk());
  const stairs = map.solids.filter((s) => /^town-stair-\d+$/.test(s.id));
  expect(stairs).toHaveLength(20);
  for (const s of stairs) {
    const top = { x: s.center.x, y: s.center.y + s.size.y / 2, z: s.center.z };
    const r = q.findClosestPoint(top, { halfExtents: { x: 0.2, y: 0.5, z: 0.2 } });
    expect(r.success && r.isPointOverPoly, s.id).toBe(true);
  }
  q.destroy();
}, 60_000);

// The car mesh (every blocker and fill-layer path) built twice in one process; map:check compares all five tiers
// against the committed files, built in another process.
test('building twice gives byte-identical binaries', () => {
  const a = exportNavMesh(car());
  const b = exportNavMesh(build('car'));
  expect(a.length).toBeGreaterThan(0);
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
}, 60_000);

test('each tier is voxelised at its own cell size (nav.cellSizeByTier, Decision 13)', () => {
  for (const t of NAV_TIERS) expect(navAgent(t).cellSize, t).toBe(navConfig.cellSizeByTier[t]);
  expect(navAgent('car').cellSize).toBeGreaterThan(navAgent('walk').cellSize);
});

test('the greybox car mesh (0.6 m cells) is smaller in bytes than the walk mesh (0.3 m cells)', () => {
  const carBytes = exportNavMesh(car()).length;
  const walkBytes = exportNavMesh(walk()).length;
  expect(carBytes).toBeGreaterThan(0);
  expect(carBytes).toBeLessThan(walkBytes);
}, 60_000);

test('city area blockers: the car is kept off sand, pier, marina and band-gap floors, not off a switchback deck', () => {
  const city = readCityMap(REPO);
  expect(areaBlockers(readGreyboxMap(REPO), 'car')).toEqual([]);
  expect(areaBlockers(city, 'walk')).toEqual([]);
  const blockers = areaBlockers(city, 'car');
  const covers = (x: number, z: number, y: number): boolean =>
    blockers.some((b) => Math.abs(x - b.center.x) < b.size.x / 2 && Math.abs(z - b.center.z) < b.size.z / 2 && Math.abs(y - (b.center.y - b.size.y / 2)) < 0.5);
  const forbidden = city.layout.areas.filter((a) => ['sand', 'pier', 'marina'].includes(a.kind));
  expect(forbidden.length).toBeGreaterThan(40);
  for (const a of forbidden) expect(covers((a.rect.minX + a.rect.maxX) / 2, (a.rect.minZ + a.rect.maxZ) / 2, a.y), a.id).toBe(true);
  const switchbacks = city.layout.connectors.filter((c) => c.kind === 'switchback');
  expect(switchbacks).toHaveLength(11);
  for (const c of switchbacks) {
    const g = switchbackGeometry(c, cityConfig.switchback);
    const [za, zb] = g.legZ;
    const legMidX = g.xs + g.run / 2;
    // the floor inside the U is blocked; the legs, the hairpin and the entry and exit stubs are not
    expect(covers(legMidX, (za + zb) / 2, c.y0), `${c.id} U floor`).toBe(true);
    expect(covers(legMidX, za, c.y0), `${c.id} leg 1`).toBe(false);
    expect(covers(legMidX, zb, c.y0), `${c.id} leg 2`).toBe(false);
    expect(covers((g.xs + g.run + g.xEast) / 2, (za + zb) / 2, c.y0), `${c.id} hairpin`).toBe(false);
    expect(covers(c.x, c.z0 + 0.5, c.y0), `${c.id} entry`).toBe(false);
  }
});
