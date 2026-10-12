import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { horizontalLength, vec3 } from '../../src/math/vec3';
import { box, makeSim, type Hold } from '../helpers/simHarness';

const SPRINT: Hold = { forward: 1, sprint: true };
/** Near face of every test ledge (yaw 0 runs toward -Z). */
const FACE = -3;
const DEPTH = 10;
/** A ledge `height` m tall whose near face is at z = FACE and whose top spans z in [FACE - DEPTH, FACE]. */
const ledge = (height: number) => box('ledge', vec3(0, height / 2, FACE - DEPTH / 2), vec3(8, height, DEPTH));
const durationTicks = (extra: number) => Math.round((cfg.mantle.duration + extra) * cfg.tickRate);

describe('mantle', () => {
  it('running into a 1.5 m ledge ends standing on top (feet y = 1.5 ± 0.05) within duration + 0.2 s', async () => {
    const h = await makeSim({ solids: [ledge(1.5)] });
    h.runUntil((s) => s.mode === 'mantle', 60, SPRINT);
    expect(h.sim.state.mantle).not.toBeNull();
    const ticks = h.runUntil((s) => s.mode !== 'mantle', durationTicks(0.2), SPRINT);
    expect(ticks).toBeLessThanOrEqual(durationTicks(0.2));
    const s = h.sim.state;
    expect(s.mode).toBe('ground');
    expect(s.mantle).toBeNull();
    expect(s.position.y).toBeGreaterThanOrEqual(1.45);
    expect(s.position.y).toBeLessThanOrEqual(1.55);
    expect(s.position.z).toBeLessThan(FACE);
    // It stays standing on top afterwards.
    h.run(10, SPRINT);
    expect(h.sim.state.grounded).toBe(true);
    expect(h.sim.state.position.y).toBeCloseTo(1.5, 1);
  });

  it('a 1.0 m ledge mantles too', async () => {
    const h = await makeSim({ solids: [ledge(1.0)] });
    h.runUntil((s) => s.mode === 'mantle', 60, SPRINT);
    h.runUntil((s) => s.mode !== 'mantle', durationTicks(0.2), SPRINT);
    expect(h.sim.state.mode).toBe('ground');
    expect(h.sim.state.position.y).toBeGreaterThanOrEqual(0.95);
    expect(h.sim.state.position.y).toBeLessThanOrEqual(1.05);
    expect(h.sim.state.position.z).toBeLessThan(FACE);
  });

  it('a 1.8 m wall does not mantle (feet y < 0.1 after pushing for 1 s)', async () => {
    const h = await makeSim({ solids: [ledge(1.8)] });
    h.runUntil((s) => s.position.z < FACE + 1, 60, SPRINT);
    for (let i = 0; i < cfg.tickRate; i++) {
      h.tick(SPRINT);
      expect(h.sim.state.mode).not.toBe('mantle');
    }
    expect(h.sim.state.position.y).toBeLessThan(0.1);
    expect(h.sim.state.position.z).toBeGreaterThan(FACE);
  });

  it('air mantle: jumping at a 2.6 m ledge reaches the top', async () => {
    // Apex 1.2 m puts the 2.6 m top 1.4 m above the feet: within maxHeight 1.5.
    const h = await makeSim({ solids: [ledge(2.6)], spawn: vec3(0, 0, FACE + 1.5) });
    h.tick(SPRINT, ['jump']);
    expect(h.sim.state.mode).toBe('air');
    h.runUntil((s) => s.mode === 'mantle', 30, SPRINT);
    expect(h.sim.state.position.y).toBeGreaterThan(2.6 - cfg.mantle.maxHeight - 1e-6);
    h.runUntil((s) => s.mode !== 'mantle', durationTicks(0.2), SPRINT);
    expect(h.sim.state.mode).toBe('ground');
    expect(h.sim.state.position.y).toBeGreaterThanOrEqual(2.55);
    expect(h.sim.state.position.y).toBeLessThanOrEqual(2.65);
    expect(h.sim.state.position.z).toBeLessThan(FACE);
    h.run(5, SPRINT);
    expect(h.sim.state.grounded).toBe(true);
    expect(h.sim.state.position.y).toBeCloseTo(2.6, 1);
  });

  it('no mantle when there is no headroom on top', async () => {
    // Ceiling slab 1.0 m above the 1.0 m ledge top, covering only the top: the 1.82 m capsule cannot stand there.
    const ceiling = box('ceiling', vec3(0, 2.5, FACE - DEPTH / 2), vec3(8, 1, DEPTH));
    const h = await makeSim({ solids: [ledge(1.0), ceiling] });
    h.runUntil((s) => s.position.z < FACE + 1, 60, SPRINT);
    for (let i = 0; i < cfg.tickRate; i++) {
      h.tick(SPRINT);
      expect(h.sim.state.mode).not.toBe('mantle');
    }
    expect(h.sim.state.position.y).toBeLessThan(0.1);
    expect(h.sim.state.position.z).toBeGreaterThan(FACE);
  });

  it('keeps ≥ 90 % of horizontal speed after the mantle', async () => {
    const h = await makeSim({ solids: [ledge(1.0)], spawn: vec3(0, 0, 8) });
    h.runUntil((s) => s.mode === 'mantle', 90, SPRINT);
    const before = h.sim.state.mantle?.horizontalVelocity;
    expect(before).toBeDefined();
    const entry = horizontalLength(before ?? vec3(0, 0, 0));
    expect(entry).toBeGreaterThanOrEqual(cfg.run.sprintSpeed - 0.05);
    h.runUntil((s) => s.mode !== 'mantle', durationTicks(0.2), SPRINT);
    expect(horizontalLength(h.sim.state.velocity)).toBeGreaterThanOrEqual(0.9 * entry);
    h.tick(SPRINT);
    expect(h.sim.state.grounded).toBe(true);
    expect(horizontalLength(h.sim.state.velocity)).toBeGreaterThanOrEqual(0.9 * entry);
  });
});
