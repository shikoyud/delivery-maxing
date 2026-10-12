import { describe, expect, it } from 'vitest';
import type { MoveMode, PlayerState, Vec3 } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { animFor, createDismountEase, displayYaw, easeYaw, stepDismountEase, wallSide } from '../src/render/courier/animState';

const cfg = clientConfig.courier;

/** A partial PlayerState: just the fields animFor reads. */
function state(
  over: Partial<{ mode: MoveMode; onBoard: boolean; crouched: boolean; vy: number; heading: number; normal: Vec3 | null; v: Vec3; mantle: { from: Vec3; to: Vec3 } }> = {},
): PlayerState {
  return {
    mode: over.mode ?? 'ground',
    onBoard: over.onBoard ?? false,
    crouched: over.crouched ?? false,
    grounded: (over.mode ?? 'ground') === 'ground',
    velocity: over.v ?? { x: 0, y: over.vy ?? 0, z: 0 },
    heading: over.heading ?? 0,
    wallRun: { time: 0.2, normal: over.normal ?? null, lastNormal: null },
    mantle: over.mantle ? { ...over.mantle, t: 0.1, horizontalVelocity: { x: 0, y: 0, z: 0 } } : null,
  } as unknown as PlayerState;
}

describe('animFor: locomotion clips', () => {
  it('idle when still, Walking below 4 m/s, Running above, timeScale grows with speed', () => {
    expect(animFor(state(), 0, cfg)).toEqual({ clip: 'Idle', timeScale: 1, pose: 'none' });
    expect(animFor(state(), cfg.idleSpeed / 2, cfg).clip).toBe('Idle');
    expect(cfg.walkMaxSpeed).toBe(4);
    expect(animFor(state(), 2, cfg).clip).toBe('Walking');
    expect(animFor(state(), 3.9, cfg).clip).toBe('Walking');
    const run = animFor(state(), 5.5, cfg);
    const sprint = animFor(state(), 8, cfg);
    const boosted = animFor(state(), 11, cfg);
    expect([run.clip, sprint.clip, boosted.clip]).toEqual(['Running', 'Running', 'Running']);
    expect(sprint.timeScale).toBeCloseTo(8 / cfg.runSpeedForFullRun, 6);
    expect(run.timeScale).toBeLessThan(sprint.timeScale);
    expect(boosted.timeScale).toBeGreaterThan(sprint.timeScale);
    expect(run.pose).toBe('none');
  });

  it('a slow run never plays in slow motion: the Running rate is floored at runMinTimeScale', () => {
    const slow = animFor(state(), cfg.walkMaxSpeed, cfg);
    expect(slow.clip).toBe('Running');
    expect(slow.timeScale).toBe(cfg.runMinTimeScale);
    expect(cfg.runMinTimeScale).toBeGreaterThan(cfg.walkMaxSpeed / cfg.runSpeedForFullRun);
  });

  it('in the air: the Jump clip; falling (vy below −fallSpeed) adds the fall pose', () => {
    expect(animFor(state({ mode: 'air', vy: 4 }), 6, cfg)).toEqual({ clip: 'Jump', timeScale: 1, pose: 'none' });
    expect(animFor(state({ mode: 'air', vy: -1 }), 6, cfg).pose).toBe('none');
    expect(animFor(state({ mode: 'air', vy: -(cfg.fallSpeed + 0.1) }), 6, cfg)).toEqual({ clip: 'Jump', timeScale: 1, pose: 'fall' });
  });
});

