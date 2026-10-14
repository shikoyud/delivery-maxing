import { describe, expect, test } from 'vitest';
import { movementConfig as cfg, ridingConfig } from '../../src/config';
import { horizontalLength, vec3, type Vec3 } from '../../src/math/vec3';
import type { PlayerState } from '../../src/movement/types';
import type { SavedVehicle } from '../../src/vehicles/Garage';
import { box, makeSim, type Harness } from '../helpers/simHarness';

const seconds = (t: number) => Math.round(t * cfg.tickRate);
const speed = (s: PlayerState) => horizontalLength(s.velocity);
const R = ridingConfig.riding;
const CAR = ridingConfig.rides.car.collider;
const CAPSULE = cfg.capsule.radius;

const skateboard: SavedVehicle = { tier: 'skateboard', spot: { kind: 'carried' }, fuel: 1 };
const parked = (tier: SavedVehicle['tier'], position: Vec3, heading = 0): SavedVehicle => ({
  tier,
  spot: { kind: 'parked', position, heading },
  fuel: 1,
});

function mount(h: Harness, tier: string): void {
  expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'mounted', tier });
  expect(h.sim.state.riding).toBe(tier);
}

describe('mounting', () => {
  test('F within 2.5 m of the parked car mounts it; at 3 m it pulls out the skateboard instead', async () => {
    const carAt = vec3(0, 0, -10);
    const near = await makeSim({ spawn: vec3(2.4, 0, -10), garage: [skateboard, parked('car', carAt, 0.5)] });
    expect(near.sim.mountCandidate()).toBe('car');
    mount(near, 'car');
    const s = near.sim.state;
    expect(s.lastRide).toBe('car');
    expect(s.heading).toBe(0.5);
    expect(s.position.x).toBeCloseTo(carAt.x, 5);
    expect(s.position.z).toBeCloseTo(carAt.z, 5);
    expect(near.sim.body.collider.isEnabled()).toBe(false);
    expect(near.sim.garage.spot('car')).toEqual({ kind: 'riding' });
    expect(near.sim.mountCandidate()).toBeNull();

    const far = await makeSim({ spawn: vec3(3, 0, -10), garage: [skateboard, parked('car', carAt, 0.5)] });
    expect(far.sim.mountCandidate()).toBe('skateboard');
    const feet = far.sim.state.position;
    mount(far, 'skateboard');
    const board = far.sim.garage.body('skateboard');
    expect(board.collider.isEnabled()).toBe(true);
    expect(board.feet.x).toBeCloseTo(feet.x, 5);
    expect(board.feet.z).toBeCloseTo(feet.z, 5);
    expect(far.sim.garage.spot('car')).toEqual({ kind: 'parked', position: carAt, heading: 0.5 });
  });

  test('F is ignored while airborne, crouched or mid-slide', async () => {
    const h = await makeSim();
    h.tick({}, ['jump']);
    expect(h.sim.state.grounded).toBe(false);
    expect(h.sim.mountCandidate()).toBeNull();
    expect(h.tick({}, ['mount']).some((e) => e.kind === 'mounted')).toBe(false);
    expect(h.sim.state.riding).toBeNull();
    h.runUntil((s) => s.grounded, 60);

    h.tick({ crouch: true });
    expect(h.sim.mountCandidate()).toBeNull();
    expect(h.tick({ crouch: true }, ['mount']).some((e) => e.kind === 'mounted')).toBe(false);
    expect(h.sim.state.riding).toBeNull();
    h.run(5);

    h.run(seconds(2), { forward: 1, sprint: true });
    h.tick({ forward: 1, sprint: true }, ['crouch']);
    expect(h.sim.state.mode).toBe('slide');
    expect(h.sim.mountCandidate()).toBeNull();
    expect(h.tick({ forward: 1, sprint: true, crouch: true }, ['mount']).some((e) => e.kind === 'mounted')).toBe(false);
    expect(h.sim.state.riding).toBeNull();
    expect(h.sim.state.mode).toBe('slide');
  });
});

