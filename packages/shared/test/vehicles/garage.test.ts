import { beforeEach, describe, expect, test } from 'vitest';
import { movementConfig, ordersConfig, ridingConfig } from '../../src/config';
import type { RideTier } from '../../src/config/types';
import { emptyInput } from '../../src/input/inputFrame';
import { vec3, type Vec3 } from '../../src/math/vec3';
import { stepVehicle } from '../../src/vehicles/stepVehicle';
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

/** Collider length along the heading. */
const length = (t: RideTier): number => 2 * (ridingConfig.rides[t].collider.halfLength + ridingConfig.rides[t].collider.radius);

/** `tiers` stand in bay slots 0.. of the first hospital in this order: lengths non-increasing, capsules apart. */
function expectRowInOrder(g: Garage, tiers: RideTier[]): void {
  const h = map.hospitals[0]!;
  const along = (t: RideTier): number => {
    const p = g.state(t).position;
    return (p.x - h.bay.x) * Math.sin(h.bayYaw) + (p.z - h.bay.z) * Math.cos(h.bayYaw);
  };
  tiers.forEach((t, i) => expect(g.spot(t), t).toEqual({ kind: 'parked', ...baySlot(h, i) }));
  for (let i = 1; i < tiers.length; i++) {
    const [front, back] = [tiers[i - 1]!, tiers[i]!];
    expect(length(front)).toBeGreaterThanOrEqual(length(back));
    // along the row each capsule reaches half its length from its centre; neighbours leave a gap
    expect(along(back) - along(front) - length(back) / 2 - length(front) / 2, `${front} / ${back}`).toBeGreaterThan(0);
  }
  assertBayLeavable(g, h);
}

/** Horizontal distance from `p` to the axis of `t` parked in the bay (heading bayYaw). */
function axisGap(t: RideTier, at: Vec3, p: Vec3): number {
  const yaw = map.hospitals[0]!.bayYaw;
  const half = ridingConfig.rides[t].collider.shape === 'lengthwise' ? ridingConfig.rides[t].collider.halfLength : 0;
  const f = vec3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const along = Math.max(-half, Math.min(half, (p.x - at.x) * f.x + (p.z - at.z) * f.z));
  return Math.hypot(p.x - (at.x + f.x * along), p.z - (at.z + f.z * along));
}

/**
 * Every vehicle parked in the bay of `h` can leave: along the row, the free run ahead of its nose or behind its tail
 * (to the next parked or ridden vehicle there, or open road) is at least its own length.
 */
function assertBayLeavable(g: Garage, h = map.hospitals[0]!): void {
  const back = vec3(Math.sin(h.bayYaw), 0, Math.cos(h.bayYaw));
  const row = g
    .owned()
    .filter((t) => g.spot(t).kind !== 'carried')
    .map((t) => {
      const p = g.state(t).position;
      const off = vec3(p.x - h.bay.x, 0, p.z - h.bay.z);
      const along = off.x * back.x + off.z * back.z;
      const side = Math.abs(off.x * back.z - off.z * back.x);
      return { t, along, side, parked: g.spot(t).kind === 'parked' };
    })
    .filter((r) => r.side < 1.5 && r.along > -ridingConfig.bays.spacing / 2)
    .sort((a, b) => a.along - b.along);
  row.forEach((r, i) => {
    if (!r.parked) return;
    const L = length(r.t);
    const ahead = i === 0 ? Infinity : r.along - row[i - 1]!.along - L / 2 - length(row[i - 1]!.t) / 2;
    const behind = i === row.length - 1 ? Infinity : row[i + 1]!.along - r.along - L / 2 - length(row[i + 1]!.t) / 2;
    expect(Math.max(ahead, behind), `${r.t} boxed in: ${row.map((x) => `${x.t}@${x.along.toFixed(2)}`).join(' ')}`).toBeGreaterThanOrEqual(L - 1e-6);
    // and nothing overlaps its neighbours
    expect(Math.min(ahead, behind), `${r.t} overlaps`).toBeGreaterThan(0);
  });
}

/** The car, driven from its bay slot with W (or, failing that, S), gets clear by at least its own length. */
function expectCarDrivesOff(g: Garage): void {
  const v = g.state('car');
  const start = { ...v.position };
  const heading = v.heading;
  const ctx = { map, spec: ridingConfig.rides.car, gravity: movementConfig.gravity, dt: 1 / 30, crashSpeed: ordersConfig.fragile.crashSpeed };
  const drive = (y: number): number => {
    const i = emptyInput();
    i.move = { x: 0, y };
    g.ride('car');
    for (let k = 0; k < 150; k++) stepVehicle(v, g.body('car'), i, ctx);
    const f = vec3(-Math.sin(v.heading), 0, -Math.cos(v.heading));
    const moved = Math.abs((v.position.x - start.x) * f.x + (v.position.z - start.z) * f.z);
    g.parkAt('car', start, heading);
    return moved;
  };
  const forward = drive(1);
  if (forward >= length('car')) return;
  expect(Math.max(forward, drive(-1)), 'the car moves its length forward or in reverse').toBeGreaterThanOrEqual(length('car'));
}

