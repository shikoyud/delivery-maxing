import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { emptyInput, type InputFrame } from '../../src/input/inputFrame';
import { horizontalLength } from '../../src/math/vec3';
import { NO_MODS } from '../../src/movement/types';
import { updateSprint } from '../../src/movement/sprint';
import { makeSim, type Harness } from '../helpers/simHarness';

/** A raw frame (not the harness's Hold.sprint), so the toggle itself is under test. */
function frame(opts: { w?: boolean; tap?: boolean; jump?: boolean } = {}): InputFrame {
  const input = emptyInput();
  input.move = { x: 0, y: opts.w ? 1 : 0 };
  if (opts.tap) input.sprint = { held: true, pressed: true };
  if (opts.jump) input.jump = { held: true, pressed: true };
  return input;
}

function step(h: Harness, input: InputFrame): void {
  h.sim.step(input, NO_MODS, h.time);
  h.time += h.sim.dt;
}

function run(h: Harness, ticks: number, opts: { w?: boolean } = {}): void {
  for (let i = 0; i < ticks; i++) step(h, frame(opts));
}

const speed = (h: Harness) => horizontalLength(h.sim.state.velocity);

describe('sprint toggle', () => {
  it('a Shift tap while moving turns sprint on: holding W reaches 8 m/s within 0.5 s', async () => {
    const h = await makeSim();
    step(h, frame({ w: true, tap: true }));
    expect(h.sim.state.sprinting).toBe(true);
    run(h, 14, { w: true }); // 15 ticks in total
    expect(h.sim.state.sprinting).toBe(true);
    expect(speed(h)).toBeCloseTo(cfg.run.sprintSpeed, 1);
  });

  it('a second Shift tap turns it off: speed settles to 5.5', async () => {
    const h = await makeSim();
    step(h, frame({ w: true, tap: true }));
    run(h, 30, { w: true });
    expect(speed(h)).toBeCloseTo(8, 1);
    step(h, frame({ w: true, tap: true }));
    expect(h.sim.state.sprinting).toBe(false);
    run(h, 60, { w: true });
    expect(speed(h)).toBeCloseTo(5.5, 1);
  });

  it('releasing every move key turns sprint off; W again runs at 5.5 without a new tap', async () => {
    const h = await makeSim();
    step(h, frame({ w: true, tap: true }));
    run(h, 30, { w: true });
    step(h, frame()); // no move key
    expect(h.sim.state.sprinting).toBe(false);
    run(h, 30);
    run(h, 60, { w: true });
    expect(h.sim.state.sprinting).toBe(false);
    expect(speed(h)).toBeCloseTo(cfg.run.runSpeed, 1);
  });

  it('a Shift tap with no move key leaves sprint off', async () => {
    const h = await makeSim();
    step(h, frame({ tap: true }));
    expect(h.sim.state.sprinting).toBe(false);
    // Nor is it armed for later: W alone still runs.
    run(h, 60, { w: true });
    expect(speed(h)).toBeCloseTo(cfg.run.runSpeed, 1);
  });

  it('sprint stays on through a jump while W is held', async () => {
    const h = await makeSim();
    step(h, frame({ w: true, tap: true }));
    run(h, 30, { w: true });
    step(h, frame({ w: true, jump: true }));
    expect(h.sim.state.grounded).toBe(false);
    let airTicks = 0;
    while (!h.sim.state.grounded && airTicks < 90) {
      step(h, frame({ w: true }));
      airTicks++;
      expect(h.sim.state.sprinting).toBe(true);
    }
    expect(airTicks).toBeGreaterThan(5);
    expect(h.sim.state.sprinting).toBe(true);
    expect(speed(h)).toBeCloseTo(cfg.run.sprintSpeed, 1);
  });

  it('updateSprint flips on pressed, then clears when there is no move input', () => {
    const dt = 1 / cfg.tickRate;
    const state = { sprinting: false, stamina: cfg.stamina.max } as Parameters<typeof updateSprint>[0];
    updateSprint(state, frame({ w: true, tap: true }), NO_MODS, cfg.stamina, dt);
    expect(state.sprinting).toBe(true);
    updateSprint(state, frame({ w: true }), NO_MODS, cfg.stamina, dt);
    expect(state.sprinting).toBe(true);
    updateSprint(state, frame({ tap: true }), NO_MODS, cfg.stamina, dt);
    expect(state.sprinting).toBe(false);
  });
});

describe('sprint stamina', () => {
  it('starts full, drains while sprinting and regenerates while running', async () => {
    const h = await makeSim();
    expect(h.sim.state.stamina).toBe(cfg.stamina.max);
    step(h, frame({ w: true, tap: true }));
    run(h, 29, { w: true }); // 1 s of sprint in total
    expect(h.sim.state.stamina).toBeCloseTo(cfg.stamina.max - cfg.stamina.sprintDrainPerSecond, 1);
    step(h, frame({ w: true, tap: true })); // sprint off
    const low = h.sim.state.stamina;
    run(h, 30, { w: true }); // 1 s of plain running
    expect(h.sim.state.stamina).toBeCloseTo(low + cfg.stamina.regenPerSecond, 1);
  });

  it('an empty bar shuts sprint off, and the toggle is refused until minSprintStart', async () => {
    const h = await makeSim();
    step(h, frame({ w: true, tap: true }));
    const emptyTicks = Math.ceil((cfg.stamina.max / cfg.stamina.sprintDrainPerSecond) * cfg.tickRate) + 1;
    run(h, emptyTicks, { w: true });
    expect(h.sim.state.sprinting).toBe(false);
    expect(h.sim.state.stamina).toBeLessThan(cfg.stamina.minSprintStart);
    // A tap below the threshold is ignored...
    step(h, frame({ w: true, tap: true }));
    expect(h.sim.state.sprinting).toBe(false);
    // ...but works again once the bar regenerates past it.
    const regenTicks = Math.ceil((cfg.stamina.minSprintStart / cfg.stamina.regenPerSecond) * cfg.tickRate) + 1;
    run(h, regenTicks, { w: true });
    step(h, frame({ w: true, tap: true }));
    expect(h.sim.state.sprinting).toBe(true);
  });

  it('never leaves 0..max', async () => {
    const h = await makeSim();
    run(h, 60, { w: true });
    expect(h.sim.state.stamina).toBe(cfg.stamina.max);
    step(h, frame({ w: true, tap: true }));
    run(h, 400, { w: true }); // far past empty
    expect(h.sim.state.stamina).toBeGreaterThanOrEqual(0);
  });
});
