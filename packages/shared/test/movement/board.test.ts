import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { horizontalLength, vec3 } from '../../src/math/vec3';
import { NO_MODS, type PlayerState } from '../../src/movement/types';
import type { Rail, Solid, ZipLine } from '../../src/world/mapTypes';
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
    // Braking stops the board and does not roll it backwards.
    h.run(seconds(2), { forward: -1 });
    expect(speed(h.sim.state)).toBe(0);
  });

  it('turning 90° takes at least (π/2) / turnRate seconds', async () => {
    const h = await makeSim();
    boardOn(h);
    h.run(seconds(2), FWD);
    const v0 = speed(h.sim.state);
    expect(v0).toBeGreaterThan(10);
    expect(travelYaw(h.sim.state)).toBeCloseTo(0, 6);

    // Strafing does not move the board sideways.
    h.run(5, { forward: 1, strafe: 1 });
    expect(Math.abs(h.sim.state.velocity.x)).toBeLessThan(1e-9);

    // Look 90° left (yaw π/2 faces -X): the heading follows at no more than turnRate per second.
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

  it('cannot wall-run on the board', async () => {
    // The Task 7 wall: a 40 m wall along Z whose face (x = -1) points toward +X; the player starts 0.5 m from it.
    const wallSolid = box('wall', vec3(-1.5, 6, -18), vec3(1, 12, 40));
    const spawnX = -1 + cfg.capsule.radius + 0.5;
    const attempt = async (onBoard: boolean) => {
      const h = await makeSim({ solids: [wallSolid], spawn: vec3(spawnX, 0, 0) });
      if (onBoard) boardOn(h);
      h.run(seconds(onBoard ? 1.5 : 0.5), SPRINT);
      expect(speed(h.sim.state)).toBeGreaterThanOrEqual(cfg.run.sprintSpeed - 0.01);
      h.tick(SPRINT, ['jump']);
      let ran = false;
      for (let i = 0; i < 20; i++) {
        h.tick(SPRINT);
        if (h.sim.state.mode === 'wallrun') ran = true;
      }
      return ran;
    };
    expect(await attempt(false)).toBe(true); // control: the same approach on foot wall-runs
    expect(await attempt(true)).toBe(false);

    // Airborne beside the wall on the board (canStartWallRun conditions otherwise met): still no wall-run.
    const h = await makeSim({ solids: [wallSolid], spawn: vec3(spawnX, 0, 0) });
    boardOn(h);
    h.sim.teleport(vec3(spawnX, 6, 0), vec3(0, 0, -cfg.run.sprintSpeed));
    for (let i = 0; i < 20; i++) {
      h.tick(SPRINT);
      expect(h.sim.state.mode).not.toBe('wallrun');
    }
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

  it('board grind speed is at least 10 m/s', async () => {
    const straight: Rail = { id: 'r', points: [vec3(0, 3, 0), vec3(0, 3, -60)] };
    const h = await makeSim({ rails: [straight] });
    boardOn(h);
    h.sim.teleport(vec3(0, 3.3, -2), vec3(0, -1, -5));
    h.tick();
    expect(h.sim.state.mode).toBe('grind');
    expect(h.sim.state.onBoard).toBe(true);
    expect(h.sim.state.grind!.speed).toBeGreaterThanOrEqual(cfg.board.railMinSpeed);
    expect(cfg.board.railMinSpeed).toBe(10);
    // Friction never takes it below the board minimum.
    for (let i = 0; i < seconds(2); i++) {
      h.tick();
      expect(h.sim.state.grind!.speed).toBeGreaterThanOrEqual(cfg.board.railMinSpeed);
    }

    // On foot the minimum stays rail.minSpeedFoot.
    const foot = await makeSim({ rails: [straight] });
    foot.sim.teleport(vec3(0, 3.3, -2), vec3(0, -1, -1));
    foot.tick();
    expect(foot.sim.state.grind!.speed).toBeCloseTo(cfg.rail.minSpeedFoot, 6);
  });

  it('grabbing a zip line while on the board puts the board away (boardToggled false)', async () => {
    const zip: ZipLine = { id: 'z', a: vec3(0, 10, 0), b: vec3(0, 4, -30) };
    const h = await makeSim({ solids: [box('platform', vec3(0, 4, 0), vec3(4, 8, 4))], zipLines: [zip], spawn: vec3(0, 8, 0) });
    boardOn(h);
    const events = h.tick({}, ['interact']);
    expect(h.sim.state.mode).toBe('zipline');
    expect(events).toContainEqual({ kind: 'boardToggled', onBoard: false });
    expect(h.sim.state.onBoard).toBe(false);
    // Attaching on foot emits no board event.
    const foot = await makeSim({ solids: [box('platform', vec3(0, 4, 0), vec3(4, 8, 4))], zipLines: [zip], spawn: vec3(0, 8, 0) });
    expect(foot.tick({}, ['interact']).some((e) => e.kind === 'boardToggled')).toBe(false);
    expect(foot.sim.state.mode).toBe('zipline');
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

  it('boost raises board top speed to 16.8 m/s', async () => {
    const h = await makeSim();
    boardOn(h);
    h.sim.state.boostLeft = 100;
    for (let i = 0; i < seconds(4); i++) {
      h.tick(FWD);
      expect(speed(h.sim.state)).toBeLessThanOrEqual(16.8 + 1e-6);
    }
    expect(cfg.board.topSpeed * cfg.boostOrb.speedMultiplier).toBeCloseTo(16.8, 9);
    expect(speed(h.sim.state)).toBeCloseTo(16.8, 6);

    // speedMul scales the board top speed too; boost and speedMul together are still capped at speedCap.
    const m = await makeSim();
    boardOn(m);
    m.run(seconds(4), FWD, { ...NO_MODS, speedMul: 1.1 });
    expect(speed(m.sim.state)).toBeCloseTo(cfg.board.topSpeed * 1.1, 6);
    m.sim.state.boostLeft = 100;
    m.run(seconds(4), FWD, { ...NO_MODS, speedMul: 1.2 });
    expect(speed(m.sim.state)).toBeCloseTo(cfg.speedCap, 6);
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
