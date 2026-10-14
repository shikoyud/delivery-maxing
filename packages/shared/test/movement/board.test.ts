import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { horizontalLength, vec3 } from '../../src/math/vec3';
import { facing } from '../../src/movement/ground';
import { NO_MODS, type PlayerState } from '../../src/movement/types';
import type { Solid } from '../../src/world/mapTypes';
import { box, makeSim, type Harness, type Hold } from '../helpers/simHarness';

const speed = (s: PlayerState) => horizontalLength(s.velocity);
const FWD: Hold = { forward: 1 };
const SPRINT: Hold = { forward: 1, sprint: true };
const seconds = (t: number) => Math.round(t * cfg.tickRate);
/** Direction of horizontal travel in yaw convention (yaw 0 faces -Z, positive yaw turns left). */
const travelYaw = (s: PlayerState) => Math.atan2(-s.velocity.x, -s.velocity.z);

/** Pulls the board out (the sim must be grounded) and checks it worked. */
function boardOn(h: Harness): void {
  const events = h.tick({}, ['board']);
  expect(events).toContainEqual({ kind: 'boardToggled', onBoard: true });
  expect(h.sim.state.onBoard).toBe(true);
}

describe('skateboard', () => {
  it('Q on the ground toggles the board; Q in the air does nothing', async () => {
    const h = await makeSim();
    expect(h.sim.state.grounded).toBe(true);
    boardOn(h);
    expect(h.tick({}, ['board'])).toContainEqual({ kind: 'boardToggled', onBoard: false });
    expect(h.sim.state.onBoard).toBe(false);

    // In the air: no toggle, no event (either way).
    h.tick({}, ['jump']);
    expect(h.sim.state.grounded).toBe(false);
    const air = h.tick({}, ['board']);
    expect(air.some((e) => e.kind === 'boardToggled')).toBe(false);
    expect(h.sim.state.onBoard).toBe(false);

    // Crouched on the ground: no toggle either.
    const c = await makeSim();
    c.tick({ crouch: true });
    expect(c.sim.state.crouched).toBe(true);
    expect(c.tick({ crouch: true }, ['board']).some((e) => e.kind === 'boardToggled')).toBe(false);
    expect(c.sim.state.onBoard).toBe(false);

    // On the board in the air, Q does not put it away.
    const b = await makeSim();
    boardOn(b);
    b.tick({}, ['jump']);
    expect(b.sim.state.mode).toBe('air');
    expect(b.tick({}, ['board']).some((e) => e.kind === 'boardToggled')).toBe(false);
    expect(b.sim.state.onBoard).toBe(true);
  });

  it('reaches 12 m/s on flat ground (≥ 11.9 after 4 s) and no more', async () => {
    const h = await makeSim();
    boardOn(h);
    // Acceleration is board.accel, not the run acceleration: after 0.5 s the board is at accel · 0.5.
    h.run(seconds(0.5), FWD);
    expect(speed(h.sim.state)).toBeCloseTo(cfg.board.accel * (seconds(0.5) / cfg.tickRate), 3);
    for (let i = 0; i < seconds(3.5); i++) {
      h.tick(FWD);
      expect(speed(h.sim.state)).toBeLessThanOrEqual(cfg.board.topSpeed + 1e-6);
    }
    expect(speed(h.sim.state)).toBeGreaterThanOrEqual(11.9);
    expect(cfg.board.topSpeed).toBe(12);
    // Sprint does nothing on the board.
    h.run(seconds(1), SPRINT);
    expect(speed(h.sim.state)).toBeCloseTo(cfg.board.topSpeed, 6);
    // Back brakes at brakeDecel; no input coasts down at friction.
    h.tick({ forward: -1 });
    expect(speed(h.sim.state)).toBeCloseTo(cfg.board.topSpeed - cfg.board.brakeDecel / cfg.tickRate, 6);
    const before = speed(h.sim.state);
    h.tick({});
    expect(speed(h.sim.state)).toBeCloseTo(before - cfg.board.friction / cfg.tickRate, 6);
    // Braking slows the board to brakeMinSpeed without turning it or rolling it backwards; below that, S turns the
    // board around instead (R3, covered in heading.test.ts).
    h.runUntil((s) => speed(s) <= cfg.board.brakeMinSpeed, seconds(2), { forward: -1 });
    expect(h.sim.state.boardHeading).toBe(0);
    expect(h.sim.state.velocity.z).toBeLessThanOrEqual(0);
  });

  it('turning 90° takes at least (π/2) / turnRate seconds', async () => {
    const h = await makeSim();
    boardOn(h);
    h.run(seconds(2), FWD);
    const v0 = speed(h.sim.state);
    expect(v0).toBeGreaterThan(10);
    expect(travelYaw(h.sim.state)).toBeCloseTo(0, 6);

    // W+D steers toward the wish direction (45° right) but never slides the board sideways: it rolls along its heading.
    h.run(5, { forward: 1, strafe: 1 });
    const f = facing(h.sim.state.boardHeading);
    const v = h.sim.state.velocity;
    expect(h.sim.state.boardHeading).toBeLessThan(0);
    expect(Math.abs(v.x * f.z - v.z * f.x)).toBeLessThan(1e-9);

    // W with the camera 90° left (yaw π/2, wish faces -X): the heading follows at no more than turnRate per second.
    const target = Math.PI / 2;
    const maxStep = cfg.board.turnRate / cfg.tickRate;
    let prev = travelYaw(h.sim.state);
    let ticks = 0;
    while (Math.abs(travelYaw(h.sim.state) - target) > 1e-6) {
      h.tick({ forward: 1, yaw: target });
      ticks++;
      const now = travelYaw(h.sim.state);
      expect(now - prev).toBeLessThanOrEqual(maxStep + 1e-9);
      prev = now;
      expect(ticks).toBeLessThanOrEqual(seconds(2));
    }
    expect(ticks / cfg.tickRate).toBeGreaterThanOrEqual(target / cfg.board.turnRate - 1e-9);
    // Carving keeps the speed (topped up toward topSpeed by forward input).
    expect(speed(h.sim.state)).toBeGreaterThanOrEqual(v0);
    expect(h.sim.state.velocity.x).toBeLessThan(0);
  });

  it('cannot mantle on the board', async () => {
    const FACE = -3;
    const ledge = box('ledge', vec3(0, 0.5, FACE - 5), vec3(8, 1.0, 10));
    const h = await makeSim({ solids: [ledge] });
    boardOn(h);
    for (let i = 0; i < seconds(2); i++) {
      h.tick(FWD);
      expect(h.sim.state.mode).not.toBe('mantle');
    }
    expect(h.sim.state.mantle).toBeNull();
    expect(h.sim.state.position.y).toBeLessThan(0.1);
    expect(h.sim.state.position.z).toBeGreaterThan(FACE);
    // The wall stopped the board.
    expect(speed(h.sim.state)).toBeLessThan(0.5);
  });

  it('crouch on the board does not slide', async () => {
    const h = await makeSim();
    boardOn(h);
    h.run(seconds(2), FWD);
    const before = speed(h.sim.state);
    expect(before).toBeGreaterThan(cfg.slide.minEntrySpeed);
    h.tick({ forward: 1, sprint: true, crouch: true }, ['crouch']);
    expect(h.sim.state.mode).toBe('ground');
    expect(h.sim.state.crouched).toBe(false);
    // No crouch-walk cap either: holding crouch keeps accelerating on the board.
    h.run(seconds(1), { forward: 1, crouch: true });
    expect(h.sim.state.mode).toBe('ground');
    expect(h.sim.state.crouched).toBe(false);
    expect(speed(h.sim.state)).toBeGreaterThan(before);
  });

  it('board top speed is topSpeed × speedMul, never above the global speedCap', async () => {
    const h = await makeSim();
    boardOn(h);
    for (let i = 0; i < seconds(4); i++) {
      h.tick(FWD);
      expect(speed(h.sim.state)).toBeLessThanOrEqual(cfg.speedCap + 1e-6);
    }
    expect(speed(h.sim.state)).toBeCloseTo(cfg.board.topSpeed, 6);

    // A slower courier (speedMul 0.8) tops out at topSpeed × 0.8, well under the cap.
    const slow = await makeSim();
    boardOn(slow);
    slow.run(seconds(6), FWD, { ...NO_MODS, speedMul: 0.8 });
    expect(speed(slow.sim.state)).toBeCloseTo(cfg.board.topSpeed * 0.8, 6);

    // speedMul above 1 asks for more than speedCap and is clamped to it.
    const fast = await makeSim();
    boardOn(fast);
    fast.run(seconds(4), FWD, { ...NO_MODS, speedMul: 1.2 });
    expect(cfg.board.topSpeed * 1.2).toBeGreaterThan(cfg.speedCap);
    expect(speed(fast.sim.state)).toBeCloseTo(cfg.speedCap, 6);
  });

  it('on a slope the board rolls downhill on its own (g·sinθ)', async () => {
    const deg = 10;
    const a = (deg * Math.PI) / 180;
    const ramp: Solid = box('ramp', vec3(0, -0.5 * Math.cos(a), 0.5 * Math.sin(a)), vec3(8, 1, 60), { rotationDeg: vec3(-deg, 0, 0) });
    const h = await makeSim({ floor: false, solids: [ramp], spawn: vec3(0, Math.tan(a) * 20 + 0.05, 20) });
    expect(h.sim.state.grounded).toBe(true);
    boardOn(h);
    h.run(seconds(1), {});
    const expected = (cfg.gravity * Math.sin(a) - cfg.board.friction) * 1;
    expect(speed(h.sim.state)).toBeGreaterThan(expected * 0.9);
    expect(speed(h.sim.state)).toBeLessThan(expected * 1.1);
    expect(h.sim.state.velocity.z).toBeLessThan(0);
  });
});