describe('riding', () => {
  test('riding the car: courier position follows the car; 10 s of W reaches 28 m/s', async () => {
    const h = await makeSim({ size: 800, spawn: vec3(2, 0, 300), garage: [skateboard, parked('car', vec3(0, 0, 300))] });
    h.sim.state.stamina = 10;
    mount(h, 'car');
    const car = h.sim.garage.state('car');
    for (let i = 0; i < seconds(10); i++) {
      h.tick({ forward: 1 });
      const s = h.sim.state;
      expect(s.position).toEqual(car.position);
      expect(s.velocity).toEqual(car.velocity);
      expect(s.heading).toBe(car.heading);
      expect(s.grounded).toBe(car.grounded);
      expect(s.mode).toBe(car.grounded ? 'ground' : 'air');
    }
    expect(speed(h.sim.state)).toBeCloseTo(28, 1);
    expect(h.sim.state.position.z).toBeLessThan(100);
    expect(h.sim.state.stamina).toBeGreaterThan(10);
  });

  test('F at 5 m/s: mountRefused tooFast, still riding', async () => {
    const h = await makeSim({ spawn: vec3(2, 0, 60), garage: [skateboard, parked('car', vec3(0, 0, 60))] });
    mount(h, 'car');
    h.runUntil((s) => speed(s) >= 5, 60, { forward: 1 });
    expect(h.tick({ forward: 1 }, ['mount'])).toContainEqual({ kind: 'mountRefused', reason: 'tooFast' });
    expect(h.sim.state.riding).toBe('car');
    expect(h.sim.garage.spot('car')).toEqual({ kind: 'riding' });
  });

  test('dismount puts the courier on the left; with a wall on the left, on the right', async () => {
    const side = CAR.radius + CAPSULE + R.dismountGap;
    const open = await makeSim({ spawn: vec3(2, 0, -10), garage: [skateboard, parked('car', vec3(0, 0, -10))] });
    mount(open, 'car');
    expect(open.tick({}, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'car' });
    let s = open.sim.state;
    expect(s.riding).toBeNull();
    expect(s.lastRide).toBe('car');
    expect(s.position.x).toBeCloseTo(-side, 2); // heading 0 faces -Z: left is -X
    expect(s.position.z).toBeCloseTo(-10, 2);
    expect(open.sim.body.collider.isEnabled()).toBe(true);
    const spot = open.sim.garage.spot('car');
    expect(spot.kind).toBe('parked');
    expect(open.sim.garage.body('car').collider.isEnabled()).toBe(true);

    const walled = await makeSim({
      spawn: vec3(2, 0, -10),
      solids: [box('wall', vec3(-2, 2, -10), vec3(1, 4, 10))], // face at x = -1.5
      garage: [skateboard, parked('car', vec3(0, 0, -10))],
    });
    mount(walled, 'car');
    expect(walled.tick({}, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'car' });
    s = walled.sim.state;
    expect(s.position.x).toBeCloseTo(side, 2);
    expect(walled.sim.body.fitsAt(s.position, false)).toBe(true);
  });

  test('Review Focus 1: car in a 4 m gap between a wall and a parked motorbike: dismount behind, else noRoom and still riding, courier never inside a solid', async () => {
    // Wall face at x = -1.8, motorbike centre at x = 2.2: both side spots overlap something.
    const wall = box('wall', vec3(-2.3, 2, 0), vec3(1, 4, 12));
    const garage = [skateboard, parked('car', vec3(0, 0, 0)), parked('motorbike', vec3(2.2, 0, 0))];
    const behind = CAR.halfLength + CAR.radius + CAPSULE + R.dismountGap;

    const h = await makeSim({ spawn: vec3(0, 0, -3.25), solids: [wall], garage });
    expect(h.sim.mountCandidate()).toBe('car');
    mount(h, 'car');
    expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'car' });
    const s = h.sim.state;
    expect(s.position.x).toBeCloseTo(0, 2);
    expect(s.position.z).toBeCloseTo(behind, 2); // heading 0 faces -Z: behind is +Z
    expect(h.sim.body.fitsAt(s.position, false)).toBe(true);

    const blocked = await makeSim({
      spawn: vec3(0, 0, -3.25),
      solids: [wall, box('back', vec3(0, 2, 3.5), vec3(3, 4, 1))],
      garage,
    });
    mount(blocked, 'car');
    const before = blocked.sim.state.position;
    expect(blocked.tick({}, ['mount'])).toContainEqual({ kind: 'mountRefused', reason: 'noRoom' });
    expect(blocked.sim.state.riding).toBe('car');
    expect(blocked.sim.body.collider.isEnabled()).toBe(false);
    expect(blocked.sim.state.position.x).toBeCloseTo(before.x, 3);
    expect(blocked.sim.state.position.z).toBeCloseTo(before.z, 3);
  });
});

