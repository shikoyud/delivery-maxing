import { beforeEach, describe, expect, test } from 'vitest';
import { ridingConfig } from '../../src/config';
import { vec3, type Vec3 } from '../../src/math/vec3';
import { baySlot } from '../../src/world/access';
import type { MapData } from '../../src/world/mapTypes';
import { createPhysicsWorld, initRapier, type PhysicsWorld } from '../../src/world/physicsWorld';
import { defaultGarage, Garage } from '../../src/vehicles/Garage';
import { emptyMap } from '../world/fixtures';

let map: MapData;
let physics: PhysicsWorld;

beforeEach(async () => {
  map = emptyMap();
  physics = createPhysicsWorld(await initRapier(), map);
});

/** Whether a small probe ball at `p` (1 m above the feet) overlaps any enabled collider. */
function solidAt(p: Vec3): boolean {
  const { rapier, world } = physics;
  return world.intersectionWithShape(vec3(p.x, p.y + 1, p.z), { x: 0, y: 0, z: 0, w: 1 }, new rapier.Ball(0.2)) !== null;
}

describe('Garage', () => {
  test('defaultGarage owns all four: skateboard carried, others in bay slots 0-2 with full tanks, the car in front', () => {
    const saved = defaultGarage(map);
    const h = map.hospitals[0]!;
    expect(saved).toEqual([
      { tier: 'skateboard', spot: { kind: 'carried' }, fuel: 1 },
      { tier: 'bicycle', spot: { kind: 'parked', ...baySlot(h, 2) }, fuel: 1 },
      { tier: 'motorbike', spot: { kind: 'parked', ...baySlot(h, 1) }, fuel: 1 },
      { tier: 'car', spot: { kind: 'parked', ...baySlot(h, 0) }, fuel: 1 },
    ]);
    const g = new Garage(physics, map, saved);
    expect(g.owned()).toEqual(['skateboard', 'bicycle', 'motorbike', 'car']);
    expect(g.spot('skateboard')).toEqual({ kind: 'carried' });
    expect(g.body('skateboard').collider.isEnabled()).toBe(false);
    for (const [i, t] of (['car', 'motorbike', 'bicycle'] as const).entries()) {
      const slot = baySlot(h, i);
      expect(g.state(t).position).toEqual(slot.position);
      expect(g.state(t).heading).toBe(slot.heading);
      expect(g.state(t).fuel).toBe(1);
      expect(g.body(t).collider.isEnabled()).toBe(true);
      expect(solidAt(slot.position)).toBe(true);
    }
    expect(g.nearestParked(baySlot(h, 0).position, 2.5)).toBe('car');
    expect(g.nearestParked(vec3(50, 0, 50), 2.5)).toBeNull();
  });

  test('the slots run nose-to-tail behind slot 0, so slot 0 is the front: nothing is parked ahead of the car', () => {
    // A car boxed in by the motorbike 0.7 m ahead of its nose cannot drive off the bay (SP5 Task 1 put it in slot 2).
    const h = map.hospitals[0]!;
    const car = defaultGarage(map).find((v) => v.tier === 'car')!.spot as { position: Vec3; heading: number };
    const ahead = vec3(-Math.sin(car.heading), 0, -Math.cos(car.heading));
    for (const v of defaultGarage(map)) {
      if (v.tier === 'car' || v.spot.kind !== 'parked') continue;
      const d = (v.spot.position.x - car.position.x) * ahead.x + (v.spot.position.z - car.position.z) * ahead.z;
      expect(d, v.tier).toBeLessThan(0);
    }
    expect(h.bayYaw).toBe(car.heading);
  });

  test('setOwned(false) removes the collider; setOwned(true) parks at the first free slot', () => {
    const h = map.hospitals[0]!;
    const g = new Garage(physics, map, defaultGarage(map));
    g.setOwned('bicycle', false, h);
    expect(g.owned()).toEqual(['skateboard', 'motorbike', 'car']);
    expect(g.body('bicycle').collider.isEnabled()).toBe(false);
    expect(solidAt(baySlot(h, 2).position)).toBe(false);
    expect(g.snapshot().map((v) => v.tier)).toEqual(['skateboard', 'motorbike', 'car']);

    // Slots 0 and 2 are free: the car, disowned and re-bought, parks at the first of them.
    g.setOwned('car', false, h);
    g.setOwned('car', true, h);
    expect(g.spot('car')).toEqual({ kind: 'parked', ...baySlot(h, 0) });
    expect(g.body('car').collider.isEnabled()).toBe(true);
    expect(g.state('car').fuel).toBe(1);
    // Slots 0 and 1 are taken: the bicycle goes to slot 2.
    g.setOwned('bicycle', true, h);
    expect(g.spot('bicycle')).toEqual({ kind: 'parked', ...baySlot(h, 2) });
    // The skateboard is carried, never parked.
    g.setOwned('skateboard', false, h);
    expect(g.owned()).not.toContain('skateboard');
    g.setOwned('skateboard', true, h);
    expect(g.spot('skateboard')).toEqual({ kind: 'carried' });
    expect(g.body('skateboard').collider.isEnabled()).toBe(false);
  });

  test('a car bought behind the bicycle and motorbike takes slot 2 without overlapping them (5.5 m slots, Review Focus 3)', () => {
    const h = map.hospitals[0]!;
    const g = new Garage(physics, map, []);
    for (const t of ['skateboard', 'bicycle', 'motorbike', 'car'] as const) g.setOwned(t, true, h);
    expect(g.spot('car')).toEqual({ kind: 'parked', ...baySlot(h, 2) });
    // Along the row each capsule reaches halfLength + radius from its centre; neighbours must leave a gap.
    const reach = (t: 'bicycle' | 'motorbike' | 'car'): number => ridingConfig.rides[t].collider.halfLength + ridingConfig.rides[t].collider.radius;
    const along = (t: 'bicycle' | 'motorbike' | 'car'): number => {
      const p = g.state(t).position;
      return (p.x - h.bay.x) * Math.sin(h.bayYaw) + (p.z - h.bay.z) * Math.cos(h.bayYaw);
    };
    expect(along('motorbike') - along('bicycle') - reach('motorbike') - reach('bicycle')).toBeGreaterThan(0);
    expect(along('car') - along('motorbike') - reach('car') - reach('motorbike')).toBeGreaterThan(0);
    expect(ridingConfig.bays.spacing).toBe(5.5);
  });

  test('setOwned(true) does not park on a vehicle being ridden over slot 0', () => {
    const h = map.hospitals[0]!;
    const g = new Garage(physics, map, defaultGarage(map));
    g.ride('car'); // still standing over slot 0
    g.setOwned('bicycle', false, h);
    g.setOwned('bicycle', true, h);
    expect(g.spot('bicycle')).toEqual({ kind: 'parked', ...baySlot(h, 2) });
  });

  test('snapshot round-trips through the constructor', () => {
    const saved = defaultGarage(map);
    saved[2] = { tier: 'motorbike', spot: { kind: 'parked', position: vec3(30, 0, -12), heading: 1.1 }, fuel: 0.4 };
    saved.splice(1, 1); // no bicycle
    const g = new Garage(physics, map, saved);
    const snap = g.snapshot();
    expect(snap).toEqual(saved);
    const again = new Garage(createPhysicsWorld(physics.rapier, map), map, snap);
    expect(again.snapshot()).toEqual(saved);
    expect(again.owned()).toEqual(['skateboard', 'motorbike', 'car']);
    expect(again.state('motorbike').fuel).toBe(0.4);
  });

  test('tow parks the vehicle at the first free bay slot of the hospital, fuel unchanged', () => {
    const h = map.hospitals[0]!;
    const saved = defaultGarage(map);
    saved[3] = { tier: 'car', spot: { kind: 'parked', position: vec3(60, 0, 60), heading: 2 }, fuel: 0.25 };
    const g = new Garage(physics, map, saved);
    g.tow('car', h);
    expect(g.spot('car')).toEqual({ kind: 'parked', ...baySlot(h, 0) });
    expect(g.state('car').fuel).toBe(0.25);
    expect(g.state('car').velocity).toEqual(vec3(0, 0, 0));
    expect(solidAt(vec3(60, 0, 60))).toBe(false);
    g.tow('skateboard', h);
    expect(g.spot('skateboard')).toEqual({ kind: 'carried' });
  });

  test('nearestParked: the vertical reach is riding.mountReachHeight (final review 9)', () => {
    const cfg = structuredClone(ridingConfig);
    const saved = [{ tier: 'car' as const, spot: { kind: 'parked' as const, position: vec3(0, 2, 0), heading: 0 }, fuel: 1 }];
    expect(new Garage(physics, map, saved, cfg).nearestParked(vec3(1, 0, 0), 2.5)).toBeNull();
    cfg.riding.mountReachHeight = 2.5;
    expect(new Garage(physics, map, saved, cfg).nearestParked(vec3(1, 0, 0), 2.5)).toBe('car');
  });
});
