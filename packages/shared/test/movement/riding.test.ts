import { describe, expect, test } from 'vitest';
import { movementConfig as cfg, ridingConfig, vehiclesConfig } from '../../src/config';
import { horizontalLength, vec3, type Vec3 } from '../../src/math/vec3';
import type { RideTier } from '../../src/config/types';
import type { PlayerState } from '../../src/movement/types';
import type { Solid } from '../../src/world/mapTypes';
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

describe('the skateboard ollie (Decision 10)', () => {
  const JUMP = ridingConfig.rides.skateboard.jumpHeight as number;
  const BOARD_R = ridingConfig.rides.skateboard.collider.radius;
  const jumped = (ev: { kind: string }[]) => ev.some((e) => e.kind === 'jumped');

  /** Rides the skateboard along -Z from (0, y, 300) and coasts it down to just at or under `target` m/s. */
  async function rolling(target: number, solids: Solid[] = [], y = 0): Promise<Harness> {
    const h = await makeSim({ size: 800, spawn: vec3(0, y, 300), solids, garage: [skateboard] });
    mount(h, 'skateboard');
    h.runUntil((s) => speed(s) >= target, seconds(10), { forward: 1 });
    h.runUntil((s) => speed(s) <= target, seconds(2));
    expect(h.sim.state.grounded).toBe(true);
    return h;
  }

  test('Space on the skateboard jumps 0.8 m and keeps the forward speed', async () => {
    const h = await rolling(10);
    const startY = h.sim.state.position.y;
    const ev = h.tick({}, ['jump']);
    expect(jumped(ev)).toBe(true);
    expect(h.sim.state.grounded).toBe(false);
    let apex = h.sim.state.position.y;
    let landing: number | null = null;
    for (let i = 0; i < seconds(2) && landing === null; i++) {
      const e = h.tick({});
      apex = Math.max(apex, h.sim.state.position.y);
      if (e.some((x) => x.kind === 'landed')) landing = speed(h.sim.state);
    }
    expect(apex - startY).toBeGreaterThanOrEqual(0.75);
    expect(apex - startY).toBeLessThanOrEqual(0.85);
    expect(landing).not.toBeNull();
    expect(Math.abs((landing as number) - 10)).toBeLessThan(0.1);
    expect(h.sim.state.riding).toBe('skateboard');
  });

  test('the skateboard clears a 0.5 m curb with an ollie and is stopped by it without', async () => {
    const face = 250;
    const curb = box('curb', vec3(0, 0.25, face - 100), vec3(20, 0.5, 200)); // z from 50 to 250, top at 0.5
    const front = (h: Harness) => h.sim.state.position.z - BOARD_R - face; // distance from the board's front to the face

    const without = await rolling(10, [curb]);
    for (let i = 0; i < seconds(4); i++) {
      without.tick({ forward: 1 });
      expect(without.sim.state.position.z).toBeGreaterThan(face);
    }
    expect(without.sim.state.position.y).toBeCloseTo(0, 2);
    expect(speed(without.sim.state)).toBeLessThan(1);

    const ollie = await rolling(10, [curb]);
    ollie.runUntil((s) => s.position.z - BOARD_R - face <= 2, seconds(10));
    expect(front(ollie)).toBeGreaterThan(1.5);
    expect(jumped(ollie.tick({}, ['jump']))).toBe(true);
    ollie.run(seconds(2), { forward: 1 });
    const s = ollie.sim.state;
    expect(s.grounded).toBe(true);
    expect(s.position.z).toBeLessThan(face - 10);
    expect(s.position.y).toBeCloseTo(0.5, 2);
    expect(speed(s)).toBeGreaterThan(9);
  });

  test('a press 80 ms before landing jumps on landing (buffer); 80 ms after leaving a ledge still jumps (coyote)', async () => {
    const early = seconds(0.08); // 2 ticks
    const tooEarly = seconds(0.2);

    // Buffer. A reference ollie counts the ticks to its landing; the same ollie then presses Space `n` ticks before.
    const ref = await rolling(10);
    ref.tick({}, ['jump']);
    let toLanding = 0;
    for (let landed = false; !landed && toLanding < seconds(2); toLanding++) landed = ref.tick({}).some((e) => e.kind === 'landed');
    expect(ref.sim.state.grounded).toBe(true);
    const pressBeforeLanding = async (n: number) => {
      const h = await rolling(10);
      expect(jumped(h.tick({}, ['jump']))).toBe(true);
      h.run(toLanding - 1 - n);
      expect(jumped(h.tick({}, ['jump']))).toBe(false); // in the air: no double jump
      const ev = h.run(n + 2);
      expect(ev.some((e) => e.kind === 'landed')).toBe(true);
      return jumped(ev);
    };
    expect(await pressBeforeLanding(early)).toBe(true);
    expect(await pressBeforeLanding(tooEarly)).toBe(false);

    // Coyote. Off the end of a 2 m ledge (z from 100 to 310), Space `n` ticks after the board leaves it.
    const ledge = box('ledge', vec3(0, 1, 205), vec3(20, 2, 210));
    const pressAfterLeaving = async (n: number) => {
      const h = await rolling(10, [ledge], 2);
      h.runUntil((s) => !s.grounded, seconds(30), { forward: 1 });
      expect(h.sim.state.position.z).toBeLessThan(100.5);
      h.run(n);
      expect(h.sim.state.grounded).toBe(false);
      const ev = h.tick({}, ['jump']);
      return jumped(ev) && h.sim.state.velocity.y > 0;
    };
    expect(await pressAfterLeaving(early)).toBe(true);
    expect(await pressAfterLeaving(tooEarly)).toBe(false);
    expect(JUMP).toBe(0.8);
  });

  test('Space on the car is the handbrake, never a jump', async () => {
    const h = await makeSim({ size: 800, spawn: vec3(2, 0, 300), garage: [skateboard, parked('car', vec3(0, 0, 300))] });
    mount(h, 'car');
    h.runUntil((s) => speed(s) >= 15, seconds(10), { forward: 1 });
    const v0 = speed(h.sim.state);
    const ev = h.tick({ forward: 1 }, ['jump']);
    expect(jumped(ev)).toBe(false);
    expect(speed(h.sim.state)).toBeCloseTo(v0 - ridingConfig.rides.car.handbrakeDecel / cfg.tickRate, 6);
    for (let i = 0; i < seconds(1); i++) {
      expect(jumped(h.tick({ forward: 1, jump: true }, i % 5 === 0 ? ['jump'] : []))).toBe(false);
      expect(h.sim.state.grounded).toBe(true);
      expect(h.sim.state.velocity.y).toBe(0);
    }
    expect(speed(h.sim.state)).toBeLessThan(v0 - 5);
  });
});