describe('parked vehicles', () => {
  test('the parked car blocks the courier walking into it', async () => {
    // Side-on across the path: the side faces the courier at z = -6 + radius.
    const h = await makeSim({ garage: [skateboard, parked('car', vec3(0, 0, -6), Math.PI / 2)] });
    h.run(seconds(3), { forward: 1 });
    expect(h.sim.state.position.z).toBeGreaterThan(-6 + CAR.radius + CAPSULE - 0.05);
    expect(h.sim.mountCandidate()).toBe('car');
  });

  test('the parked car blocks the ridden skateboard', async () => {
    const h = await makeSim({ garage: [skateboard, parked('car', vec3(0, 0, -12), Math.PI / 2)] });
    mount(h, 'skateboard');
    h.run(seconds(4), { forward: 1 });
    const board = ridingConfig.rides.skateboard.collider;
    expect(h.sim.state.position.z).toBeGreaterThan(-12 + CAR.radius + board.radius - 0.05);
    expect(h.sim.garage.state('car').position).toEqual(vec3(0, 0, -12));
  });

  test('skateboard: F off leaves nothing parked; mountCandidate is the skateboard again', async () => {
    const h = await makeSim();
    h.run(seconds(1), { forward: 1, sprint: true });
    expect(h.sim.state.sprinting).toBe(true);
    expect(h.tick({ forward: 1, sprint: true }, ['mount'])).toContainEqual({ kind: 'mounted', tier: 'skateboard' });
    expect(h.sim.state.sprinting).toBe(false);
    h.run(seconds(1), { forward: 1 });
    h.runUntil((s) => speed(s) <= R.dismountMaxSpeed, 90, { forward: -1 });
    const boardFeet = h.sim.garage.body('skateboard').feet;
    expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'skateboard' });
    const s = h.sim.state;
    expect(s.riding).toBeNull();
    expect(s.lastRide).toBe('skateboard');
    expect(s.position.x).toBeCloseTo(boardFeet.x, 1);
    expect(s.position.z).toBeCloseTo(boardFeet.z, 1);
    expect(h.sim.garage.spot('skateboard')).toEqual({ kind: 'carried' });
    expect(h.sim.garage.body('skateboard').collider.isEnabled()).toBe(false);
    expect(h.sim.garage.snapshot().filter((v) => v.spot.kind === 'parked')).toEqual([]);
    h.run(3);
    expect(h.sim.mountCandidate()).toBe('skateboard');
  });

  test('F while the vehicle is airborne is refused (airborne), for the car and the skateboard', async () => {
    for (const tier of ['car', 'skateboard'] as const) {
      const h = await makeSim({ spawn: vec3(2, 0, -10), garage: [skateboard, parked('car', vec3(0, 0, -10))] });
      if (tier === 'skateboard') h.sim.teleport(vec3(20, 0, -10));
      h.runUntil((s) => s.grounded, 30);
      mount(h, tier);
      h.sim.teleport(vec3(h.sim.state.position.x, 4, h.sim.state.position.z));
      expect(h.sim.state.grounded).toBe(false);
      const ev = h.tick({}, ['mount']);
      expect(ev.filter((e) => e.kind === 'dismounted' || e.kind === 'mountRefused'), tier).toEqual([{ kind: 'mountRefused', reason: 'airborne' }]);
      expect(h.sim.state.riding, tier).toBe(tier);
      h.runUntil((s) => s.grounded, 60);
      h.run(10);
      expect(h.tick({}, ['mount']), tier).toContainEqual({ kind: 'dismounted', tier });
      if (tier === 'car') expect((h.sim.garage.spot('car') as { position: Vec3 }).position.y).toBeLessThan(0.2);
    }
  });

  test('skateboard under a low overhang: no room to stand, noRoom and still riding; clear of it, F gets off', async () => {
    const h = await makeSim();
    mount(h, 'skateboard');
    h.run(3);
    const feet = h.sim.state.position;
    const { rapier, world } = h.sim.physics;
    // A slab at 1.6–1.7 m over the board: a standing courier would be inside it.
    const slab = world.createCollider(rapier.ColliderDesc.cuboid(1, 0.05, 1).setTranslation(feet.x, feet.y + 1.65, feet.z));
    world.step();
    expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'mountRefused', reason: 'noRoom' });
    expect(h.sim.state.riding).toBe('skateboard');
    expect(h.sim.garage.body('skateboard').collider.isEnabled()).toBe(true);
    world.removeCollider(slab, true);
    world.step();
    expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'skateboard' });
    expect(h.sim.body.fitsAt(h.sim.state.position, false)).toBe(true);
  });
});

