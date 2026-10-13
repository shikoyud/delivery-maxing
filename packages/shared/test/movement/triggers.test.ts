import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { vec3 } from '../../src/math/vec3';
import { box, makeSim } from '../helpers/simHarness';

describe('out-of-bounds respawn', () => {
  it('falling below outOfBoundsY respawns at the map spawn and emits respawned', async () => {
    const h = await makeSim({
      floor: false,
      solids: [box('plat', vec3(0, -0.5, 0), vec3(8, 1, 8))],
      spawn: vec3(0, 0, 0),
    });
    h.sim.teleport(vec3(20, 0, 0)); // off the platform, over the void
    let ev = h.tick();
    for (let i = 0; i < 120 && !ev.some((e) => e.kind === 'respawned'); i++) ev = h.tick();
    expect(ev).toContainEqual({ kind: 'respawned', hospitalId: 'spawn' });
    const s = h.sim.state;
    expect(s.position.x).toBeCloseTo(0, 5);
    expect(s.position.y).toBeCloseTo(0, 5);
    expect(s.position.z).toBeCloseTo(0, 5);
    expect(s.velocity).toEqual(vec3(0, 0, 0));
    expect(s.mode).toBe('air');
    expect(s.jumpPressAge).toBeNull();
  });

  it('respawns at a non-origin spawn, whatever the last grounded position was', async () => {
    const h = await makeSim({ spawn: vec3(3, 0, 4) });
    h.sim.teleport(vec3(0, -10, 0));
    const ev = h.tick();
    expect(ev).toContainEqual({ kind: 'respawned', hospitalId: 'spawn' });
    expect(h.sim.state.position.x).toBeCloseTo(3, 5);
    expect(h.sim.state.position.z).toBeCloseTo(4, 5);
  });

  it('leaving the island edge (beyond size/2 + boundsMargin) also respawns', async () => {
    const h = await makeSim({ spawn: vec3(5, 0, 0) });
    h.sim.teleport(vec3(h.map.size / 2 + cfg.fall.boundsMargin + 1, 3, 0));
    const ev = h.tick();
    expect(ev.some((e) => e.kind === 'respawned')).toBe(true);
    expect(h.sim.state.position.x).toBeCloseTo(5, 5);
  });

  it('does not respawn while inside the bounds', async () => {
    const h = await makeSim();
    expect(h.run(30, { forward: 1 }).some((e) => e.kind === 'respawned')).toBe(false);
  });
});
