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
});