describe('animFor: poses', () => {
  it('poses: slide, wallrunL/R from wall side, zip, grind, mantle, board, fall (air & vy < −2)', () => {
    expect(animFor(state({ mode: 'slide', crouched: true }), 9, cfg).pose).toBe('slide');
    // Heading 0 faces −Z, so the right hand is +X. A wall on the left has its normal pointing right (+X).
    expect(animFor(state({ mode: 'wallrun', normal: { x: 1, y: 0, z: 0 } }), 8, cfg).pose).toBe('wallrunL');
    expect(animFor(state({ mode: 'wallrun', normal: { x: -1, y: 0, z: 0 } }), 8, cfg).pose).toBe('wallrunR');
    // Heading π/2 faces −X, so right is −Z: a wall on the +Z side (normal −Z, pointing right) is on the left.
    expect(animFor(state({ mode: 'wallrun', heading: Math.PI / 2, normal: { x: 0, y: 0, z: -1 } }), 8, cfg).pose).toBe('wallrunL');
    expect(animFor(state({ mode: 'zipline' }), 12, cfg).pose).toBe('zip');
    expect(animFor(state({ mode: 'grind' }), 9, cfg).pose).toBe('grind');
    expect(animFor(state({ mode: 'mantle' }), 2, cfg).pose).toBe('mantle');
    expect(animFor(state({ onBoard: true }), 10, cfg).pose).toBe('board');
    expect(animFor(state({ mode: 'air', vy: -2.5 }), 3, cfg).pose).toBe('fall');
    expect(animFor(state({ mode: 'air', vy: -1.5 }), 3, cfg).pose).toBe('none');
  });

  it('crouched on the ground (not sliding) uses the crouch pose, so the courier fits under the crouch tunnel', () => {
    expect(animFor(state({ crouched: true }), 0, cfg).pose).toBe('crouch');
    expect(animFor(state({ crouched: true }), 2.5, cfg)).toMatchObject({ clip: 'Walking', pose: 'crouch' });
  });

  it('wall-run keeps the running legs; slide, zip, board and grind hold a still clip under the pose', () => {
    const wr = animFor(state({ mode: 'wallrun', normal: { x: 1, y: 0, z: 0 } }), 8, cfg);
    expect(wr.clip).toBe('Running');
    expect(wr.timeScale).toBeCloseTo(1, 6);
    for (const s of [state({ mode: 'slide', crouched: true }), state({ mode: 'zipline' }), state({ onBoard: true }), state({ mode: 'grind' })]) {
      expect(animFor(s, 10, cfg).clip).toBe('Idle');
    }
  });

  it('precedence: zip over board, board over grind, slide over crouch', () => {
    expect(animFor(state({ mode: 'zipline', onBoard: true }), 12, cfg).pose).toBe('zip');
    expect(animFor(state({ mode: 'grind', onBoard: true }), 12, cfg).pose).toBe('board');
    expect(animFor(state({ mode: 'air', onBoard: true, vy: -5 }), 8, cfg).pose).toBe('board');
    expect(animFor(state({ mode: 'slide', crouched: true }), 8, cfg).pose).toBe('slide');
  });

  it('every pose has a config entry', () => {
    for (const p of ['slide', 'wallrunL', 'wallrunR', 'zip', 'grind', 'mantle', 'board', 'fall', 'crouch'] as const) {
      expect(cfg.poses[p], p).toBeDefined();
    }
  });
});

describe('wallSide', () => {
  it('left when the wall normal points to the courier’s right, right otherwise', () => {
    expect(wallSide(0, { x: 1, y: 0, z: 0 })).toBe('L');
    expect(wallSide(0, { x: -1, y: 0, z: 0 })).toBe('R');
    expect(wallSide(Math.PI, { x: -1, y: 0, z: 0 })).toBe('L');
  });
});

describe('displayYaw (R14: the courier faces its direction of travel)', () => {
  const HALF_PI = Math.PI / 2;
  /** Travel along +Z (yaw π) at `speed`, with the input (heading) turned 90° to it. */
  const plusZ = (speed: number): Vec3 => ({ x: 0, y: 0, z: speed });

  it('facingMinSpeed is configured (1 m/s)', () => {
    expect(cfg.facingMinSpeed).toBe(1);
  });

  it('on a zip line: the ride direction, whatever the input (W held, camera turned 90°: 3.14, not 1.57)', () => {
    const zip = state({ mode: 'zipline', heading: HALF_PI, v: { x: 0, y: -2, z: 12 } });
    expect(Math.abs(displayYaw(zip, cfg))).toBeCloseTo(Math.PI, 9);
  });

  it('slide, grind and wall-run face the horizontal velocity above facingMinSpeed, else the heading', () => {
    for (const mode of ['slide', 'grind', 'wallrun'] as const) {
      expect(Math.abs(displayYaw(state({ mode, heading: HALF_PI, v: plusZ(8) }), cfg)), mode).toBeCloseTo(Math.PI, 9);
      expect(displayYaw(state({ mode, heading: HALF_PI, v: plusZ(cfg.facingMinSpeed * 0.9) }), cfg), mode).toBe(HALF_PI);
    }
    // Grinding on the board too: the deck lines up with the rail.
    expect(Math.abs(displayYaw(state({ mode: 'grind', onBoard: true, heading: HALF_PI, v: plusZ(10) }), cfg))).toBeCloseTo(Math.PI, 9);
  });

  it('mantle faces the way the mantle carries the courier (its velocity is zeroed while it climbs)', () => {
    const m = state({ mode: 'mantle', heading: HALF_PI, mantle: { from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 1.5, z: 0.6 } } });
    expect(Math.abs(displayYaw(m, cfg))).toBeCloseTo(Math.PI, 9);
    const straightUp = state({ mode: 'mantle', heading: HALF_PI, mantle: { from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 1.5, z: 0 } } });
    expect(displayYaw(straightUp, cfg)).toBe(HALF_PI);
  });

  it('ground and air keep the heading (the courier turns to its input)', () => {
    expect(displayYaw(state({ heading: HALF_PI, v: plusZ(8) }), cfg)).toBe(HALF_PI);
    expect(displayYaw(state({ mode: 'air', heading: HALF_PI, v: plusZ(8) }), cfg)).toBe(HALF_PI);
    expect(displayYaw(state({ onBoard: true, heading: HALF_PI, v: plusZ(8) }), cfg)).toBe(HALF_PI);
  });

  it('the wall-run lean side comes from the travel direction, not the input', () => {
    // Running along −Z (yaw 0, right hand +X) with the input pointing +Z (heading π): a wall whose normal points +X
    // is on the left.
    const wr = state({ mode: 'wallrun', heading: Math.PI, v: { x: 0, y: 0, z: -8 }, normal: { x: 1, y: 0, z: 0 } });
    expect(animFor(wr, 8, cfg).pose).toBe('wallrunL');
  });
});

