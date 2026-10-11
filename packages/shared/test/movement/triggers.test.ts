import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { horizontalLength, vec3 } from '../../src/math/vec3';
import { box, makeSim } from '../helpers/simHarness';

const dt = 1 / cfg.tickRate;
const launch = vec3(2, 12, -3);
const pad = { id: 'p1', position: vec3(0, 0, -2), radius: 1.2, launch };

describe('jump pads', () => {
  it('stepping onto a jump pad sets velocity to its launch vector', async () => {
    const h = await makeSim({ jumpPads: [pad] });
    const ev = h.run(20, { forward: 1 });
    expect(ev).toContainEqual({ kind: 'jumpPad', padId: 'p1' });
    const s = h.sim.state;
    expect(s.mode).toBe('air');
    // Find the tick after the launch: next-tick velocity is launch minus gravity for one tick.
    const h2 = await makeSim({ jumpPads: [pad] });
    let launched = false;
    for (let i = 0; i < 20 && !launched; i++) launched = h2.tick({ forward: 1 }).some((e) => e.kind === 'jumpPad');
    expect(launched).toBe(true);
    expect(h2.sim.state.airApexY).toBeCloseTo(h2.sim.state.position.y, 6);
    h2.tick();
    const v = h2.sim.state.velocity;
    expect(v.y).toBeGreaterThan(launch.y - cfg.gravity * dt - 0.05);
    expect(v.y).toBeLessThan(launch.y - cfg.gravity * dt + 0.05);
    expect(v.x).toBeCloseTo(launch.x, 1);
    expect(v.z).toBeCloseTo(launch.z, 1);
  });

  it('a pad does not retrigger within retriggerCooldown', async () => {
    // Spawning on the pad triggers it during the harness's settling ticks; the cooldown then holds it off.
    const h = await makeSim({ jumpPads: [{ ...pad, launch: vec3(0, 0.5, 0) }], spawn: vec3(0, 0, -2) });
    const pads = (ev: { kind: string }[]) => ev.filter((e) => e.kind === 'jumpPad').length;
    expect(pads(h.run(8))).toBe(0);
    expect(pads(h.run(12))).toBe(1);
  });

  it('closes the coyote window so a pad launch gives no free jump', async () => {
    const h = await makeSim({ jumpPads: [pad], spawn: vec3(0, 0, -2) });
    const ev = h.tick({}, ['jump']);
    expect(ev.some((e) => e.kind === 'jumped')).toBe(false);
    expect(h.sim.state.velocity.y).toBeLessThan(launch.y);
    expect(h.sim.state.velocity.y).toBeGreaterThan(launch.y / 2);
  });
});

describe('pad launch over special modes', () => {
  it('a pad overlapping a zip line ride clears the ride and launches', async () => {
    const p = { id: 'zp', position: vec3(0, 7, 0), radius: 3, launch: vec3(0, 12, 0) };
    const h = await makeSim({
      solids: [box('platform', vec3(0, 4, 0), vec3(4, 8, 4))],
      zipLines: [{ id: 'z', a: vec3(0, 10, 0), b: vec3(0, 4, -30) }],
      jumpPads: [p],
      spawn: vec3(0, 8, 0),
    });
    // Settling ticks already hit the pad at the platform top? Its y range is 7..7.5, above the platform top at 8? No: feet at 8 are above it.
    h.tick({}, ['interact']);
    expect(h.sim.state.mode).toBe('zipline');
    let ev = h.tick();
    for (let i = 0; i < 200 && !ev.some((e) => e.kind === 'jumpPad'); i++) ev = h.tick();
    expect(ev).toContainEqual({ kind: 'jumpPad', padId: 'zp' });
    expect(h.sim.state.zip).toBeNull();
    expect(h.sim.state.mantle).toBeNull();
    expect(h.sim.state.mode).toBe('air');
    h.tick();
    expect(h.sim.state.velocity.y).toBeGreaterThan(p.launch.y - 2);
    expect(h.sim.state.mode).toBe('air');
  });
});

describe('boost orbs', () => {
  const orb = { id: 'o1', position: vec3(0, 1, -3) };
  const sprint = { forward: 1, sprint: true };

  it('a boost orb raises sprint to 11.2 m/s for 3 s, then back to 8', async () => {
    const h = await makeSim({ boostOrbs: [orb], spawn: vec3(0, 0, 0) });
    const ev = h.run(40, sprint);
    expect(ev).toContainEqual({ kind: 'orbCollected', orbId: 'o1' });
    expect(h.sim.state.boostLeft).toBeGreaterThan(0);
    expect(horizontalLength(h.sim.state.velocity)).toBeCloseTo(cfg.run.sprintSpeed * cfg.boostOrb.speedMultiplier, 1);
    expect(horizontalLength(h.sim.state.velocity)).toBeCloseTo(11.2, 1);
    h.run(Math.round(cfg.boostOrb.duration * cfg.tickRate) + 30, sprint);
    expect(h.sim.state.boostLeft).toBe(0);
    expect(horizontalLength(h.sim.state.velocity)).toBeCloseTo(cfg.run.sprintSpeed, 1);
  });

  it('a collected orb is unavailable for 30 s, then can be collected again', async () => {
    const h = await makeSim({ boostOrbs: [orb], spawn: vec3(0, 0, -3) });
    const count = (ev: { kind: string }[]) => ev.filter((e) => e.kind === 'orbCollected').length;
    // Spawning inside the orb collects it during the harness's settling ticks.
    const first = h.world.orbAvailableAt.get('o1')!;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(h.time + cfg.boostOrb.respawnTime);
    expect(count(h.run(Math.floor((first - h.time) * cfg.tickRate) - 1))).toBe(0);
    expect(count(h.run(4))).toBe(1);
    expect(h.world.orbAvailableAt.get('o1')).toBeGreaterThanOrEqual(first + cfg.boostOrb.respawnTime - 4 * dt);
  });

  it('boosted speed still respects the 18 m/s cap', async () => {
    const h = await makeSim({ boostOrbs: [orb], spawn: vec3(0, 0, 0) });
    h.run(40, sprint);
    // A speed multiplier mod on top of the orb boost would exceed the cap without clampHorizontal.
    h.run(60, sprint, { speedMul: 3, jumpHeightMul: 1 });
    expect(horizontalLength(h.sim.state.velocity)).toBeLessThanOrEqual(cfg.speedCap + 1e-6);
    expect(horizontalLength(h.sim.state.velocity)).toBeGreaterThan(cfg.run.sprintSpeed * cfg.boostOrb.speedMultiplier);
  });
});

