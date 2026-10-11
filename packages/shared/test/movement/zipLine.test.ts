import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { horizontalLength, vec3 } from '../../src/math/vec3';
import { jumpVelocity } from '../../src/movement/jump';
import { NO_MODS } from '../../src/movement/types';
import type { ZipLine } from '../../src/world/mapTypes';
import { box, makeSim } from '../helpers/simHarness';

/** The player stands on a platform whose top is at y = 8, so a line can hang above them. */
const line = (id: string, a: [number, number, number], b: [number, number, number]): ZipLine => ({
  id,
  a: vec3(...a),
  b: vec3(...b),
});
const rideSim = (zip: ZipLine, yaw = 0, midZ = 0) =>
  makeSim({
    solids: [box('platform', vec3(0, 4, midZ), vec3(4, 8, 4))],
    zipLines: [zip],
    spawn: vec3(0, 8, midZ),
    yaw,
  });
const speedOf = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

describe('zip line', () => {
  it('E within 2 m of a line attaches and rides toward the lower end', async () => {
    // a is the high end, b the low end: the ride runs a -> b (dir +1), toward -Z.
    const h = await rideSim(line('z', [0, 10, 0], [0, 4, -30]));
    h.tick({}, ['interact']);
    const s = h.sim.state;
    expect(s.mode).toBe('zipline');
    expect(s.zip).toMatchObject({ id: 'z', dir: 1 });
    h.run(5);
    expect(h.sim.state.velocity.z).toBeLessThan(0);
    expect(h.sim.state.velocity.y).toBeLessThan(0);
    // Reversed line: the lower end is a, so the ride runs b -> a.
    const r = await rideSim(line('r', [0, 4, -30], [0, 10, 0]));
    r.tick({}, ['interact']);
    expect(r.sim.state.zip).toMatchObject({ dir: -1 });
    expect(r.sim.state.velocity.z).toBeLessThan(0);
  });

  it('E farther than 2 m does not attach', async () => {
    // The hand point is at y = 9.8; the line passes 3 m above it.
    const h = await rideSim(line('z', [0, 12.8, 0], [0, 6.8, -30]));
    h.tick({}, ['interact']);
    expect(h.sim.state.mode).not.toBe('zipline');
    expect(h.sim.state.zip).toBeNull();
    // Without E nothing attaches even next to the line.
    const near = await rideSim(line('z', [0, 10, 0], [0, 4, -30]));
    near.run(5);
    expect(near.sim.state.mode).not.toBe('zipline');
  });

  it('ride speed stays within [10, 16] m/s and rises on a slope', async () => {
    const h = await rideSim(line('z', [0, 10, 0], [0, 2, -30]));
    h.tick({}, ['interact']);
    const speeds: number[] = [h.sim.state.zip!.speed];
    while (h.sim.state.mode === 'zipline') {
      h.tick();
      if (h.sim.state.zip) speeds.push(h.sim.state.zip.speed);
    }
    // The attach tick already rode one step: at most one tick of acceleration above the base speed.
    expect(speeds[0]).toBeLessThan(cfg.zipLine.baseSpeed + 0.5);
    for (const v of speeds) {
      expect(v).toBeGreaterThanOrEqual(cfg.zipLine.baseSpeed - 1e-9);
      expect(v).toBeLessThanOrEqual(cfg.zipLine.maxSpeed + 1e-9);
    }
    expect(speeds[5] ?? 0).toBeGreaterThan(speeds[0] ?? Infinity);
    expect(Math.max(...speeds)).toBeCloseTo(cfg.zipLine.maxSpeed, 5);
  });

  it('jumping off keeps the ride velocity (horizontal ≥ 95 % of ride speed) and adds upward speed', async () => {
    // About 8.5 degrees: cos(theta) = 0.989, so the horizontal share can reach 95 %.
    const h = await rideSim(line('z', [0, 10, 0], [0, 7, -20]));
    h.tick({}, ['interact']);
    h.run(8);
    const before = h.sim.state;
    expect(before.mode).toBe('zipline');
    const rideSpeed = before.zip!.speed;
    const rideVy = before.velocity.y;
    h.tick({}, ['jump']);
    const s = h.sim.state;
    expect(s.mode).toBe('air');
    expect(s.zip).toBeNull();
    expect(horizontalLength(s.velocity)).toBeGreaterThanOrEqual(0.95 * rideSpeed);
    expect(s.velocity.y).toBeGreaterThan(rideVy + jumpVelocity(cfg, NO_MODS) - 0.5);
    expect(s.airApexY).toBeCloseTo(s.position.y, 5);
  });

  it('reaching the end detaches with the ride velocity', async () => {
    const zip = line('z', [0, 10, 0], [0, 7, -12]);
    const h = await rideSim(zip);
    h.tick({}, ['interact']);
    let last = h.sim.state.velocity;
    let guard = 0;
    while (h.sim.state.mode === 'zipline' && guard++ < 200) {
      last = h.sim.state.velocity;
      h.tick();
    }
    const s = h.sim.state;
    expect(s.mode).toBe('air');
    expect(s.zip).toBeNull();
    expect(s.position.z).toBeCloseTo(zip.b.z, 5);
    expect(s.position.y).toBeCloseTo(zip.b.y - cfg.zipLine.hangDrop, 5);
    expect(speedOf(s.velocity)).toBeGreaterThanOrEqual(cfg.zipLine.baseSpeed - 1e-9);
    expect(s.velocity.z).toBeLessThan(0);
    expect(s.velocity.z).toBeCloseTo(last.z, 0);
    expect(s.airApexY).toBeCloseTo(s.position.y, 5);
  });

  it('a level line (|Δy| < 0.5 m) rides in the facing direction', async () => {
    // b is (slightly) lower, but the player faces +Z (yaw π), toward a, so the ride runs b -> a.
    const zip = line('z', [0, 10.2, 0], [0, 10, -20]);
    const h = await rideSim(zip, Math.PI, -10);
    h.tick({}, ['interact']);
    expect(h.sim.state.zip).toMatchObject({ dir: -1 });
    h.run(5);
    expect(h.sim.state.velocity.z).toBeGreaterThan(0);
    // Facing the other way (yaw 0, toward -Z) rides toward b.
    const g = await rideSim(zip, 0, -10);
    g.tick({}, ['interact']);
    expect(g.sim.state.zip).toMatchObject({ dir: 1 });
    expect(g.sim.state.velocity.z).toBeLessThan(0);
  });

  it('detaching (jump-off or end of line) leaves no coyote jump', async () => {
    const jumped = (ev: { kind: string }[]) => ev.some((e) => e.kind === 'jumped');
    const a = await rideSim(line('z', [0, 10, 0], [0, 7, -20]));
    a.tick({}, ['interact']);
    a.tick({}, ['jump']);
    expect(a.sim.state.mode).toBe('air');
    expect(jumped(a.tick({}, ['jump']))).toBe(false);

    const b = await rideSim(line('z', [0, 10, 0], [0, 7, -12]));
    b.tick({}, ['interact']);
    let guard = 0;
    while (b.sim.state.mode === 'zipline' && guard++ < 200) b.tick();
    expect(b.sim.state.mode).toBe('air');
    expect(jumped(b.tick({}, ['jump']))).toBe(false);
  });

  it('speedMul 1.4 lifts the ride cap above 16 m/s but never past the 18 m/s global cap', async () => {
    const mods = { speedMul: 1.4, jumpHeightMul: 1 };
    const h = await rideSim(line('z', [0, 10, 0], [0, 2, -30]));
    h.tick({}, ['interact'], mods);
    let top = 0;
    let guard = 0;
    while (h.sim.state.mode === 'zipline' && guard++ < 300) {
      h.tick({}, [], mods);
      if (h.sim.state.zip) top = Math.max(top, h.sim.state.zip.speed);
    }
    expect(top).toBeGreaterThan(cfg.zipLine.maxSpeed);
    expect(top).toBeLessThanOrEqual(cfg.speedCap + 1e-9);
    expect(top).toBeCloseTo(cfg.speedCap, 5);
  });

  it('jump-off adds jumpVelocity for the jumpHeightMul in force', async () => {
    const mods = { speedMul: 1, jumpHeightMul: 0.9 };
    const zip = line('z', [0, 10, 0], [0, 7, -20]);
    const jumper = await rideSim(zip);
    const rider = await rideSim(zip);
    for (const h of [jumper, rider]) {
      h.tick({}, ['interact'], mods);
      h.run(4, {}, mods);
    }
    jumper.tick({}, ['jump'], mods);
    rider.tick({}, [], mods);
    expect(jumper.sim.state.mode).toBe('air');
    expect(jumper.sim.state.velocity.y - rider.sim.state.velocity.y).toBeCloseTo(jumpVelocity(cfg, mods), 9);
    expect(jumpVelocity(cfg, mods)).toBeLessThan(jumpVelocity(cfg, NO_MODS));
  });
});