describe('respawnAtHospital (spec §13 vehicle stuck)', () => {
  test('riding the car: the courier respawns on foot at the hospital, the car stays parked where it stood', async () => {
    const h = await makeSim({ spawn: vec3(2, 0, 60), garage: [skateboard, parked('car', vec3(0, 0, 60))] });
    mount(h, 'car');
    h.run(seconds(1), { forward: 1 });
    h.run(seconds(3));
    const car = { ...h.sim.garage.state('car').position };
    const heading = h.sim.garage.state('car').heading;
    const hospital = h.map.hospitals[0]!;
    expect(h.sim.respawnAtHospital()).toEqual([{ kind: 'respawned', hospitalId: hospital.id }]);
    expect(h.sim.state.riding).toBeNull();
    expect(h.sim.body.collider.isEnabled()).toBe(true);
    expect(h.sim.state.position.x).toBeCloseTo(hospital.spawn.x, 5);
    expect(h.sim.state.position.z).toBeCloseTo(hospital.spawn.z, 5);
    expect(h.sim.garage.spot('car')).toEqual({ kind: 'parked', position: car, heading });
    expect(car.y).toBeCloseTo(0, 3);
    // The courier walks on from there.
    h.run(seconds(0.5));
    expect(h.sim.state.grounded).toBe(true);
  });

  test('riding the skateboard: it is carried again', async () => {
    const h = await makeSim({ spawn: vec3(0, 0, 60) });
    mount(h, 'skateboard');
    h.sim.respawnAtHospital();
    expect(h.sim.state.riding).toBeNull();
    expect(h.sim.garage.spot('skateboard')).toEqual({ kind: 'carried' });
    h.run(seconds(0.5)); // lands at the spawn
    expect(h.sim.mountCandidate()).toBe('skateboard');
  });
});

describe('rideNow (dev and debug)', () => {
  test('parks the tier ahead of the courier and rides it; the previous ride is left where it is', async () => {
    const h = await makeSim({ spawn: vec3(0, 0, 0), garage: [skateboard, parked('car', vec3(0, 0, -30), 0)] });
    h.sim.state.heading = 0;
    expect(h.sim.rideNow('car', 1.5)).toContainEqual({ kind: 'mounted', tier: 'car' });
    expect(h.sim.state.riding).toBe('car');
    expect(h.sim.state.position.z).toBeCloseTo(-1.5, 3);
    expect(h.sim.state.lastRide).toBe('car');
    // Switch to the skateboard: the car stays parked where it was ridden, the board comes out at the feet.
    expect(h.sim.rideNow('skateboard', 1.5)).toContainEqual({ kind: 'mounted', tier: 'skateboard' });
    expect(h.sim.state.riding).toBe('skateboard');
    expect(h.sim.garage.spot('car').kind).toBe('parked');
    expect(h.sim.body.collider.isEnabled()).toBe(false);
  });

  test('leaveRide is a no-op on foot', async () => {
    const h = await makeSim();
    h.sim.leaveRide();
    expect(h.sim.state.riding).toBeNull();
    expect(h.sim.body.collider.isEnabled()).toBe(true);
  });
});

