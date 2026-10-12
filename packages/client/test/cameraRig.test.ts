import { describe, expect, it } from 'vitest';
import type { PlayerState } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { eyeHeight, fovForSpeed } from '../src/render/cameraRig';

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
});
