import { afterAll, beforeAll, expect, test } from 'vitest';
import { initNav, NavRouter, vec3, type MapData } from '@dm/shared';
import { exportNavMesh } from 'recast-navigation';
import { buildTierNavMesh, readGreyboxMap, readNavBinaries } from '../../src/nav/build';
import { REPO } from '../../src/nav/files';
import { validateGreyboxNav } from '../../src/nav/validate';

const map = readGreyboxMap(REPO);
const routers: NavRouter[] = [];

beforeAll(initNav);
afterAll(() => routers.forEach((r) => r.destroy()));

test('the committed greybox passes the validator with no messages', () => {
  const router = NavRouter.fromBinaries(readNavBinaries(REPO));
  routers.push(router);
  expect(validateGreyboxNav(map, router)).toEqual([]);
});

test('moving a package door 60 m from any car road produces exactly one message naming it', () => {
  // A pier (walk, skateboard and bicycle only, like the boardwalk) runs 80 m south off the harbor's edge street; the
  // package-only door downtown-poi-01 moves out along it, about 60 m on foot from the nearest car point. Only the walk
  // mesh is rebuilt: the committed car mesh has no pier at all, which drives the same as a pier blocked for cars.
  const door = 'downtown-poi-01';
  expect(map.pois.find((p) => p.id === door)!.roles).toEqual(['packagePickup']);
  const moved: MapData = {
    ...map,
    solids: [...map.solids, { id: 'test-pier', kind: 'ground', center: vec3(150, -0.5, 340), size: vec3(8, 1, 80) }],
    accessZones: [
      ...map.accessZones,
      { id: 'test-pier', kind: 'path', rect: { minX: 146, minZ: 300, maxX: 154, maxZ: 380 }, minY: 0, maxY: 0 },
    ],
    pois: map.pois.map((p) => (p.id === door ? { ...p, position: vec3(150, 0, 358) } : p)),
  };
  const walk = buildTierNavMesh(moved, 'walk');
  const router = NavRouter.fromBinaries({ ...readNavBinaries(REPO), walk: exportNavMesh(walk) });
  walk.destroy();
  routers.push(router);
  const messages = validateGreyboxNav(moved, router);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain(door);
  expect(messages[0]).toMatch(/package door is \d+\.\d m on foot/);
}, 60_000);