describe('out-of-bounds respawn', () => {
  const checkpoints = [
    { id: 'near', position: vec3(10, 5, 0) },
    { id: 'far', position: vec3(-50, 5, 0) },
  ];

  it('falling below outOfBoundsY respawns at the checkpoint nearest the last grounded spot, with zero velocity', async () => {
    const h = await makeSim({
      floor: false,
      solids: [box('plat', vec3(0, -0.5, 0), vec3(8, 1, 8))],
      checkpoints,
      spawn: vec3(0, 0, 0),
    });
    expect(h.sim.state.lastGrounded.x).toBeCloseTo(0, 1);
    h.sim.teleport(vec3(20, 0, 0)); // off the platform, over the void
    const ev = h.run(120);
    expect(ev).toContainEqual({ kind: 'respawned', checkpointId: 'near' });
    // The respawn tick itself leaves the player at the checkpoint with zero velocity.
    const again = await makeSim({
      floor: false,
      solids: [box('plat', vec3(0, -0.5, 0), vec3(8, 1, 8))],
      checkpoints,
      spawn: vec3(0, 0, 0),
    });
    again.sim.teleport(vec3(20, -2.9, 0));
    let e2 = again.tick();
    for (let i = 0; i < 30 && !e2.some((e) => e.kind === 'respawned'); i++) e2 = again.tick();
    expect(e2).toContainEqual({ kind: 'respawned', checkpointId: 'near' });
    expect(again.sim.state.velocity).toEqual(vec3(0, 0, 0));
    expect(again.sim.state.mode).toBe('air');
  });

  it('respawn position and velocity at the moment of respawn', async () => {
    const h = await makeSim({ floor: false, checkpoints, spawn: vec3(0, 40, 0) });
    h.sim.state.lastGrounded = vec3(-40, 0, 0);
    let ev = h.tick();
    for (let i = 0; i < 400 && !ev.some((e) => e.kind === 'respawned'); i++) ev = h.tick();
    expect(ev).toContainEqual({ kind: 'respawned', checkpointId: 'far' });
    const s = h.sim.state;
    expect(s.position.x).toBeCloseTo(-50, 5);
    expect(s.position.y).toBeCloseTo(5, 5);
    expect(s.velocity).toEqual(vec3(0, 0, 0));
  });

  it('leaving the island edge (beyond size/2 + boundsMargin) also respawns', async () => {
    const h = await makeSim({ checkpoints });
    h.sim.teleport(vec3(h.map.size / 2 + cfg.fall.boundsMargin + 1, 3, 0));
    const ev = h.tick();
    expect(ev.some((e) => e.kind === 'respawned')).toBe(true);
    expect(h.sim.state.position.x).toBeCloseTo(10, 5);
  });

  it('falls back to the spawn point when the map has no checkpoints', async () => {
    const h = await makeSim({ spawn: vec3(3, 0, 4) });
    h.sim.teleport(vec3(0, -10, 0));
    const ev = h.tick();
    expect(ev).toContainEqual({ kind: 'respawned', checkpointId: 'spawn' });
    expect(h.sim.state.position.x).toBeCloseTo(3, 5);
    expect(h.sim.state.position.z).toBeCloseTo(4, 5);
  });

  it('respawning mid zip line clears the ride', async () => {
    const h = await makeSim({
      floor: false,
      solids: [box('platform', vec3(0, 4, 0), vec3(4, 8, 4))],
      zipLines: [{ id: 'z', a: vec3(0, 10, 0), b: vec3(0, -12, -30) }],
      checkpoints: [{ id: 'cp', position: vec3(0, 8, 0) }],
      spawn: vec3(0, 8, 0),
    });
    h.tick({}, ['interact']);
    expect(h.sim.state.mode).toBe('zipline');
    let ev = h.tick();
    for (let i = 0; i < 300 && !ev.some((e) => e.kind === 'respawned'); i++) ev = h.tick();
    expect(ev).toContainEqual({ kind: 'respawned', checkpointId: 'cp' });
    expect(h.sim.state.zip).toBeNull();
    expect(h.sim.state.mode).toBe('air');
    expect(h.sim.state.velocity).toEqual(vec3(0, 0, 0));
  });
});
