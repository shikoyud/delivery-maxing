import { beforeAll, describe, expect, test } from 'vitest';
import { movementConfig, ordersConfig, ridingConfig } from '../../src/config';
import type { RideTier } from '../../src/config/types';
import { emptyInput, type InputFrame } from '../../src/input/inputFrame';
import { vec3, type Vec3 } from '../../src/math/vec3';
import type { SimEvent } from '../../src/movement/types';
import { forbiddenZoneAt } from '../../src/world/access';
import type { MapData } from '../../src/world/mapTypes';
import { createPhysicsWorld, initRapier, type PhysicsWorld } from '../../src/world/physicsWorld';
import { facing } from '../../src/movement/ground';
import { stepVehicle } from '../../src/vehicles/stepVehicle';
import type { VehicleState } from '../../src/vehicles/types';
import { VehicleBody } from '../../src/vehicles/VehicleBody';
import { box } from '../helpers/simHarness';
import { emptyMap } from '../world/fixtures';

const DT = 1 / 30;
const RAMP_DEG = (Math.atan(0.14) * 180) / Math.PI;

/**
 * Fixture: floor top at y = 0; a wall (face z = -19) at x = 0; an alley zone x 30..34, z -40..-20; a 14 % ramp
 * rising toward -Z at x = -30 (top ~2.7 m); 0.25 m stairs at x = 60 (first riser at z = -20); a 9 m platform at
 * x -70..-50, z -10..10; a side wall with its face at x = 80.
 */
const fixtureMap = (): MapData => ({
  ...emptyMap(),
  solids: [
    box('floor', vec3(0, -0.5, 0), vec3(200, 1, 200), { kind: 'ground' }),
    box('wall', vec3(0, 2, -20), vec3(20, 4, 2), { kind: 'building' }),
    box('ramp', vec3(-30, 1.05, -20), vec3(4, 0.5, 20), { kind: 'ramp', rotationDeg: vec3(RAMP_DEG, 0, 0) }),
    box('step0', vec3(60, 0.125, -20.15), vec3(4, 0.25, 0.3)),
    box('step1', vec3(60, 0.25, -20.45), vec3(4, 0.5, 0.3)),
    box('step2', vec3(60, 0.375, -20.75), vec3(4, 0.75, 0.3)),
    box('ledge', vec3(-60, 4.5, 0), vec3(20, 9, 20), { kind: 'building' }),
    box('sideWall', vec3(81, 2, -10), vec3(2, 4, 40), { kind: 'building' }),
    // Wedge fixtures (playtest issue 1): a wall along x with its face at z = 59.2 (0.3 m from a motorbike at z = 60);
    // a second one at z = 89.2 plus a wall across x with its face at x = 1.4 (0.3 m past the nose of a +x motorbike).
    box('wedgeLeft', vec3(0, 2, 58.2), vec3(20, 4, 2), { kind: 'building' }),
    box('wedge2Left', vec3(0, 2, 88.2), vec3(20, 4, 2), { kind: 'building' }),
    box('wedge2Ahead', vec3(2.4, 2, 90), vec3(2, 4, 12), { kind: 'building' }),
  ],
  accessZones: [{ id: 'alley-x', kind: 'alley', rect: { minX: 30, minZ: -40, maxX: 34, maxZ: -20 }, minY: 0, maxY: 0 }],
});

let map: MapData;
let physics: PhysicsWorld;

beforeAll(async () => {
  map = fixtureMap();
  physics = createPhysicsWorld(await initRapier(), map);
});

const input = (forward: number, strafe = 0): InputFrame => {
  const i = emptyInput();
  i.move = { x: strafe, y: forward };
  i.look = { yaw: 0, pitch: 0 };
  return i;
};

/** Forward/back input with the camera looking along `yaw`. */
const inputYaw = (forward: number, yaw: number): InputFrame => {
  const i = input(forward);
  i.look = { yaw, pitch: 0 };
  return i;
};

interface Rig {
  v: VehicleState;
  body: VehicleBody;
  step(i?: InputFrame): SimEvent[];
  run(ticks: number, i?: InputFrame, each?: (v: VehicleState) => void): SimEvent[];
}

/** A vehicle resting at `feet`; three idle ticks settle it on the ground. Each test builds its own body. */
function rig(tier: RideTier, feet: Vec3, heading = 0): Rig {
  const body = new VehicleBody(physics, ridingConfig.rides[tier], feet, heading);
  const v: VehicleState = {
    tier, position: body.feet, heading, velocity: vec3(0, 0, 0), grounded: true, groundNormal: vec3(0, 1, 0), airApexY: feet.y, fuel: 1,
  };
  const ctx = { map, spec: ridingConfig.rides[tier], gravity: movementConfig.gravity, dt: DT, crashSpeed: ordersConfig.fragile.crashSpeed };
  const r: Rig = {
    v,
    body,
    step: (i = input(0)) => stepVehicle(v, body, i, ctx),
    run(ticks, i = input(0), each) {
      const out: SimEvent[] = [];
      for (let k = 0; k < ticks; k++) {
        out.push(...r.step(i));
        each?.(v);
      }
      return out;
    },
  };
  r.run(3);
  return r;
}

const crashes = (ev: SimEvent[]) => ev.filter((e): e is Extract<SimEvent, { kind: 'crashed' }> => e.kind === 'crashed');

