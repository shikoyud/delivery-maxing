import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { horizontalLength, vec3 } from '../../src/math/vec3';
import { facing } from '../../src/movement/ground';
import type { PlayerState } from '../../src/movement/types';
import { box, makeSim, type Harness, type Hold } from '../helpers/simHarness';

const seconds = (t: number) => Math.round(t * cfg.tickRate);
const speed = (s: PlayerState) => horizontalLength(s.velocity);
/** Direction of horizontal travel in yaw convention (yaw 0 faces -Z, positive yaw turns left). */
const travelYaw = (s: PlayerState) => Math.atan2(-s.velocity.x, -s.velocity.z);
/** Yaw facing +X (camera yaw 0, strafe right). */
const PLUS_X = -Math.PI / 2;
const RIGHT: Hold = { strafe: 1 };
const RIGHT_SPRINT: Hold = { strafe: 1, sprint: true };

function boardOn(h: Harness): void {
  expect(h.tick({}, ['board'])).toContainEqual({ kind: 'boardToggled', onBoard: true });
}

describe('courier heading', () => {
  it('heading follows the camera-relative wish direction and holds when input stops', async () => {
    const h = await makeSim();
    expect(h.sim.state.heading).toBe(0); // the spawn yaw
    h.tick(RIGHT);
    expect(h.sim.state.yaw).toBe(0); // the camera did not turn
    expect(h.sim.state.heading).toBeCloseTo(PLUS_X, 9);
    h.run(5, {});
    expect(h.sim.state.heading).toBeCloseTo(PLUS_X, 9);
    // The camera turning on its own does not turn the courier.
    h.run(5, { yaw: 1 });
    expect(h.sim.state.heading).toBeCloseTo(PLUS_X, 9);
    // W with the camera at yaw 1 faces yaw 1.
    h.tick({ forward: 1, yaw: 1 });
    expect(h.sim.state.heading).toBeCloseTo(1, 9);
    // Teleport keeps the heading.
    h.sim.teleport(vec3(0, 1, 0));
    expect(h.sim.state.heading).toBeCloseTo(1, 9);
  });

  it('strafing right into a 1.5 m ledge mantles it (Review Focus 2)', async () => {
    const FACE_X = 3;
    const DEPTH = 10;
    const ledge = box('ledge', vec3(FACE_X + DEPTH / 2, 0.75, 0), vec3(DEPTH, 1.5, 8));
    const h = await makeSim({ solids: [ledge] });
    h.runUntil((s) => s.mode === 'mantle', 60, RIGHT_SPRINT);
    h.runUntil((s) => s.mode !== 'mantle', seconds(cfg.mantle.duration + 0.2), RIGHT_SPRINT);
    const s = h.sim.state;
    expect(s.mode).toBe('ground');
    expect(s.position.y).toBeGreaterThanOrEqual(1.45);
    expect(s.position.y).toBeLessThanOrEqual(1.55);
    expect(s.position.x).toBeGreaterThan(FACE_X);
  });

  it('strafing alongside a wall starts a wall-run', async () => {
    // A 40 m wall along X whose face (z = -1) points toward +Z: on the courier's left while it runs toward +X.
    const FACE_Z = -1;
    const wall = box('wall', vec3(18, 6, FACE_Z - 0.5), vec3(40, 12, 1));
    const h = await makeSim({ solids: [wall], spawn: vec3(0, 0, FACE_Z + cfg.capsule.radius + 0.5) });
    h.run(10, RIGHT_SPRINT);
    expect(h.sim.state.grounded).toBe(true);
    expect(h.sim.state.velocity.x).toBeCloseTo(cfg.run.sprintSpeed, 3);
    h.tick(RIGHT_SPRINT, ['jump']);
    const ticks = h.runUntil((s) => s.mode === 'wallrun', 10, RIGHT_SPRINT);
    expect(ticks).toBeLessThanOrEqual(10);
    expect(h.sim.state.wallRun.normal!.z).toBeCloseTo(1, 3);
    // Holding the strafe keeps the run going.
    h.run(10, RIGHT_SPRINT);
    expect(h.sim.state.mode).toBe('wallrun');
  });

  it('board steers toward the wish direction; S brakes without turning', async () => {
    const h = await makeSim();
    boardOn(h);
    h.run(seconds(2), { forward: 1 });
    expect(travelYaw(h.sim.state)).toBeCloseTo(0, 6);
    expect(h.sim.state.heading).toBeCloseTo(h.sim.state.boardHeading, 12);

    // S (camera yaw 0, wish +Z, dot −1): brakes at brakeDecel and does not turn.
    let before = speed(h.sim.state);
    h.tick({ forward: -1 });
    expect(speed(h.sim.state)).toBeCloseTo(before - cfg.board.brakeDecel / cfg.tickRate, 6);
    expect(h.sim.state.boardHeading).toBeCloseTo(0, 12);
    expect(travelYaw(h.sim.state)).toBeCloseTo(0, 6);

    // S+D (dot −0.71 < −0.5): still a brake, still no turn.
    before = speed(h.sim.state);
    h.tick({ forward: -1, strafe: 1 });
    expect(speed(h.sim.state)).toBeCloseTo(before - cfg.board.brakeDecel / cfg.tickRate, 6);
    expect(h.sim.state.boardHeading).toBeCloseTo(0, 12);

    // D (wish +X): the heading turns toward it at no more than turnRate·dt per tick, and the courier faces the board.
    const maxStep = cfg.board.turnRate / cfg.tickRate;
    let prev = h.sim.state.boardHeading;
    let ticks = 0;
    while (Math.abs(h.sim.state.boardHeading - PLUS_X) > 1e-9) {
      h.tick(RIGHT);
      ticks++;
      const now = h.sim.state.boardHeading;
      expect(now).toBeLessThan(prev);
      expect(prev - now).toBeLessThanOrEqual(maxStep + 1e-9);
      expect(h.sim.state.heading).toBe(now);
      // The board rolls along its heading: no sideways slip.
      const f = facing(now);
      const v = h.sim.state.velocity;
      expect(Math.abs(v.x * f.z - v.z * f.x)).toBeLessThan(1e-9);
      prev = now;
      expect(ticks).toBeLessThanOrEqual(seconds(2));
    }
    expect(ticks / cfg.tickRate).toBeGreaterThanOrEqual(Math.PI / 2 / cfg.board.turnRate - 1e-9);
    expect(h.sim.state.velocity.x).toBeGreaterThan(0);
    expect(h.sim.state.yaw).toBe(0);
  });
});
