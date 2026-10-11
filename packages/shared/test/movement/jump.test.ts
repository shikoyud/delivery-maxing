import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { horizontalLength, vec3 } from '../../src/math/vec3';
import type { SimEvent } from '../../src/movement/types';
import { box, makeSim, type Harness, type Hold } from '../helpers/simHarness';

/*
 * Tick definitions used below (controller ruling R2):
 * - "landing tick": the first tick whose step BEGINS grounded, i.e. the tick after the one that emitted
 *   `landed`. tryJump runs before the move, so a buffered press can only fire on that tick.
 * - "airTicks N": the value of state.airTicks at the START of the step in which jump is pressed
 *   (0 after the step that left the ground).
 */

const jumped = (ev: SimEvent[]) => ev.some((e) => e.kind === 'jumped');
const landedEvent = (ev: SimEvent[]) => ev.find((e) => e.kind === 'landed');

/** Jumps from standing and returns the apex height above the take-off feet height. */
function measureApex(h: Harness, mods = { speedMul: 1, jumpHeightMul: 1 }): number {
  const y0 = h.sim.state.position.y;
  expect(jumped(h.tick({}, ['jump'], mods))).toBe(true);
  let apex = h.sim.state.position.y;
  for (let i = 0; i < 60 && !h.sim.state.grounded; i++) {
    h.tick({}, [], mods);
    apex = Math.max(apex, h.sim.state.position.y);
  }
  expect(h.sim.state.grounded).toBe(true);
  return apex - y0;
}

/** Ledge platform: top at y = 5, the player spawns on it and walks off its -Z edge. */
async function walkOffLedge(): Promise<Harness> {
  const h = await makeSim({ solids: [box('ledge', vec3(0, 2.5, 0), vec3(4, 5, 4))], spawn: vec3(0, 5, 0) });
  expect(h.sim.state.grounded).toBe(true);
  h.runUntil((s) => !s.grounded, 60, { forward: 1 }); // the step that leaves the ground sets airTicks = 0
  expect(h.sim.state.airTicks).toBe(0);
  return h;
}

/** Walks off the ledge and presses jump at the start of the step where airTicks === n. */
async function coyoteAttempt(n: number): Promise<{ h: Harness; events: SimEvent[] }> {
  const h = await walkOffLedge();
  while (h.sim.state.airTicks < n) h.tick({ forward: 1 });
  expect(h.sim.state.airTicks).toBe(n);
  expect(h.sim.state.grounded).toBe(false);
  return { h, events: h.tick({ forward: 1 }, ['jump']) };
}

/** Drops the player from 3 m onto the floor; pressing jump on tick `pressTick` (0-based) if given. */
async function dropRun(pressTick: number | null, ticks: number): Promise<SimEvent[][]> {
  const h = await makeSim({ floor: true });
  h.sim.teleport(vec3(0, 3, 0));
  const log: SimEvent[][] = [];
  for (let i = 0; i < ticks; i++) log.push(h.tick({}, i === pressTick ? ['jump'] : []));
  return log;
}

describe('jump', () => {
  it('jump apex is 1.2 m (± 0.03)', async () => {
    const h = await makeSim();
    expect(Math.abs(measureApex(h) - cfg.jump.height)).toBeLessThanOrEqual(0.03);
  });

  it('jumpHeightMul 0.9 (Heavy) gives an apex of 1.08 m (± 0.03)', async () => {
    const h = await makeSim();
    expect(Math.abs(measureApex(h, { speedMul: 1, jumpHeightMul: 0.9 }) - 1.08)).toBeLessThanOrEqual(0.03);
  });

  it('coyote: jump pressed on airTicks 3 (100 ms after leaving a ledge) still jumps', async () => {
    const { h, events } = await coyoteAttempt(3);
    expect(jumped(events)).toBe(true);
    expect(h.sim.state.velocity.y).toBeGreaterThan(0);
  });

  it('coyote: jump pressed on airTicks 4 (133 ms) does not jump', async () => {
    const { h, events } = await coyoteAttempt(4);
    expect(jumped(events)).toBe(false);
    expect(h.sim.state.velocity.y).toBeLessThan(0);
  });

  it('buffer: jump pressed 3 ticks before the landing tick jumps on the landing tick', async () => {
    // Dry run finds the tick that emits `landed`; the landing tick is the one after it.
    const dry = await dropRun(null, 40);
    const landedAt = dry.findIndex((ev) => landedEvent(ev) !== undefined);
    expect(landedAt).toBeGreaterThan(5);
    const landingTick = landedAt + 1;

    const log = await dropRun(landingTick - 3, landingTick + 5);
    const jumpTicks = log.flatMap((ev, i) => (jumped(ev) ? [i] : []));
    expect(jumpTicks).toEqual([landingTick]);
  });

  it('buffer: jump pressed 4 ticks before the landing tick does not jump', async () => {
    const dry = await dropRun(null, 40);
    const landingTick = dry.findIndex((ev) => landedEvent(ev) !== undefined) + 1;

    const log = await dropRun(landingTick - 4, landingTick + 5);
    expect(log.some(jumped)).toBe(false);
  });

  it('jumping keeps horizontal speed through the air and the landing', async () => {
    const h = await makeSim();
    const hold: Hold = { forward: 1, sprint: true };
    h.run(30, hold);
    expect(jumped(h.tick(hold, ['jump']))).toBe(true);
    h.run(5, hold);
    expect(h.sim.state.grounded).toBe(false);
    expect(horizontalLength(h.sim.state.velocity)).toBeGreaterThanOrEqual(7.9);
    let landed = false;
    for (let i = 0; i < 60 && !landed; i++) landed = landedEvent(h.tick(hold)) !== undefined;
    expect(landed).toBe(true);
    h.run(2, hold);
    expect(h.sim.state.grounded).toBe(true);
    expect(horizontalLength(h.sim.state.velocity)).toBeGreaterThanOrEqual(7.9);
  });

  it('landed reports fallHeight = apex − landing height', async () => {
    const h = await makeSim({ solids: [box('tower', vec3(0, 5, 0), vec3(4, 10, 4))], spawn: vec3(0, 10, 0) });
    expect(h.sim.state.grounded).toBe(true);
    let landed: SimEvent | undefined;
    for (let i = 0; i < 120 && !landed; i++) landed = landedEvent(h.tick({ forward: 1 }));
    expect(landed).toBeDefined();
    if (landed?.kind !== 'landed') throw new Error('no landed event');
    expect(Math.abs(landed.fallHeight - 10)).toBeLessThanOrEqual(0.1);
    expect(h.sim.state.position.y).toBeLessThan(0.1);
  });
});
