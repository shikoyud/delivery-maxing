import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import greyboxJson from '../../../../map/greybox.json';
import { ridingConfig, type RideTier, type VehicleTier } from '../../src/config';
import { vec3, type Vec3 } from '../../src/math/vec3';
import { forbiddenZoneAt, zoneAt } from '../../src/world/access';
import { expandGreybox } from '../../src/world/greybox';
import type { GreyboxSource, MapData } from '../../src/world/mapTypes';
import { initNav, NAV_TIERS, NavRouter } from '../../src/world/nav';
import { createPhysicsWorld, initRapier, type PhysicsWorld } from '../../src/world/physicsWorld';
import { defaultGarage, Garage } from '../../src/vehicles/Garage';
import { findRoadSpot } from '../../src/vehicles/summon';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const map: MapData = expandGreybox(greyboxJson as unknown as GreyboxSource);
const S = ridingConfig.summon;
const flat = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

let router: NavRouter;
let physics: PhysicsWorld;
let garage: Garage;

beforeAll(async () => {
  await initNav();
  const bins = {} as Record<VehicleTier, Uint8Array>;
  for (const t of NAV_TIERS) bins[t] = new Uint8Array(gunzipSync(readFileSync(`${repo}map/nav/greybox-${t}.bin.gz`)));
  router = NavRouter.fromBinaries(bins);
});
afterAll(() => router?.destroy());

beforeEach(async () => {
  physics = createPhysicsWorld(await initRapier(), map);
  garage = new Garage(physics, map, defaultGarage(map));
});

/** Summons `t` to `player` (heading `heading`) at sim time `now`, searching spots with the real router. */
const summon = (t: RideTier, player: Vec3, now: number, heading = 0) =>
  garage.summon(t, player, now, (tier) => findRoadSpot(router, garage, tier, player, heading));

/** Whether a small probe ball 1 m above `p` overlaps any enabled collider. */
function solidAt(p: Vec3): boolean {
  const { rapier, world } = physics;
  return world.intersectionWithShape(vec3(p.x, p.y + 1, p.z), { x: 0, y: 0, z: 0, w: 1 }, new rapier.Ball(0.2)) !== null;
}

describe('summon', () => {
  test('a car 240 m away comes to a spot ≥ 3 m from the player, on the car mesh, outside alleys', () => {
    const was = { ...garage.state('car').position };
    const player = vec3(100, 0, 156);
    expect(flat(player, was)).toBeGreaterThan(230);
    expect(summon('car', player, 0, 0.7)).toBe('ok');
    const spot = garage.spot('car');
    expect(spot.kind).toBe('parked');
    const p = garage.state('car').position;
    expect(flat(p, player)).toBeGreaterThanOrEqual(S.minClearance);
    expect(flat(p, player)).toBeLessThan(S.minClearance + 4);
    expect(garage.state('car').heading).toBe(0.7);
    // On the car mesh, resting on the ground (navmesh points sit a cell above it), outside every alley.
    const onMesh = router.closestPoint('car', p, vec3(0.5, 1, 0.5));
    expect(onMesh).not.toBeNull();
    expect(p.y).toBeCloseTo(0, 1);
    expect(zoneAt(map, p)?.kind).not.toBe('alley');
    expect(forbiddenZoneAt(map, 'car', p)).toBeNull();
    // Moved: solid at the new spot, gone from the bay.
    expect(solidAt(p)).toBe(true);
    expect(solidAt(was)).toBe(false);
    expect(garage.body('car').collider.isEnabled()).toBe(true);
    expect(garage.summonReadyAt).toBe(S.cooldownSeconds);
  });

  test('within 100 m: tooClose; a second summon 30 s later: cooldown; 60 s later: ok', () => {
    const bay = garage.state('car').position;
    const near = vec3(bay.x, 0, bay.z + 60);
    expect(summon('car', near, 0)).toBe('tooClose');
    expect(garage.summonReadyAt).toBe(0); // a refusal never starts the cooldown
    expect(summon('motorbike', vec3(100, 0, 156), 10)).toBe('ok');
    // One cooldown for every vehicle: the car is refused too.
    expect(summon('car', vec3(100, 0, 156), 40)).toBe('cooldown');
    expect(garage.summonStatus('car', vec3(100, 0, 156), 40)).toBe('cooldown');
    expect(summon('car', vec3(-100, 0, 100), 70)).toBe('ok');
    expect(flat(garage.state('car').position, vec3(-100, 0, 100))).toBeLessThan(S.minClearance + 4);
  });

  test('Review Focus 3: player on the stairs: the car lands at the nearest car-mesh point off the stairs', () => {
    const stairs = map.accessZones.find((z) => z.id === 'town-stairs')!;
    const player = vec3((stairs.rect.minX + stairs.rect.maxX) / 2, 2.5, (stairs.rect.minZ + stairs.rect.maxZ) / 2);
    expect(forbiddenZoneAt(map, 'car', player)?.kind).toBe('stairs');
    expect(summon('car', player, 0)).toBe('ok');
    const p = garage.state('car').position;
    expect(forbiddenZoneAt(map, 'car', p)).toBeNull();
    expect(zoneAt(map, p)?.kind).not.toBe('stairs');
    expect(router.closestPoint('car', p, vec3(0.5, 1, 0.5))).not.toBeNull();
    expect(flat(p, player)).toBeGreaterThanOrEqual(S.minClearance);
    // The nearest car-mesh point to the stairs lies just off their side; the car comes within a couple of metres of it.
    const nearest = router.closestPoint('car', player, vec3(S.searchRadius, 4, S.searchRadius))!;
    expect(flat(p, player)).toBeLessThan(flat(nearest, player) + 2.5);
  });

  test('Review Focus 3: no car mesh within the search radius: noSpot, and the cooldown is not started', () => {
    // On top of a 39 m tower: no car mesh within reach.
    const roof = vec3(14.5, 39, -264.5);
    const was = { ...garage.state('car').position };
    expect(findRoadSpot(router, garage, 'car', roof, 0)).toBeNull();
    expect(summon('car', roof, 0)).toBe('noSpot');
    expect(garage.summonReadyAt).toBe(0);
    expect(garage.state('car').position).toEqual(was);
    expect(summon('car', vec3(100, 0, 156), 1)).toBe('ok');
  });

  test('the skateboard (carried) and the ridden vehicle cannot be summoned', () => {
    const far = vec3(100, 0, 156);
    expect(summon('skateboard', far, 0)).toBe('carried');
    garage.ride('bicycle');
    expect(summon('bicycle', far, 0)).toBe('riding');
    expect(garage.summonReadyAt).toBe(0);
  });
});
