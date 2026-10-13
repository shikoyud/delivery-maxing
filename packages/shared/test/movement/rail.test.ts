import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { horizontalLength, vec3 } from '../../src/math/vec3';
import { jumpVelocity } from '../../src/movement/jump';
import type { Rail } from '../../src/world/mapTypes';
import { makeSim } from '../helpers/simHarness';

const rail = (id: string, ...pts: [number, number, number][]): Rail => ({ id, points: pts.map((p) => vec3(...p)) });
const straight = rail('r', [0, 3, 0], [0, 3, -40]);

/** A player dropping onto the rail at z = -2, heading -Z at `speed`. */
async function dropOnto(r: Rail, speed = 10, vy = -1) {
  const h = await makeSim({ rails: [r] });
  h.sim.teleport(vec3(0, 3.3, -2), vec3(0, vy, -speed));
  return h;
}

describe('grind rails', () => {
  it('landing on a rail from above starts grinding along it', async () => {
    const h = await dropOnto(straight);
    h.tick();
    const s = h.sim.state;
    expect(s.mode).toBe('grind');
    expect(s.grind).toMatchObject({ id: 'r', segment: 0, dir: 1 });
    expect(s.position.y).toBeCloseTo(3.05, 6);
    expect(s.velocity.z).toBeLessThan(0);
    expect(s.grounded).toBe(false);
  });

  it('does not start when rising, or when the feet are more than 0.1 m below the rail', async () => {
    const up = await dropOnto(straight, 10, 2);
    up.tick();
    expect(up.sim.state.mode).toBe('air');
    expect(up.sim.state.grind).toBeNull();

    const below = await makeSim({ rails: [straight] });
    below.sim.teleport(vec3(0, 2.8, -2), vec3(0, -1, -10));
    below.tick();
    expect(below.sim.state.grind).toBeNull();

    const far = await makeSim({ rails: [straight] });
    far.sim.teleport(vec3(1.5, 3.3, -2), vec3(0, -1, -10));
    far.tick();
    expect(far.sim.state.grind).toBeNull();
  });

  it('a level rail keeps speed minus friction (after 1 s >= entry - friction - 0.05)', async () => {
    const h = await dropOnto(straight, 10);
    h.tick();
    const entry = 10;
    expect(h.sim.state.grind!.speed).toBeCloseTo(entry - cfg.rail.friction / cfg.tickRate, 6);
    h.run(Math.round(cfg.tickRate));
    const s = h.sim.state;
    expect(s.mode).toBe('grind');
    expect(s.grind!.speed).toBeGreaterThanOrEqual(entry - cfg.rail.friction - 0.05);
    expect(s.grind!.speed).toBeLessThan(entry);
    expect(horizontalLength(s.velocity)).toBeCloseTo(s.grind!.speed, 6);
  });

  it('speeds up going downhill and never exceeds the global speed cap', async () => {
    const h = await dropOnto(rail('d', [0, 5, 0], [0, -35, -40]), 10);
    h.tick();
    h.run(10);
    expect(h.sim.state.grind!.speed).toBeGreaterThan(10);
    h.runUntil((s) => s.mode !== 'grind', 400);
    expect(Math.hypot(h.sim.state.velocity.x, h.sim.state.velocity.z)).toBeLessThanOrEqual(cfg.speedCap + 1e-6);
  });

  it('follows a bent rail across segments', async () => {
    const h = await dropOnto(rail('b', [0, 3, 0], [0, 3, -10], [20, 3, -10]), 10);
    h.tick();
    h.runUntil((s) => s.grind?.segment === 1, 200);
    const s = h.sim.state;
    expect(s.mode).toBe('grind');
    expect(s.velocity.x).toBeGreaterThan(5);
    expect(Math.abs(s.velocity.z)).toBeLessThan(1e-6);
    expect(s.position.y).toBeCloseTo(3.05, 6);
    expect(s.position.z).toBeCloseTo(-10, 6);
  });

  it('grinds a rail in the reverse direction (dir -1, segments decrease)', async () => {
    const r = rail('rev', [0, 3, 0], [0, 3, -10], [20, 3, -10]);
    const h = await makeSim({ rails: [r] });
    h.sim.teleport(vec3(15, 3.3, -10), vec3(-10, -1, 0));
    h.tick();
    expect(h.sim.state.grind).toMatchObject({ segment: 1, dir: -1 });
    h.runUntil((s) => s.grind?.segment === 0, 200);
    expect(h.sim.state.velocity.z).toBeGreaterThan(5);
  });

  it('leaving the rail end launches along the last segment direction', async () => {
    const h = await dropOnto(rail('e', [0, 3, 0], [0, 3, -10], [10, 3, -10]), 10);
    h.tick();
    h.runUntil((s) => s.mode !== 'grind', 200);
    const s = h.sim.state;
    expect(s.mode).toBe('air');
    expect(s.grind).toBeNull();
    expect(s.velocity.x).toBeGreaterThan(5);
    expect(Math.abs(s.velocity.z)).toBeLessThan(1e-6);
    expect(s.airApexY).toBeCloseTo(s.position.y, 6);
    // It does not snap straight back onto the rail end it just left.
    h.run(5);
    expect(h.sim.state.mode).toBe('air');
  });

  it('jumping off keeps speed and adds upward velocity', async () => {
    const h = await dropOnto(straight, 10);
    h.tick();
    h.run(5);
    const speed = h.sim.state.grind!.speed;
    h.tick({}, ['jump']);
    const s = h.sim.state;
    expect(s.mode).toBe('air');
    expect(s.grind).toBeNull();
    expect(s.velocity.y).toBeCloseTo(jumpVelocity(cfg, { speedMul: 1, jumpHeightMul: 1 }), 6);
    expect(horizontalLength(s.velocity)).toBeCloseTo(speed - cfg.rail.friction / cfg.tickRate, 6);
    expect(s.velocity.z).toBeLessThan(0);
  });

  it('jump-off honours jumpHeightMul', async () => {
    const mods = { speedMul: 1, jumpHeightMul: 0.9 };
    const h = await dropOnto(straight, 10);
    h.tick();
    h.tick({}, ['jump'], mods);
    expect(h.sim.state.velocity.y).toBeCloseTo(jumpVelocity(cfg, mods), 6);
  });

  it('a jump press the tick after detaching does not jump (no coyote double jump)', async () => {
    const jumped = await dropOnto(straight, 10);
    jumped.tick();
    jumped.tick({}, ['jump']);
    const vy = jumped.sim.state.velocity.y;
    const events = jumped.tick({}, ['jump']);
    expect(events.some((e) => e.kind === 'jumped')).toBe(false);
    expect(jumped.sim.state.velocity.y).toBeLessThan(vy);

    const ended = await dropOnto(rail('s', [0, 3, 0], [0, 3, -6]), 10);
    ended.tick();
    ended.runUntil((s) => s.mode !== 'grind', 200);
    const e2 = ended.tick({}, ['jump']);
    expect(e2.some((e) => e.kind === 'jumped')).toBe(false);
    expect(ended.sim.state.velocity.y).toBeLessThan(0);
  });

  it('on foot, grind speed is at least minSpeedFoot 6 (enter at 3 m/s -> 6)', async () => {
    const h = await dropOnto(straight, 3);
    h.tick();
    expect(cfg.rail.minSpeedFoot).toBe(6);
    expect(h.sim.state.grind!.speed).toBe(6);
    h.run(30);
    expect(h.sim.state.grind!.speed).toBe(6);
  });

  it('a rail whose last segment slopes down releases the courier at its end (no re-catch; the courier lands beyond or below the end within 1 s)', async () => {
    const r = rail('down', [0, 3, 0], [0, 3, -10], [0, 2, -14]);
    const end = r.points[2]!;
    const h = await dropOnto(r, 10);
    h.tick();
    expect(h.sim.state.mode).toBe('grind');
    h.runUntil((s) => s.mode !== 'grind', 200);
    // For a second after the end: never back on the rail, and the feet leave the end (past it or below it)
    let landed = false;
    for (let i = 0; i < cfg.tickRate; i++) {
      const events = h.tick();
      expect(h.sim.state.mode, `tick ${i}`).not.toBe('grind');
      landed ||= events.some((e) => e.kind === 'landed');
    }
    const p = h.sim.state.position;
    expect(p.z < end.z - 1 || p.y < end.y - 1, `feet left the end (at ${JSON.stringify(p)})`).toBe(true);
    expect(landed, 'landed on the floor beyond the end').toBe(true);
    expect(h.sim.state.grounded).toBe(true);
  });

  it('the same rail can be grinded again after leaving its end, and other rails catch at once', async () => {
    const r = rail('down', [0, 3, 0], [0, 3, -10], [0, 2, -14]);
    const other = rail('other', [0, 1.6, -14.5], [0, 1.6, -40]);
    const h = await makeSim({ rails: [r, other] });
    h.sim.teleport(vec3(0, 3.3, -2), vec3(0, -1, -10));
    h.tick();
    h.runUntil((s) => s.mode !== 'grind', 200);
    // Off the end of the first rail straight onto the second one, just below and ahead
    h.runUntil((s) => s.mode === 'grind', 30);
    expect(h.sim.state.grind!.id).toBe('other');
    h.runUntil((s) => s.mode !== 'grind', 200);
    h.runUntil((s) => s.grounded, 60);
    // Back onto the first rail later: it catches again
    h.sim.teleport(vec3(0, 3.3, -2), vec3(0, -1, -10));
    h.tick();
    expect(h.sim.state.grind).toMatchObject({ id: 'down', segment: 0, dir: 1 });
  });

  it('a jump pressed just before a downhill rail end still jumps off (SP1 jump-off unchanged)', async () => {
    const r = rail('down', [0, 3, 0], [0, 3, -10], [0, 2, -14]);
    const h = await dropOnto(r, 10);
    h.tick();
    h.runUntil((s) => s.grind?.segment === 1 && s.grind.s > 2, 200);
    h.tick({}, ['jump']);
    const s = h.sim.state;
    expect(s.mode).toBe('air');
    expect(s.velocity.y).toBeGreaterThan(jumpVelocity(cfg, { speedMul: 1, jumpHeightMul: 1 }) - 3);
    h.run(10);
    expect(h.sim.state.mode).not.toBe('grind');
  });

  it('starting a grind clears wall-run state', async () => {
    const h = await dropOnto(straight, 10);
    h.sim.state.wallRun = { time: 0.4, normal: vec3(1, 0, 0), lastNormal: vec3(1, 0, 0) };
    h.tick();
    expect(h.sim.state.mode).toBe('grind');
    expect(h.sim.state.wallRun).toEqual({ time: 0, normal: null, lastNormal: null });
  });

  it('teleporting while grinding clears the grind state', async () => {
    const h = await dropOnto(straight, 10);
    h.tick();
    h.sim.teleport(vec3(30, 5, 30));
    expect(h.sim.state.grind).toBeNull();
    expect(h.sim.state.mode).toBe('air');
  });
});
