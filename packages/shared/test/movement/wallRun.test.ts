import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { dot, horizontalLength, vec3, type Vec3 } from '../../src/math/vec3';
import type { PlayerState } from '../../src/movement/types';
import { box, makeSim, type Harness, type Hold } from '../helpers/simHarness';

const SPRINT: Hold = { forward: 1, sprint: true };
/** Gap between the capsule surface and the wall face at the start of each test. */
const GAP = 0.5;
const WALL_LEN = 40;
const WALL_HEIGHT = 12;
/** Feet x that leaves GAP between the capsule and a wall face at x = faceX on the left (-X) side. */
const nextToLeftFace = (faceX: number) => faceX + cfg.capsule.radius + GAP;

/** A 40 m wall along Z (yaw 0 runs toward -Z) whose face points toward +X (left wall) or -X (right wall). */
function wall(id: string, faceX: number, side: 'left' | 'right'): ReturnType<typeof box> {
  const cx = side === 'left' ? faceX - 0.5 : faceX + 0.5;
  return box(id, vec3(cx, WALL_HEIGHT / 2, -WALL_LEN / 2 + 2), vec3(1, WALL_HEIGHT, WALL_LEN));
}

const LEFT_FACE = -1;

/** Wall-running state (mode and timer) read each tick. */
const wallRunning = (s: PlayerState) => s.mode === 'wallrun';

/** Starts a sim with the left wall and the player in the air beside it, moving along it at `speed`. */
async function airborneBeside(speed: number, y = 6): Promise<Harness> {
  const h = await makeSim({ solids: [wall('wall', LEFT_FACE, 'left')] });
  h.sim.teleport(vec3(nextToLeftFace(LEFT_FACE), y, 0), vec3(0, 0, -speed));
  return h;
}

const alongWall = (v: Vec3, n: Vec3) => horizontalLength(vec3(v.x - n.x * dot(v, n), 0, v.z - n.z * dot(v, n)));

