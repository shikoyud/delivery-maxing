import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { emptyInput, type InputFrame } from '../../src/input/inputFrame';
import { horizontalLength } from '../../src/math/vec3';
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
  h.sim.step(input, { speedMul: 1, jumpHeightMul: 1 }, h.world, h.time);
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
    const state = { sprinting: false } as Parameters<typeof updateSprint>[0];
    updateSprint(state, frame({ w: true, tap: true }));
    expect(state.sprinting).toBe(true);
    updateSprint(state, frame({ w: true }));
    expect(state.sprinting).toBe(true);
    updateSprint(state, frame({ tap: true }));
    expect(state.sprinting).toBe(false);
  });
});
