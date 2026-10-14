import { describe, expect, it } from 'vitest';
import type { MoveMode, PlayerState, RideTier, Vec3 } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { animFor, displayYaw, easeYaw } from '../src/render/courier/animState';

const cfg = clientConfig.courier;

/** A partial PlayerState: just the fields animFor reads. */
function state(
  over: Partial<{ mode: MoveMode; riding: RideTier | null; crouched: boolean; vy: number; heading: number; v: Vec3; mantle: { from: Vec3; to: Vec3 } }> = {},
): PlayerState {
  return {
    mode: over.mode ?? 'ground',
    riding: over.riding ?? null,
    crouched: over.crouched ?? false,
    grounded: (over.mode ?? 'ground') === 'ground',
    velocity: over.v ?? { x: 0, y: over.vy ?? 0, z: 0 },
    heading: over.heading ?? 0,
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
  it('poses: slide, mantle, fall (air & vy < −2)', () => {
    expect(animFor(state({ mode: 'slide', crouched: true }), 9, cfg).pose).toBe('slide');
    expect(animFor(state({ mode: 'mantle' }), 2, cfg).pose).toBe('mantle');
    expect(animFor(state({ mode: 'air', vy: -2.5 }), 3, cfg).pose).toBe('fall');
    expect(animFor(state({ mode: 'air', vy: -1.5 }), 3, cfg).pose).toBe('none');
  });

  it('crouched on the ground (not sliding) uses the crouch pose, so the courier fits under the crouch tunnel', () => {
    expect(animFor(state({ crouched: true }), 0, cfg).pose).toBe('crouch');
    expect(animFor(state({ crouched: true }), 2.5, cfg)).toMatchObject({ clip: 'Walking', pose: 'crouch' });
  });

  it('slide holds a still clip under the pose', () => {
    expect(animFor(state({ mode: 'slide', crouched: true }), 10, cfg).clip).toBe('Idle');
  });

  it('precedence: slide over crouch', () => {
    expect(animFor(state({ mode: 'slide', crouched: true }), 8, cfg).pose).toBe('slide');
  });

  it('every pose has a config entry, and no parkour pose is left', () => {
    for (const p of ['slide', 'mantle', 'board', 'bike', 'fall', 'crouch'] as const) {
      expect(cfg.poses[p], p).toBeDefined();
    }
    expect(Object.keys(cfg.poses).sort()).toEqual(['bike', 'board', 'crouch', 'fall', 'mantle', 'slide']);
  });
});

describe('animFor: riding', () => {
  it('animFor: bicycle → bike pose, car → hidden, skateboard → board pose', () => {
    expect(animFor(state({ riding: 'bicycle' }), 10, cfg)).toEqual({ clip: 'Idle', timeScale: 1, pose: 'bike' });
    expect(animFor(state({ riding: 'motorbike' }), 20, cfg).pose).toBe('bike');
    expect(animFor(state({ riding: 'skateboard' }), 8, cfg)).toEqual({ clip: 'Idle', timeScale: 1, pose: 'board' });
    const car = animFor(state({ riding: 'car' }), 20, cfg);
    expect(car.hidden).toBe(true);
    // On foot and on the other rides the courier is drawn.
    expect(animFor(state(), 0, cfg).hidden).toBeFalsy();
    expect(animFor(state({ riding: 'bicycle' }), 0, cfg).hidden).toBeFalsy();
  });

  it('riding through the air keeps the ride pose (no Jump clip or fall pose on a vehicle)', () => {
    expect(animFor(state({ riding: 'bicycle', mode: 'air', vy: -6 }), 10, cfg).pose).toBe('bike');
    expect(animFor(state({ riding: 'skateboard', mode: 'air', vy: 3 }), 10, cfg)).toMatchObject({ clip: 'Idle', pose: 'board' });
  });
});

describe('displayYaw (R14: the courier faces its direction of travel)', () => {
  const HALF_PI = Math.PI / 2;
  /** Travel along +Z (yaw π) at `speed`, with the input (heading) turned 90° to it. */
  const plusZ = (speed: number): Vec3 => ({ x: 0, y: 0, z: speed });

  it('facingMinSpeed is configured (1 m/s)', () => {
    expect(cfg.facingMinSpeed).toBe(1);
  });

  it('a slide faces the horizontal velocity above facingMinSpeed, else the heading', () => {
    expect(Math.abs(displayYaw(state({ mode: 'slide', heading: HALF_PI, v: plusZ(8) }), cfg))).toBeCloseTo(Math.PI, 9);
    expect(displayYaw(state({ mode: 'slide', heading: HALF_PI, v: plusZ(cfg.facingMinSpeed * 0.9) }), cfg)).toBe(HALF_PI);
  });

  it('mantle faces the way the mantle carries the courier (its velocity is zeroed while it climbs)', () => {
    const m = state({ mode: 'mantle', heading: HALF_PI, mantle: { from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 1.5, z: 0.6 } } });
    expect(Math.abs(displayYaw(m, cfg))).toBeCloseTo(Math.PI, 9);
    const straightUp = state({ mode: 'mantle', heading: HALF_PI, mantle: { from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 1.5, z: 0 } } });
    expect(displayYaw(straightUp, cfg)).toBe(HALF_PI);
  });

  it('ground, air and riding keep the heading (the courier turns to its input, or with the vehicle)', () => {
    expect(displayYaw(state({ heading: HALF_PI, v: plusZ(8) }), cfg)).toBe(HALF_PI);
    expect(displayYaw(state({ mode: 'air', heading: HALF_PI, v: plusZ(8) }), cfg)).toBe(HALF_PI);
    expect(displayYaw(state({ riding: 'car', heading: HALF_PI, v: plusZ(8) }), cfg)).toBe(HALF_PI);
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