/** `p` 1 m to the side of bay slot `i` of the first hospital. */
const besideSlot = (i: number): Vec3 => {
  const h = map.hospitals[0]!;
  const s = baySlot(h, i).position;
  return vec3(s.x + Math.cos(h.bayYaw), s.y, s.z - Math.sin(h.bayYaw));
};

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
    assertBayLeavable(g, h);
  });

  test('the slots run nose-to-tail behind slot 0, so slot 0 is the front: nothing is parked ahead of the car', () => {
    // A car boxed in by the motorbike 2.2 m ahead of its nose (5.5 m slots) cannot drive off the bay.
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
    assertBayLeavable(g, h);
    // The skateboard is carried, never parked.
    g.setOwned('skateboard', false, h);
    expect(g.owned()).not.toContain('skateboard');
    g.setOwned('skateboard', true, h);
    expect(g.spot('skateboard')).toEqual({ kind: 'carried' });
    expect(g.body('skateboard').collider.isEnabled()).toBe(false);
  });

  test('a car bought behind the bicycle and motorbike moves to slot 0 and they move back, without overlapping (Review Focus 3)', () => {
    const h = map.hospitals[0]!;
    const g = new Garage(physics, map, []);
    for (const t of ['skateboard', 'bicycle', 'motorbike', 'car'] as const) g.setOwned(t, true, h);
    expect(g.spot('car')).toEqual({ kind: 'parked', ...baySlot(h, 0) });
    expect(g.spot('motorbike')).toEqual({ kind: 'parked', ...baySlot(h, 1) });
    expect(g.spot('bicycle')).toEqual({ kind: 'parked', ...baySlot(h, 2) });
    expectRowInOrder(g, ['car', 'motorbike', 'bicycle']);
    expect(ridingConfig.bays.spacing).toBe(5.5);
  });

  describe('bay order: the longest collider parks in front, whatever order the vehicles arrive in', () => {
    const PARKED = ['bicycle', 'motorbike', 'car'] as const;
    const permutations = (xs: readonly RideTier[]): RideTier[][] =>
      xs.length <= 1 ? [[...xs]] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));

    for (const order of permutations(PARKED)) {
      test(`setOwned ${order.join(', ')}`, () => {
        const h = map.hospitals[0]!;
        const g = new Garage(physics, map, []);
        for (const t of order) g.setOwned(t, true, h);
        expectRowInOrder(g, ['car', 'motorbike', 'bicycle']);
        expectCarDrivesOff(g);
      });

      test(`tow ${order.join(', ')}`, () => {
        const h = map.hospitals[0]!;
        // all three parked away from the bay, then towed in this order
        const g = new Garage(physics, map, PARKED.map((tier, i) => ({ tier, spot: { kind: 'parked' as const, position: vec3(-60 + 15 * i, 0, -60), heading: 0 }, fuel: 0.5 })));
        for (const t of order) g.tow(t, h);
        expectRowInOrder(g, ['car', 'motorbike', 'bicycle']);
        for (const t of PARKED) expect(g.state(t).fuel).toBe(0.5);
        expectCarDrivesOff(g);
      });
    }

    test('courier beside the motorbike in slot 0 buys the car: the motorbike stays, the car does not overlap the courier', () => {
      const h = map.hospitals[0]!;
      const g = new Garage(physics, map, []);
      g.setOwned('motorbike', true, h);
      const s0 = baySlot(h, 0).position;
      // 1 m to the motorbike's side (bayYaw -π/2 faces +x, so its side is ±z)
      const courier = vec3(s0.x, s0.y, s0.z + 1);
      g.setOwned('car', true, h, courier);
      expect(g.spot('motorbike')).toEqual({ kind: 'parked', ...baySlot(h, 0) });
      expect(g.spot('car')).toEqual({ kind: 'parked', ...baySlot(h, 1) });
      const c = ridingConfig.rides.car.collider;
      expect(axisGap('car', g.state('car').position, courier)).toBeGreaterThan(c.radius + movementConfig.capsule.radius);
      // the same through tow
      const t = new Garage(createPhysicsWorld(physics.rapier, map), map, [{ tier: 'car', spot: { kind: 'parked', position: vec3(-60, 0, -60), heading: 0 }, fuel: 1 }]);
      t.setOwned('motorbike', true, h);
      t.tow('car', h, courier);
      expect(t.spot('motorbike')).toEqual({ kind: 'parked', ...baySlot(h, 0) });
      expect(t.spot('car')).toEqual({ kind: 'parked', ...baySlot(h, 1) });
      assertBayLeavable(g, h);
      assertBayLeavable(t, h);
    });

    test('tier 3 bay, courier beside the motorbike, buy the car: nobody is boxed in and the car drives off', () => {
      const h = map.hospitals[0]!;
      const g = new Garage(physics, map, []);
      g.setOwned('bicycle', true, h);
      g.setOwned('motorbike', true, h);
      expect(g.spot('motorbike')).toEqual({ kind: 'parked', ...baySlot(h, 0) });
      expect(g.spot('bicycle')).toEqual({ kind: 'parked', ...baySlot(h, 1) });
      g.setOwned('car', true, h, besideSlot(0));
      // the motorbike stays by the courier; the car parks behind it with room to back out; the bicycle leaves a gap
      expect(g.spot('motorbike')).toEqual({ kind: 'parked', ...baySlot(h, 0) });
      expect(g.spot('car')).toEqual({ kind: 'parked', ...baySlot(h, 1) });
      expect(g.spot('bicycle')).toEqual({ kind: 'parked', ...baySlot(h, 3) });
      assertBayLeavable(g, h);
      expectCarDrivesOff(g);
    });

    test('property: every tier set and courier position leaves every bay vehicle a way out, with no overlaps', () => {
      const h = map.hospitals[0]!;
      const couriers: (Vec3 | undefined)[] = [undefined, besideSlot(0), besideSlot(1), besideSlot(2)];
      for (const set of [['bicycle'], ['motorbike'], ['car'], ['bicycle', 'motorbike'], ['bicycle', 'car'], ['motorbike', 'car'], ['bicycle', 'motorbike', 'car']] as RideTier[][]) {
        for (const newcomer of set) {
          for (const courier of couriers) {
            const g = new Garage(createPhysicsWorld(physics.rapier, map), map, []);
            for (const t of set) if (t !== newcomer) g.setOwned(t, true, h);
            const before = new Map(set.map((t) => [t, JSON.stringify(g.spot(t))]));
            g.setOwned(newcomer, true, h, courier);
            const what = `${set.join('+')} then ${newcomer}, courier ${courier ? JSON.stringify(courier) : 'none'}`;
            for (const t of set) {
              expect(g.spot(t).kind, what).toBe('parked');
              // only what was (re)parked now is checked against the courier: one already beside them stays put
              const moved = t === newcomer || before.get(t) !== JSON.stringify(g.spot(t));
              if (courier && moved) expect(axisGap(t, g.state(t).position, courier), `${what}: ${t} on the courier`).toBeGreaterThan(ridingConfig.rides[t].collider.radius + movementConfig.capsule.radius);
            }
            assertBayLeavable(g, h);
          }
        }
      }
    });

    test('courier standing on slot 1: nothing is parked there, the rest keep the longest-in-front order', () => {
      const h = map.hospitals[0]!;
      const g = new Garage(physics, map, []);
      const courier = baySlot(h, 1).position;
      for (const t of PARKED) g.setOwned(t, true, h, courier);
      expect(g.spot('car')).toEqual({ kind: 'parked', ...baySlot(h, 0) });
      expect(g.spot('motorbike')).toEqual({ kind: 'parked', ...baySlot(h, 2) });
      expect(g.spot('bicycle')).toEqual({ kind: 'parked', ...baySlot(h, 3) });
      for (const t of PARKED) {
        expect(axisGap(t, g.state(t).position, courier), t).toBeGreaterThan(ridingConfig.rides[t].collider.radius + movementConfig.capsule.radius);
      }
      assertBayLeavable(g, h);
    });

    test('a ridden vehicle or one parked by hand over a slot stays put; the bay orders the rest around it', () => {
      const h = map.hospitals[0]!;
      const g = new Garage(physics, map, []);
      g.setOwned('bicycle', true, h); // slot 0
      g.ride('bicycle'); // ridden, still over slot 0
      g.setOwned('motorbike', true, h);
      g.setOwned('car', true, h);
      expect(g.spot('bicycle')).toEqual({ kind: 'riding' });
      expect(g.spot('car')).toEqual({ kind: 'parked', ...baySlot(h, 1) });
      // the car has the ridden bicycle 2.45 m ahead, so it backs out: slot 2 stays free and the motorbike takes slot 3
      expect(g.spot('motorbike')).toEqual({ kind: 'parked', ...baySlot(h, 3) });
      assertBayLeavable(g, h);

      const hand = new Garage(createPhysicsWorld(physics.rapier, map), map, []);
      const s1 = baySlot(h, 1).position;
      hand.setOwned('motorbike', true, h);
      hand.parkAt('motorbike', vec3(s1.x + 0.5, s1.y, s1.z), 0.3); // near slot 1, not on it
      hand.setOwned('bicycle', true, h);
      hand.setOwned('car', true, h);
      expect(hand.spot('motorbike')).toEqual({ kind: 'parked', position: vec3(s1.x + 0.5, s1.y, s1.z), heading: 0.3 });
      expect(hand.spot('car')).toEqual({ kind: 'parked', ...baySlot(h, 0) });
      expect(hand.spot('bicycle')).toEqual({ kind: 'parked', ...baySlot(h, 2) });
      assertBayLeavable(hand, h);
    });
  });

  test('setOwned(true) does not park on a vehicle being ridden over slot 0', () => {
    const h = map.hospitals[0]!;
    const g = new Garage(physics, map, defaultGarage(map));
    g.ride('car'); // still standing over slot 0
    g.setOwned('bicycle', false, h);
    g.setOwned('bicycle', true, h);
    expect(g.spot('bicycle')).toEqual({ kind: 'parked', ...baySlot(h, 2) });
    assertBayLeavable(g, h);
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
    assertBayLeavable(g, h);
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