describe('dismount ease (R16)', () => {
  const rate = cfg.dismountEaseRate;

  it('dismountEaseRate is configured (about a 0.12 s time constant)', () => {
    expect(1 / rate).toBeGreaterThan(0.08);
    expect(1 / rate).toBeLessThan(0.16);
  });

  it('leaving the zip line keeps the courier where it hung and eases it down at dismountEaseRate', () => {
    const e = createDismountEase();
    expect(stepDismountEase(e, 'zipline', 9.2, 0.016, rate, false)).toBe(0);
    expect(stepDismountEase(e, 'zipline', 9.1, 0.016, rate, false)).toBe(0);
    // The dismount tick puts the feet 1.6 m lower, on the platform.
    const first = stepDismountEase(e, 'ground', 7.5, 0.016, rate, false);
    expect(first).toBeCloseTo(1.6 * Math.exp(-rate * 0.016), 9);
    const next = stepDismountEase(e, 'ground', 7.5, 0.1, rate, false);
    expect(next).toBeCloseTo(first * Math.exp(-rate * 0.1), 9);
    expect(stepDismountEase(e, 'ground', 7.5, 2, rate, false)).toBeLessThan(1e-6);
  });

  it('a dismount that jumps on the same tick eases too; a rise onto a higher spot eases up', () => {
    const jumped = createDismountEase();
    stepDismountEase(jumped, 'zipline', 9, 0.016, rate, false);
    expect(stepDismountEase(jumped, 'air', 8, 0, rate, false)).toBeCloseTo(1, 9);
    const rose = createDismountEase();
    stepDismountEase(rose, 'zipline', 6, 0.016, rate, false);
    expect(stepDismountEase(rose, 'ground', 7, 0, rate, false)).toBeCloseTo(-1, 9);
  });

  it('no offset on a snap (teleport, respawn) or in ordinary play', () => {
    const e = createDismountEase();
    stepDismountEase(e, 'zipline', 9, 0.016, rate, false);
    expect(stepDismountEase(e, 'air', 30, 0.016, rate, true)).toBe(0);
    const g = createDismountEase();
    stepDismountEase(g, 'ground', 0, 0.016, rate, false);
    expect(stepDismountEase(g, 'air', 0.4, 0.016, rate, false)).toBe(0);
    expect(stepDismountEase(g, 'ground', -1.5, 0.016, rate, false)).toBe(0);
  });
});

describe('easeYaw', () => {
  it('eases toward the target along the short way round and never overshoots', () => {
    const a = easeYaw(0, 1, 0.05, cfg.turnEaseRate);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
    // From just below π to just above −π: the short way crosses ±π, not through 0.
    const b = easeYaw(3.1, -3.1, 0.05, cfg.turnEaseRate);
    expect(Math.abs(b)).toBeGreaterThan(3.1);
    expect(easeYaw(0.4, 0.4, 0.1, cfg.turnEaseRate)).toBeCloseTo(0.4, 9);
    expect(Math.abs(easeYaw(0, 1, 10, cfg.turnEaseRate) - 1)).toBeLessThan(1e-6);
    expect(easeYaw(0.2, 1, 0, cfg.turnEaseRate)).toBeCloseTo(0.2, 9);
  });
});