describe('getting off at any speed (Decision 9, Review Focus 4)', () => {
  const RIDES = ridingConfig.rides;
  const DT = 1 / cfg.tickRate;
  /** Speed after the F tick from `v0` on foot with W held along the motion: the overspeed decay of one tick. */
  const afterFootTick = (v0: number) => Math.max(cfg.run.runSpeed, v0 - cfg.run.overspeedDecay * DT);
  const sideGap = (tier: RideTier) => RIDES[tier].collider.radius + CAPSULE + R.dismountGap;

  /** An axis-aligned solid added at runtime (beside a moving ride), seen by queries at once. */
  function addBox(h: Harness, center: Vec3, half: Vec3): void {
    const { rapier, world } = h.sim.physics;
    world.createCollider(rapier.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z));
    world.step();
  }

  /** Rides `tier` straight along -Z on the big open floor until it is at `top` m/s. */
  async function atTopSpeed(tier: RideTier, top: number, solids: Solid[] = []): Promise<Harness> {
    const garage = tier === 'skateboard' ? [skateboard] : [skateboard, parked(tier, vec3(0, 0, 300))];
    const h = await makeSim({ size: 800, spawn: vec3(tier === 'skateboard' ? 0 : 1.5, 0, 300), solids, garage });
    mount(h, tier);
    h.runUntil((s) => speed(s) >= top - 0.05, seconds(15), { forward: 1 });
    expect(Math.abs(h.sim.state.heading)).toBeLessThan(1e-3);
    return h;
  }

  test('F at 28 m/s in the car gets off: the car parks where it is, the courier keeps 12 m/s', async () => {
    const h = await atTopSpeed('car', 28);
    const car = { ...h.sim.garage.state('car').position };
    const v = { ...h.sim.garage.state('car').velocity };
    expect(horizontalLength(v)).toBeGreaterThan(27.9);
    expect(h.tick({ forward: 1 }, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'car' });
    const s = h.sim.state;
    expect(s.riding).toBeNull();
    const spot = h.sim.garage.spot('car') as { kind: string; position: Vec3 };
    expect(spot.kind).toBe('parked');
    expect(spot.position).toEqual(car);
    expect(h.sim.garage.state('car').velocity).toEqual(vec3(0, 0, 0));
    // The dismount sets 12 m/s along the car's motion; the F tick is the courier's first on foot (W held).
    expect(Math.abs(speed(s) - afterFootTick(cfg.speedCap))).toBeLessThan(1e-6);
    const dir = (s.velocity.x * v.x + s.velocity.z * v.z) / (speed(s) * horizontalLength(v));
    expect(dir).toBeGreaterThan(0.9999);
    expect(s.position.x).toBeCloseTo(car.x - sideGap('car'), 1); // heading 0 faces -Z: left is -X
    expect(h.sim.body.fitsAt(s.position, false)).toBe(true);
    h.run(seconds(1));
    expect(h.sim.state.grounded).toBe(true);
    expect(speed(h.sim.state)).toBeLessThanOrEqual(cfg.speedCap);
  });

  test('F at speed with a wall on the left steps off on the right (Review Focus 4)', async () => {
    const wall = box('wall', vec3(-2, 2, 0), vec3(1, 4, 800)); // face at x = -1.5, 0.55 m from the car's side
    const h = await atTopSpeed('car', 28, [wall]);
    const car = { ...h.sim.garage.state('car').position };
    expect(h.tick({ forward: 1 }, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'car' });
    const s = h.sim.state;
    expect(s.position.x).toBeCloseTo(car.x + sideGap('car'), 2);
    expect(h.sim.body.fitsAt(s.position, false)).toBe(true);
    for (let i = 0; i < seconds(1); i++) {
      h.tick({ forward: 1 });
      expect(h.sim.body.fitsAt(h.sim.state.position, false)).toBe(true);
      expect(h.sim.state.position.x).toBeGreaterThan(-1.5 + CAPSULE - 0.02);
    }
  });

  test('F at 22 m/s on the motorbike in a 4 m alley: right or behind, else "noRoom" and still riding', async () => {
    // Left wall face 1.2 m from the bike's axis (the left spot overlaps it), right wall face 2.8 m: a 4 m alley.
    const alley = [box('left', vec3(-1.7, 2, 0), vec3(1, 4, 800)), box('right', vec3(3.3, 2, 0), vec3(1, 4, 800))];
    const side = sideGap('motorbike');
    const back = RIDES.motorbike.collider.halfLength + RIDES.motorbike.collider.radius + CAPSULE + R.dismountGap;

    let h = await atTopSpeed('motorbike', 22, alley);
    let bike = { ...h.sim.garage.state('motorbike').position };
    expect(h.tick({ forward: 1 }, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'motorbike' });
    expect(h.sim.state.position.x).toBeCloseTo(bike.x + side, 2);
    expect(h.sim.body.fitsAt(h.sim.state.position, false)).toBe(true);

    // A bin on the right as F is pressed: behind it.
    h = await atTopSpeed('motorbike', 22, alley);
    bike = { ...h.sim.garage.state('motorbike').position };
    addBox(h, vec3(bike.x + 1.9, 1, bike.z), vec3(0.5, 1, 1.2));
    expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'motorbike' });
    expect(h.sim.state.position.x).toBeCloseTo(bike.x, 2);
    expect(h.sim.state.position.z).toBeCloseTo(bike.z + back, 6); // behind is +Z; no velocity carries it back at the bike
    expect(h.sim.body.fitsAt(h.sim.state.position, false)).toBe(true);

    // And a crate behind: no room, still riding.
    h = await atTopSpeed('motorbike', 22, alley);
    bike = { ...h.sim.garage.state('motorbike').position };
    addBox(h, vec3(bike.x + 1.9, 1, bike.z), vec3(0.5, 1, 1.2));
    addBox(h, vec3(bike.x, 1, bike.z + back + 0.2), vec3(1, 1, 0.4));
    expect(h.tick({ forward: 1 }, ['mount'])).toContainEqual({ kind: 'mountRefused', reason: 'noRoom' });
    expect(h.sim.state.riding).toBe('motorbike');
    expect(h.sim.body.collider.isEnabled()).toBe(false);
  });

  test('getting off behind at speed never throws the courier at the parked ride, even with W held', async () => {
    const alley = [box('left', vec3(-1.7, 2, 0), vec3(1, 4, 800)), box('right', vec3(3.3, 2, 0), vec3(1, 4, 800))];
    const c = RIDES.motorbike.collider;
    const rear = c.halfLength + c.radius; // the rear face, from the bike's centre
    const back = rear + CAPSULE + R.dismountGap;
    const h = await atTopSpeed('motorbike', 22, alley);
    const bike = { ...h.sim.garage.state('motorbike').position };
    addBox(h, vec3(bike.x + 1.9, 1, bike.z), vec3(0.5, 1, 1.2)); // a bin on the right: the spot is behind
    expect(h.tick({ forward: 1 }, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'motorbike' });
    const s = h.sim.state;
    expect(s.position.x).toBeCloseTo(bike.x, 2);
    // None of the bike's 22 m/s (all of it toward the bike from behind) is kept: W from rest is all that moves the
    // courier, at most one tick of groundAccel, and it stays clear of the rear face.
    expect(s.velocity.z).toBeGreaterThanOrEqual(-cfg.run.groundAccel * DT - 1e-6);
    expect(s.position.z).toBeGreaterThanOrEqual(bike.z + back - cfg.run.groundAccel * DT * DT - 1e-4); // Rapier positions are f32
    expect(s.position.z - CAPSULE).toBeGreaterThan(bike.z + rear);
    expect(h.sim.lastMove?.wallNormals ?? []).toEqual([]);
  });

  test('a drifting ride: the sideways velocity back into the vehicle is removed, the rest is kept', async () => {
    for (const drift of [5, -5]) {
      const h = await atTopSpeed('car', 28);
      const car = h.sim.garage.state('car');
      car.velocity = vec3(drift, 0, -20); // sliding sideways while doing 20 m/s
      expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'car' });
      const s = h.sim.state;
      expect(s.position.x).toBeLessThan(car.position.x); // the left spot (-X)
      if (drift > 0) {
        // +X points from the left spot back into the car: gone; the 20 m/s along the car is clamped to 12.
        expect(Math.abs(s.velocity.x)).toBeLessThan(1e-9);
        expect(s.velocity.z).toBeCloseTo(-(cfg.speedCap - cfg.run.groundDecel * DT), 6);
      } else {
        expect(s.velocity.x).toBeLessThan(-1); // -X is away from the car: kept
      }
      expect(speed(s)).toBeLessThanOrEqual(cfg.speedCap);
    }
  });

  test('F mid-ollie on the skateboard: board carried, courier airborne with the board velocity, lands normally', async () => {
    // The board at 12 m/s ollies a 0.15 m curb about 2 m ahead.
    const curb = box('curb', vec3(0, 0.075, 0), vec3(6, 0.15, 400)); // z from -200 to 200, top at 0.15
    const h = await atTopSpeed('skateboard', 12, [curb]);
    h.runUntil((s) => s.position.z < 202, seconds(30), { forward: 1 }); // just short of the curb
    const p = h.sim.state.position;
    expect(p.y).toBeCloseTo(0, 2);
    expect(h.tick({}, ['jump'])).toContainEqual({ kind: 'jumped' });
    expect(h.sim.state.grounded).toBe(false);
    const v = { ...h.sim.garage.state('skateboard').velocity };
    expect(v.y).toBeGreaterThan(0);
    expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'skateboard' });
    const s = h.sim.state;
    expect(s.riding).toBeNull();
    expect(h.sim.garage.spot('skateboard')).toEqual({ kind: 'carried' });
    expect(h.sim.garage.body('skateboard').collider.isEnabled()).toBe(false);
    expect(s.grounded).toBe(false);
    expect(s.mode).toBe('air');
    // Airborne with no input, one tick keeps the horizontal velocity and adds gravity.
    expect(Math.abs(s.velocity.x - v.x)).toBeLessThan(1e-6);
    expect(Math.abs(s.velocity.z - v.z)).toBeLessThan(1e-6);
    expect(s.velocity.y).toBeCloseTo(v.y - cfg.gravity * DT, 6);
    expect(h.sim.body.fitsAt(s.position, false)).toBe(true);
    let landed = false;
    for (let i = 0; i < seconds(2) && !landed; i++) {
      landed = h.tick({}).some((e) => e.kind === 'landed');
      expect(h.sim.body.fitsAt(h.sim.state.position, false)).toBe(true);
    }
    expect(landed).toBe(true);
    expect(h.sim.state.grounded).toBe(true);
    h.run(seconds(1));
    expect(h.sim.body.fitsAt(h.sim.state.position, false)).toBe(true);
    expect(h.sim.state.position.y).toBeCloseTo(0.15, 2); // standing on the curb
    expect(h.sim.mountCandidate()).toBe('skateboard');
  });

  test('F in the air on the bicycle is refused "airborne"', async () => {
    const h = await atTopSpeed('bicycle', 16);
    const p = h.sim.state.position;
    h.sim.teleport(vec3(p.x, 4, p.z), h.sim.state.velocity);
    expect(h.sim.state.grounded).toBe(false);
    const ev = h.tick({}, ['mount']);
    expect(ev.filter((e) => e.kind === 'dismounted' || e.kind === 'mountRefused')).toEqual([{ kind: 'mountRefused', reason: 'airborne' }]);
    expect(h.sim.state.riding).toBe('bicycle');
    expect(h.sim.body.collider.isEnabled()).toBe(false);
  });

  // shiko's rule, the whole class: whatever the ride and whatever stands beside it at top speed, F either gets off
  // onto a spot a standing courier fits, on the vehicle's own side of every wall and rail, at most 12 m/s; or it is
  // refused "noRoom" and the courier still rides.
  test.each(['skateboard', 'bicycle', 'motorbike', 'car'] as const)('%s at top speed: a dismount never puts the courier in or through geometry', async (tier) => {
    const c = RIDES[tier].collider;
    const top = vehiclesConfig[tier].topSpeed;
    // Faces 0.1 m from the ride's side: walls (thick, 4 m tall) or rails (8 cm thick, 1.1 m tall).
    const face = c.radius + 0.1;
    type Layout = { name: string; left?: 'wall' | 'rail'; right?: 'wall' | 'rail'; back?: boolean };
    const layouts: Layout[] = [
      { name: 'open' },
      { name: 'wall left', left: 'wall' },
      { name: 'wall right', right: 'wall' },
      { name: 'rail left', left: 'rail' },
      { name: 'rail right', right: 'rail' },
      { name: 'alley', left: 'wall', right: 'wall' },
      { name: 'rails', left: 'rail', right: 'rail' },
      { name: 'boxed in', left: 'wall', right: 'rail', back: true },
    ];
    const outcomes: Record<string, string> = {};
    for (const L of layouts) {
      const h = await atTopSpeed(tier, top);
      const at = { ...h.sim.garage.state(tier).position };
      const solid = (kind: 'wall' | 'rail', sign: -1 | 1) => {
        const half = kind === 'wall' ? vec3(0.5, 2, 40) : vec3(0.04, 0.55, 40);
        addBox(h, vec3(at.x + sign * (face + half.x), at.y + half.y, at.z), half);
      };
      if (L.left) solid(L.left, -1);
      if (L.right) solid(L.right, 1);
      const back = (c.shape === 'lengthwise' ? c.halfLength : 0) + c.radius;
      if (L.back) addBox(h, vec3(at.x, at.y + 1, at.z + back + 0.1 + 0.5), vec3(face + 0.5, 1, 0.5));
      const minX = L.left ? at.x - face + CAPSULE - 0.02 : -Infinity;
      const maxX = L.right ? at.x + face - CAPSULE + 0.02 : Infinity;
      const ev = h.tick({}, ['mount']);
      const what = `${tier} ${L.name}`;
      if (ev.some((e) => e.kind === 'dismounted')) {
        outcomes[L.name] = 'off';
        for (let i = 0; i <= seconds(1); i++) {
          const s = h.sim.state;
          expect(h.sim.body.fitsAt(s.position, false), what).toBe(true);
          expect(s.position.x, what).toBeGreaterThan(minX);
          expect(s.position.x, what).toBeLessThan(maxX);
          expect(speed(s), what).toBeLessThanOrEqual(cfg.speedCap + 1e-9);
          h.tick({});
        }
      } else {
        outcomes[L.name] = 'refused';
        expect(ev, what).toContainEqual({ kind: 'mountRefused', reason: 'noRoom' });
        expect(h.sim.state.riding, what).toBe(tier);
        expect(h.sim.body.collider.isEnabled(), what).toBe(false);
      }
    }
    // Not vacuous: the open and one-sided layouts get off; boxed in, every ride but the board is refused.
    for (const name of ['open', 'wall left', 'wall right', 'rail left', 'rail right']) expect(outcomes[name], `${tier} ${name}`).toBe('off');
    if (tier !== 'skateboard') expect(outcomes['boxed in'], tier).toBe('refused');
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
    h.runUntil((s) => speed(s) <= R.stoppedSpeed, 90, { forward: -1 });
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

  test('F while the car is airborne is refused (airborne); it gets off once landed', async () => {
    const h = await makeSim({ spawn: vec3(2, 0, -10), garage: [skateboard, parked('car', vec3(0, 0, -10))] });
    h.runUntil((s) => s.grounded, 30);
    mount(h, 'car');
    h.sim.teleport(vec3(h.sim.state.position.x, 4, h.sim.state.position.z));
    expect(h.sim.state.grounded).toBe(false);
    const ev = h.tick({}, ['mount']);
    expect(ev.filter((e) => e.kind === 'dismounted' || e.kind === 'mountRefused')).toEqual([{ kind: 'mountRefused', reason: 'airborne' }]);
    expect(h.sim.state.riding).toBe('car');
    h.runUntil((s) => s.grounded, 60);
    h.run(10);
    expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'car' });
    expect((h.sim.garage.spot('car') as { position: Vec3 }).position.y).toBeLessThan(0.2);
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
    h.runUntil((s) => speed(s) <= R.stoppedSpeed, 120, { jump: true });
    h.run(seconds(3));
    expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'dismounted', tier: 'car' });
    check(h, 'dismount');
  });
});
