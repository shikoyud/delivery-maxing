import { describe, expect, it } from 'vitest';
import type { MoveMode, PlayerState, Vec3 } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { animFor, easeYaw, wallSide } from '../src/render/courier/animState';

const cfg = clientConfig.courier;

/** A partial PlayerState: just the fields animFor reads. */
function state(over: Partial<{ mode: MoveMode; onBoard: boolean; crouched: boolean; vy: number; heading: number; normal: Vec3 | null }> = {}): PlayerState {
  return {
    mode: over.mode ?? 'ground',
    onBoard: over.onBoard ?? false,
    crouched: over.crouched ?? false,
    grounded: (over.mode ?? 'ground') === 'ground',
    velocity: { x: 0, y: over.vy ?? 0, z: 0 },
    heading: over.heading ?? 0,
    wallRun: { time: 0.2, normal: over.normal ?? null, lastNormal: null },
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
