import { describe, expect, it } from 'vitest';
import type { PlayerState } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { eyeHeight, easeToward, fovForSpeed, rollForWallRun } from '../src/render/cameraRig';

const cam = clientConfig.camera;

describe('cameraRig', () => {
  it('fovForSpeed: 80 at ≤ 8 m/s, 96 at ≥ 18 m/s, linear in between', () => {
    expect(fovForSpeed(0, cam)).toBe(80);
    expect(fovForSpeed(8, cam)).toBe(80);
    expect(fovForSpeed(13, cam)).toBeCloseTo(88, 9);
    expect(fovForSpeed(18, cam)).toBe(96);
    expect(fovForSpeed(40, cam)).toBe(96);
  });

  it('eyeHeight is 1.0 when crouched or sliding and 1.6 otherwise', () => {
    const s = (p: Partial<PlayerState>): PlayerState => ({ mode: 'ground', crouched: false, ...p }) as PlayerState;
    expect(eyeHeight(s({}), cam)).toBe(1.6);
    expect(eyeHeight(s({ mode: 'air' }), cam)).toBe(1.6);
    expect(eyeHeight(s({ crouched: true }), cam)).toBe(1.0);
    expect(eyeHeight(s({ mode: 'slide' }), cam)).toBe(1.0);
  });

  it('rollForWallRun: wall on the right → −8°; wall on the left → +8°; not wall-running → 0', () => {
    // Yaw 0 faces −Z, so the right vector is +X; a wall's normal points from the wall toward the player.
    const s = (mode: string, normal: { x: number; y: number; z: number } | null): PlayerState =>
      ({ mode, yaw: 0, wallRun: { time: 0.2, normal, lastNormal: null } }) as unknown as PlayerState;
    const deg = (r: number): number => (r * 180) / Math.PI;
    expect(deg(rollForWallRun(s('wallrun', { x: -1, y: 0, z: 0 }), cam))).toBeCloseTo(-8, 9);
    expect(deg(rollForWallRun(s('wallrun', { x: 1, y: 0, z: 0 }), cam))).toBeCloseTo(8, 9);
    expect(rollForWallRun(s('air', { x: 1, y: 0, z: 0 }), cam)).toBe(0);
    expect(rollForWallRun(s('wallrun', null), cam)).toBe(0);
  });

  it('easeToward moves a fraction of the gap per second and never overshoots', () => {
    expect(easeToward(0, 10, 0, 8)).toBe(0);
    const a = easeToward(0, 10, 0.05, 8);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(10);
    expect(easeToward(0, 10, 100, 8)).toBeCloseTo(10, 6);
  });
});