describe('stepVehicle', () => {
  test('car at 10.5 m/s into a wall: one crashed event with speed ≈ 10.5, velocity into the wall removed', () => {
    // Nose (halfLength + radius = 2.2 m ahead of the feet) 0.2 m from the wall face at z = -19.
    const r = rig('car', vec3(0, 0, -19 + 2.2 + 0.2));
    r.v.velocity = vec3(0, 0, -10.5);
    const ev = r.run(15);
    const c = crashes(ev);
    expect(c).toHaveLength(1);
    expect(c[0]!.speed).toBeGreaterThan(10.3);
    expect(c[0]!.speed).toBeLessThanOrEqual(10.5);
    expect(r.v.velocity.z).toBeGreaterThanOrEqual(-1e-6);
    expect(r.v.position.z).toBeGreaterThan(-19 + 2.2 - 0.05);
    r.body.destroy();
  });

  test('car at 9.5 m/s into a wall: no crashed event', () => {
    const r = rig('car', vec3(0, 0, -19 + 2.2 + 0.2));
    r.v.velocity = vec3(0, 0, -9.5);
    const ev = r.run(15);
    expect(crashes(ev)).toHaveLength(0);
    expect(r.v.velocity.z).toBeGreaterThanOrEqual(-1e-6);
    r.body.destroy();
  });

  test('car toward an alley: accessBlocked once, never enters the zone over 3 s of W', () => {
    const r = rig('car', vec3(32, 0, -15));
    const ev = r.run(90, input(1), (v) => expect(forbiddenZoneAt(map, 'car', v.position)).toBeNull());
    const blocked = ev.filter((e) => e.kind === 'accessBlocked');
    expect(blocked).toEqual([{ kind: 'accessBlocked', zone: 'alley' }]);
    // The nose (2.2 m ahead of the centre) stops 0.05 m before the zone edge at z = -20.
    expect(r.v.position.z).toBeCloseTo(-20 + 2.2 + 0.05, 3);
    expect(crashes(ev)).toHaveLength(0);
    r.body.destroy();
  });

  test('bicycle climbs the 14 % ramp; the 0.25 m stairs stop it', () => {
    const up = rig('bicycle', vec3(-30, 0, -5));
    let maxY = 0;
    up.run(180, input(1), (v) => { maxY = Math.max(maxY, v.position.y); });
    expect(maxY).toBeGreaterThan(2.3);
    up.body.destroy();

    const stairs = rig('bicycle', vec3(60, 0, -15));
    let maxStairY = 0;
    let minZ = Infinity;
    stairs.run(120, input(1), (v) => { maxStairY = Math.max(maxStairY, v.position.y); minZ = Math.min(minZ, v.position.z); });
    expect(maxStairY).toBeLessThan(0.05);
    expect(minZ).toBeGreaterThan(-20);
    expect(Math.hypot(stairs.v.velocity.x, stairs.v.velocity.z)).toBeLessThan(1);
    stairs.body.destroy();
  });

  test('a lengthwise car beside a wall cannot turn its nose into the wall (heading unchanged)', () => {
    // Side 0.03 m from the wall face at x = 80, nose toward -Z; W + D steers right, toward the wall.
    const r = rig('car', vec3(80 - 0.95 - 0.03, 0, 0));
    r.run(15, input(1, 1), (v) => expect(v.heading).toBe(0));
    expect(r.body.heading).toBe(0);
    // Steering away turns it once the swinging tail clears the wall (the car pivots about its centre).
    r.run(20, input(1, -1));
    expect(r.v.heading).toBeGreaterThan(0.05);
    r.body.destroy();
  });

  test('driving off the 9 m ledge emits landed with fallHeight ≈ 9', () => {
    const r = rig('car', vec3(-60, 9, 5));
    expect(r.v.grounded).toBe(true);
    const ev = r.run(150, input(1));
    const landed = ev.filter((e) => e.kind === 'landed');
    expect(landed).toHaveLength(1);
    expect((landed[0] as { fallHeight: number }).fallHeight).toBeCloseTo(9, 0);
    expect(r.v.position.y).toBeLessThan(0.05);
    r.body.destroy();
  });

  test('a stopped motorbike beside a wall turns the long way round and drives off (playtest issue 1)', () => {
    // Heading +X, wall 0.3 m to its left; W with the camera behind (wish = -X).
    const r = rig('motorbike', vec3(0, 0, 60), -Math.PI / 2);
    r.run(90, inputYaw(1, Math.PI / 2));
    const toGo = Math.abs(Math.atan2(Math.sin(r.v.heading - Math.PI / 2), Math.cos(r.v.heading - Math.PI / 2)));
    expect(toGo).toBeLessThan(0.2);
    expect(Math.hypot(r.v.position.x, r.v.position.z - 60)).toBeGreaterThan(3);
    r.body.destroy();
  });

  test('a stopped motorbike with a wall ahead and one beside it backs out on S', () => {
    const r = rig('motorbike', vec3(0, 0, 90), -Math.PI / 2);
    let minSpeed = 0;
    r.run(60, inputYaw(-1, -Math.PI / 2), (v) => {
      const f = facing(v.heading);
      minSpeed = Math.min(minSpeed, v.velocity.x * f.x + v.velocity.z * f.z);
    });
    expect(r.v.position.x).toBeLessThan(-1.5);
    expect(minSpeed).toBeGreaterThanOrEqual(-2.5 - 1e-9);
    r.body.destroy();
  });

  test('the car still reverses at reverseSpeed and the skateboard never reverses', () => {
    const car = rig('car', vec3(40, 0, 40));
    car.run(90, input(-1));
    const cf = facing(car.v.heading);
    expect(car.v.velocity.x * cf.x + car.v.velocity.z * cf.z).toBeCloseTo(-6, 6);
    car.body.destroy();
    const board = rig('skateboard', vec3(40, 0, 70));
    let minSpeed = 0;
    board.run(60, input(-1), (v) => {
      const f = facing(v.heading);
      minSpeed = Math.min(minSpeed, v.velocity.x * f.x + v.velocity.z * f.z);
    });
    expect(minSpeed).toBeGreaterThanOrEqual(-1e-9);
    board.body.destroy();
  });
});