describe('wall-run', () => {
  it('jumping alongside a wall at sprint starts a wall-run within 10 ticks', async () => {
    const h = await makeSim({ solids: [wall('wall', LEFT_FACE, 'left')], spawn: vec3(nextToLeftFace(LEFT_FACE), 0, 0) });
    h.run(10, SPRINT);
    expect(h.sim.state.grounded).toBe(true);
    expect(horizontalLength(h.sim.state.velocity)).toBeCloseTo(cfg.run.sprintSpeed, 3);
    h.tick(SPRINT, ['jump']);
    const ticks = h.runUntil(wallRunning, 10, SPRINT);
    expect(ticks).toBeLessThanOrEqual(10);
    const s = h.sim.state;
    expect(s.wallRun.normal).not.toBeNull();
    expect(s.wallRun.normal!.x).toBeCloseTo(1, 3);
    expect(s.wallRun.time).toBeLessThan(0.2);
  });

  it('a wall-run lasts at most 1.5 s (≤ 46 ticks in wallrun)', async () => {
    const h = await airborneBeside(cfg.run.sprintSpeed);
    h.runUntil(wallRunning, 5, SPRINT);
    let ticks = 1;
    while (wallRunning(h.sim.state)) {
      h.tick(SPRINT);
      if (wallRunning(h.sim.state)) ticks++;
      expect(ticks).toBeLessThanOrEqual(46);
    }
    // It ended on the timer, not by landing or losing the wall.
    expect(ticks).toBeGreaterThanOrEqual(44);
    expect(h.sim.state.mode).toBe('air');
    expect(h.sim.state.grounded).toBe(false);
  });

  it('falls slower while wall-running than in free fall', async () => {
    const TICKS = 20;
    const h = await airborneBeside(cfg.run.sprintSpeed);
    h.runUntil(wallRunning, 5, SPRINT);
    const y0 = h.sim.state.position.y;
    for (let i = 0; i < TICKS; i++) {
      h.tick(SPRINT);
      expect(h.sim.state.mode).toBe('wallrun');
    }
    const wallDrop = y0 - h.sim.state.position.y;

    const free = await makeSim();
    free.sim.teleport(vec3(0, 6, 0), vec3(0, 0, -cfg.run.sprintSpeed));
    free.run(1, SPRINT);
    const f0 = free.sim.state.position.y;
    free.run(TICKS, SPRINT);
    const freeDrop = f0 - free.sim.state.position.y;

    expect(wallDrop).toBeGreaterThan(0);
    // gravityScale 0.15: the wall-run drop is well under half the free-fall drop over the same time.
    expect(wallDrop).toBeLessThan(0.5 * freeDrop);
  });

  it('keeps along-wall speed (≥ 7.5 m/s after 1 s from 8)', async () => {
    const h = await airborneBeside(8);
    h.runUntil(wallRunning, 5, SPRINT);
    for (let i = 0; i < cfg.tickRate; i++) {
      h.tick(SPRINT);
      expect(h.sim.state.mode).toBe('wallrun');
    }
    const s = h.sim.state;
    expect(alongWall(s.velocity, s.wallRun.normal!)).toBeGreaterThanOrEqual(7.5);
  });

  it('wall-jump pushes off the wall (v·n ≥ wallJumpPush − 0.5) and keeps along-wall speed ≥ 7.5', async () => {
    const h = await airborneBeside(cfg.run.sprintSpeed);
    h.runUntil(wallRunning, 5, SPRINT);
    h.run(10, SPRINT);
    expect(h.sim.state.mode).toBe('wallrun');
    const n = h.sim.state.wallRun.normal!;
    const events = h.tick(SPRINT, ['jump']);
    const s = h.sim.state;
    expect(events).toContainEqual({ kind: 'jumped' });
    expect(s.mode).toBe('air');
    expect(s.velocity.x * n.x + s.velocity.z * n.z).toBeGreaterThanOrEqual(cfg.wallRun.wallJumpPush - 0.5);
    expect(alongWall(s.velocity, n)).toBeGreaterThanOrEqual(7.5);
    expect(s.velocity.y).toBeGreaterThan(0);
    expect(s.wallRun.lastNormal).toEqual(n);
  });

  it('wall-jump chains to the facing wall across a 4 m alley and the timer resets', async () => {
    const left = -2;
    const right = 2;
    const h = await makeSim({
      solids: [wall('left', left, 'left'), wall('right', right, 'right')],
      spawn: vec3(nextToLeftFace(left), 0, 0),
    });
    h.run(10, SPRINT);
    h.tick(SPRINT, ['jump']);
    h.runUntil(wallRunning, 10, SPRINT);
    expect(h.sim.state.wallRun.normal!.x).toBeCloseTo(1, 3);
    h.run(5, SPRINT);
    expect(h.sim.state.mode).toBe('wallrun');
    expect(h.sim.state.wallRun.time).toBeGreaterThan(0.1);
    // Chaining needs only W: air control (R13) keeps the wall-jump push.
    h.tick(SPRINT, ['jump']);
    expect(h.sim.state.mode).toBe('air');
    h.runUntil(wallRunning, 25, SPRINT);
    const s = h.sim.state;
    expect(s.wallRun.normal!.x).toBeCloseTo(-1, 3);
    expect(s.wallRun.time).toBeLessThan(0.2);
    expect(s.position.y).toBeGreaterThan(0.5);
    expect(alongWall(s.velocity, s.wallRun.normal!)).toBeGreaterThanOrEqual(7.5);
  });

  it('cannot wall-run the same wall again before landing', async () => {
    const h = await airborneBeside(cfg.run.sprintSpeed);
    h.runUntil(wallRunning, 5, SPRINT);
    h.run(5, SPRINT);
    // Releasing forward ends the run; holding it again must not restart it on the same wall.
    h.tick({ sprint: true });
    expect(h.sim.state.mode).toBe('air');
    let ticks = 0;
    while (!h.sim.state.grounded) {
      h.tick(SPRINT);
      expect(h.sim.state.mode).not.toBe('wallrun');
      expect(++ticks).toBeLessThan(120);
    }
    // Landing resets the same-wall lock: a fresh jump wall-runs again.
    expect(h.sim.state.wallRun.lastNormal).toBeNull();
    h.tick(SPRINT, ['jump']);
    h.runUntil(wallRunning, 10, SPRINT);
  });

  it('no wall-run below 5 m/s', async () => {
    const SLOW: Hold = { forward: 0.5 }; // run target 2.75 m/s: air control cannot lift the speed to minSpeed
    const h = await airborneBeside(4.5);
    for (let i = 0; i < 30; i++) {
      h.tick(SLOW);
      expect(horizontalLength(h.sim.state.velocity)).toBeLessThan(cfg.wallRun.minSpeed);
      expect(h.sim.state.mode).not.toBe('wallrun');
    }
  });
});
