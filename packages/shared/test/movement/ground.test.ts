import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { horizontalLength, vec3 } from '../../src/math/vec3';
import { box, makeSim } from '../helpers/simHarness';

const speed = (s: { velocity: { x: number; y: number; z: number } }) => horizontalLength(s.velocity);
const SPRINT = { forward: 1, sprint: true };

describe('ground movement', () => {
  it('sprint reaches 8 m/s within 0.5 s and holds it', async () => {
    const h = await makeSim();
    h.run(15, SPRINT);
    expect(speed(h.sim.state)).toBeGreaterThanOrEqual(7.9);
    h.run(45, SPRINT); // 60 ticks total
    expect(speed(h.sim.state)).toBeGreaterThanOrEqual(7.95);
    expect(speed(h.sim.state)).toBeLessThanOrEqual(8.05);
    // The body really moves at that speed: yaw 0 faces -Z, so 30 more ticks cover ~8 m toward -Z.
    const z0 = h.sim.state.position.z;
    h.run(30, SPRINT);
    expect(z0 - h.sim.state.position.z).toBeCloseTo(8, 1);
    expect(h.sim.state.position.x).toBeCloseTo(0, 3);
    expect(h.sim.state.grounded).toBe(true);
  });

  it('running without Shift settles at runSpeed 5.5', async () => {
    const h = await makeSim();
    h.run(30, { forward: 1 });
    expect(speed(h.sim.state)).toBeCloseTo(cfg.run.runSpeed, 2);
    h.run(30, { forward: 1 });
    expect(speed(h.sim.state)).toBeCloseTo(5.5, 2);
  });

  it('releasing input stops a sprinting player within 0.25 s', async () => {
    const h = await makeSim();
    h.run(30, SPRINT);
    expect(speed(h.sim.state)).toBeGreaterThan(7.9);
    h.run(Math.round(0.25 * cfg.tickRate)); // ~8 ticks, no input
    expect(speed(h.sim.state)).toBeLessThan(0.01);
  });

  it('speedMul 1.175 raises sprint to 9.4 m/s', async () => {
    const mods = { speedMul: 1.175, jumpHeightMul: 1 };
    const h = await makeSim();
    h.run(60, SPRINT, mods);
    expect(speed(h.sim.state)).toBeCloseTo(9.4, 2);
  });

  it('horizontal speed never exceeds the 18 m/s cap', async () => {
    const h = await makeSim();
    h.sim.teleport(vec3(0, h.sim.state.position.y, 0), vec3(30, 0, 0));
    h.tick();
    expect(speed(h.sim.state)).toBeLessThanOrEqual(cfg.speedCap + 1e-9);
    h.tick(SPRINT);
    expect(speed(h.sim.state)).toBeLessThanOrEqual(12 + 1e-9);
  });

  it('above sprint speed the ground only decays at overspeedDecay (momentum rule)', async () => {
    const h = await makeSim();
    h.run(30, SPRINT);
    expect(h.sim.state.grounded).toBe(true);
    // Grounded and sprinting forward (-Z); inject 12 m/s (the on-foot cap) along the same direction.
    h.sim.state.velocity = vec3(0, 0, -12);
    h.run(15, SPRINT); // 0.5 s at overspeedDecay 4 m/s² -> 10 m/s
    expect(h.sim.state.grounded).toBe(true);
    expect(speed(h.sim.state)).toBeGreaterThanOrEqual(9.8);
    expect(speed(h.sim.state)).toBeLessThanOrEqual(10.2);
  });

  it('walls stop the player', async () => {
    // A 4 m tall wall (too tall to mantle) whose near face is at z = -5.
    const face = -5;
    const h = await makeSim({ solids: [box('wall', vec3(0, 2, face - 0.5), vec3(10, 4, 1))] });
    h.run(60, SPRINT);
    // Moving toward -Z: the feet must stay on the near side, at most radius (+ tolerance) from the face.
    expect(h.sim.state.position.z).toBeGreaterThanOrEqual(face + cfg.capsule.radius - 0.05);
    // Speed into the wall is removed rather than kept as phantom momentum.
    expect(speed(h.sim.state)).toBeLessThan(0.5);
  });

  it('auto-steps a 0.3 m curb but is blocked by a 0.6 m block', async () => {
    // Curb: 0.3 m tall, near face at z = -3, sprinting forward onto it.
    const curb = await makeSim({ solids: [box('curb', vec3(0, 0.15, -8), vec3(10, 0.3, 10))] });
    const y0 = curb.sim.state.position.y;
    curb.run(30, SPRINT);
    expect(curb.sim.state.position.z).toBeLessThan(-4);
    expect(curb.sim.state.position.y - y0).toBeCloseTo(0.3, 1);
    expect(curb.sim.state.grounded).toBe(true);

    // Block: 0.6 m tall (above maxStepHeight 0.4). Approached by strafing (yaw +90° turns left, so strafe
    // right heads -Z) so that a later forward-input mantle cannot climb it.
    const face = -3;
    const blk = await makeSim({ solids: [box('block', vec3(0, 0.3, face - 5), vec3(10, 0.6, 10))], yaw: Math.PI / 2 });
    const by0 = blk.sim.state.position.y;
    blk.run(45, { strafe: 1, sprint: true });
    expect(blk.sim.state.position.z).toBeGreaterThanOrEqual(face + cfg.capsule.radius - 0.05);
    expect(blk.sim.state.position.y - by0).toBeLessThan(0.1);
  });

  it('air control keeps perpendicular momentum (R13): lateral 6 stays ≥ 4 after 10 ticks of W only', async () => {
    const h = await makeSim();
    h.sim.teleport(vec3(0, 10, 0), vec3(6, 0, -7));
    const start = Math.hypot(6, 7);
    for (let i = 0; i < 10; i++) {
      h.tick({ forward: 1 });
      expect(h.sim.state.grounded).toBe(false);
      expect(speed(h.sim.state)).toBeLessThanOrEqual(start + 1e-9);
    }
    expect(h.sim.state.velocity.x).toBeGreaterThanOrEqual(4);
  });
});
