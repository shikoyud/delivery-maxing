import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { vec3 } from '../../src/math/vec3';
import { box, makeSim, type Hold } from '../helpers/simHarness';

const seconds = (t: number) => Math.round(t * cfg.tickRate);
/** Yaw facing +X (camera yaw 0, strafe right). */
const PLUS_X = -Math.PI / 2;
const RIGHT: Hold = { strafe: 1 };
const RIGHT_SPRINT: Hold = { strafe: 1, sprint: true };

describe('courier heading', () => {
  it('heading follows the camera-relative wish direction and holds when input stops', async () => {
    const h = await makeSim();
    expect(h.sim.state.heading).toBe(0); // the spawn yaw
    h.tick(RIGHT);
    expect(h.sim.state.yaw).toBe(0); // the camera did not turn
    expect(h.sim.state.heading).toBeCloseTo(PLUS_X, 9);
    h.run(5, {});
    expect(h.sim.state.heading).toBeCloseTo(PLUS_X, 9);
    // The camera turning on its own does not turn the courier.
    h.run(5, { yaw: 1 });
    expect(h.sim.state.heading).toBeCloseTo(PLUS_X, 9);
    // W with the camera at yaw 1 faces yaw 1.
    h.tick({ forward: 1, yaw: 1 });
    expect(h.sim.state.heading).toBeCloseTo(1, 9);
    // Teleport keeps the heading.
    h.sim.teleport(vec3(0, 1, 0));
    expect(h.sim.state.heading).toBeCloseTo(1, 9);
  });

  it('strafing right into a 1.2 m ledge mantles it (Review Focus 2)', async () => {
    const FACE_X = 3;
    const DEPTH = 10;
    const ledge = box('ledge', vec3(FACE_X + DEPTH / 2, 0.6, 0), vec3(DEPTH, 1.2, 8));
    const h = await makeSim({ solids: [ledge] });
    h.runUntil((s) => s.mode === 'mantle', 60, RIGHT_SPRINT);
    h.runUntil((s) => s.mode !== 'mantle', seconds(cfg.mantle.duration + 0.2), RIGHT_SPRINT);
    const s = h.sim.state;
    expect(s.mode).toBe('ground');
    expect(s.position.y).toBeGreaterThanOrEqual(1.15);
    expect(s.position.y).toBeLessThanOrEqual(1.25);
    expect(s.position.x).toBeGreaterThan(FACE_X);
  });
});