describe('leaveRide places the courier (final review 1)', () => {
  const near = (a: Vec3, b: Vec3, eps = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= eps;

  test('after a ride, leaveRide puts the courier beside the car, and the next tick keeps them there', async () => {
    const h = await makeSim({ spawn: vec3(2, 0, 60), garage: [skateboard, parked('car', vec3(0, 0, 60))] });
    mount(h, 'car');
    h.run(seconds(2), { forward: 1 });
    h.run(seconds(4));
    const car = { ...h.sim.garage.state('car').position };
    expect(car.z).toBeLessThan(40);
    h.sim.leaveRide();
    const s = h.sim.state;
    expect(near(h.sim.body.feet, s.position)).toBe(true);
    const side = CAR.radius + CAPSULE + R.dismountGap;
    expect(Math.hypot(s.position.x - car.x, s.position.z - car.z)).toBeCloseTo(side, 2);
    h.tick({});
    expect(Math.hypot(h.sim.state.position.x - car.x, h.sim.state.position.z - car.z)).toBeCloseTo(side, 1);
    expect(h.sim.body.fitsAt(h.sim.state.position, false)).toBe(true);
  });

  test('skateboard: leaveRide leaves the courier where the board was', async () => {
    const h = await makeSim({ spawn: vec3(0, 0, 60) });
    mount(h, 'skateboard');
    h.run(seconds(2), { forward: 1 });
    const board = { ...h.sim.garage.state('skateboard').position };
    h.sim.leaveRide();
    expect(near(h.sim.body.feet, h.sim.state.position)).toBe(true);
    expect(h.sim.state.position.z).toBeCloseTo(board.z, 3);
    h.tick({});
    expect(h.sim.state.position.z).toBeCloseTo(board.z, 1);
  });

  test('airborne car: leaveRide puts the courier beside the car at the last grounded spot', async () => {
    const h = await makeSim({ spawn: vec3(2, 0, 60), garage: [skateboard, parked('car', vec3(0, 0, 60))] });
    mount(h, 'car');
    h.run(seconds(1), { forward: 1 });
    const ground = { ...h.sim.state.lastGrounded };
    h.sim.teleport(vec3(h.sim.state.position.x, 6, h.sim.state.position.z - 5));
    h.sim.leaveRide();
    expect(near(h.sim.body.feet, h.sim.state.position)).toBe(true);
    expect(Math.hypot(h.sim.state.position.x - ground.x, h.sim.state.position.z - ground.z)).toBeLessThan(3);
    expect(h.sim.state.position.y).toBeLessThan(1);
  });

  test('invariant: body.feet equals state.position after leaveRide, respawnAtHospital, tow and dismount', async () => {
    const hosp = { id: 'h-north', name: 'North', center: vec3(0, 0, 40), safeRadius: 18, spawn: vec3(0, 0, 48), spawnYaw: 0, bay: vec3(10, 0, 56), bayYaw: 0 };
    const make = () => makeSim({ spawn: vec3(2, 0, -80), hospitals: [hosp], garage: [skateboard, parked('car', vec3(0, 0, -80))] });
    const check = (h: Harness, what: string) => expect(near(h.sim.body.feet, h.sim.state.position), what).toBe(true);

    let h = await make();
    mount(h, 'car');
    h.run(seconds(1), { forward: 1 });
    h.sim.leaveRide();
    check(h, 'leaveRide');

    h = await make();
    mount(h, 'car');
    h.run(seconds(1), { forward: 1 });
    h.sim.respawnAtHospital();
    check(h, 'respawnAtHospital');

    h = await make();
    mount(h, 'car');
    let towed = false;
    for (let i = 0; i < 300 && !towed; i++) towed = h.tick({ forward: 1 }).some((e) => e.kind === 'towed');
    expect(towed).toBe(true);
    check(h, 'tow');

    h = await make();
    mount(h, 'car');
    h.run(seconds(1), { forward: 1 });
    h.runUntil((s) => speed(s) <= R.dismountMaxSpeed, 120, { jump: true });
    h.run(seconds(3));
    expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'car' });
    check(h, 'dismount');
  });
});
