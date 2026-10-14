import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import greyboxJson from '../../../../map/greybox.json';
import type { VehicleTier } from '../../src/config';
import { distance, vec3, type Vec3 } from '../../src/math/vec3';
import { expandGreybox } from '../../src/world/greybox';
import type { GreyboxSource, MapData } from '../../src/world/mapTypes';
import { initNav, NAV_TIERS, NavRouter, pathLength } from '../../src/world/nav';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const map: MapData = expandGreybox(greyboxJson as unknown as GreyboxSource);
const poi = (id: string): Vec3 => {
  const p = map.pois.find((x) => x.id === id);
  if (!p) throw new Error(`no POI ${id}`);
  return p.position;
};
const zone = (id: string) => {
  const z = map.accessZones.find((x) => x.id === id);
  if (!z) throw new Error(`no zone ${id}`);
  return z;
};

let router: NavRouter;
beforeAll(async () => {
  await initNav();
  const bins = {} as Record<VehicleTier, Uint8Array>;
  for (const t of NAV_TIERS) bins[t] = new Uint8Array(readFileSync(`${repo}map/nav/greybox-${t}.bin`));
  router = NavRouter.fromBinaries(bins);
});
afterAll(() => router?.destroy());

test('walk distance between two street POIs is ≥ their straight-line distance and finite', () => {
  const a = poi('downtown-poi-02');
  const b = poi('downtown-poi-03');
  const d = router.distance('walk', a, b);
  expect(Number.isFinite(d)).toBe(true);
  expect(d).toBeGreaterThanOrEqual(distance(a, b));
  expect(router.distance('walk', b, a)).toBeCloseTo(d, 0);
});

test('car route from the town gas station to town-poi-01 stops at the closest car point and adds a foot leg up the stairs', () => {
  const station = map.gasStations.find((g) => g.id === 'town-gas')!;
  const door = poi('town-poi-01');
  const route = router.routeToDoor('car', station.pumps[0]!, door);
  expect(route).not.toBeNull();
  const { drive, footLeg, length } = route!;
  expect(distance(drive[0]!, station.pumps[0]!)).toBeLessThan(1);
  expect(footLeg).not.toBeNull();
  const [footStart, footEnd] = footLeg!;
  expect(footStart).toEqual(drive[drive.length - 1]);
  expect(footEnd).toEqual(door);
  // The car stops on the street at the foot of the stairs (not on the terrace) and the courier walks up them.
  const stairs = zone('town-stairs').rect;
  expect(footStart.y).toBeLessThan(1);
  expect(Math.hypot(footStart.x - (stairs.minX + stairs.maxX) / 2, footStart.z - stairs.maxZ)).toBeLessThan(10);
  // The car cannot drive to the door; it stops at the car mesh's closest point to it.
  expect(router.distance('car', station.pumps[0]!, door)).toBe(Infinity);
  const closest = router.closestPoint('car', door, vec3(30, 30, 30));
  expect(closest).not.toBeNull();
  expect(distance(footStart, closest!)).toBeLessThan(0.5);
  expect(router.distance('walk', footStart, door)).toBeLessThan(30);
  expect(length).toBeCloseTo(pathLength(drive) + distance(footStart, door), 6);
});

test('bicycle route up to the terrace uses the steep lane (shorter than the car route via the ramp)', () => {
  const lane = zone('town-steep-lane').rect;
  const x = (lane.minX + lane.maxX) / 2;
  const bottom = vec3(x, 0, lane.maxZ + 4);
  const terrace = vec3(x, 5, lane.minZ - 10);
  const bike = router.distance('bicycle', bottom, terrace);
  const car = router.distance('car', bottom, terrace);
  expect(Number.isFinite(bike)).toBe(true);
  expect(Number.isFinite(car)).toBe(true);
  expect(bike).toBeLessThan(distance(bottom, terrace) + 5);
  expect(car).toBeGreaterThan(bike * 2);
  const route = router.routeToDoor('bicycle', bottom, terrace)!;
  expect(route.footLeg).toBeNull();
  // Every corner of the bicycle path lies in the lane's x band (straight up the lane, not round by the ramp).
  for (const p of route.drive) expect(Math.abs(p.x - x)).toBeLessThan(lane.maxX - lane.minX);
});

test('distance is Infinity for a point inside a building', () => {
  const building = map.solids.find((s) => s.kind === 'building' && s.center.x > 0 && s.center.z < 0 && s.size.y > 12)!;
  const inside = vec3(building.center.x, 1, building.center.z);
  const street = poi('downtown-poi-02');
  for (const t of NAV_TIERS) {
    expect(router.distance(t, inside, street), t).toBe(Infinity);
    expect(router.distance(t, street, inside), t).toBe(Infinity);
  }
});
