import { describe, expect, it } from 'vitest';
import { clientConfig } from '../src/clientConfig';
import { easeToward, fovForSpeed } from '../src/render/cameraRig';

const cam = clientConfig.camera;

describe('cameraRig', () => {
  it('fovForSpeed: 80 at ≤ 8 m/s, 96 at ≥ 18 m/s, linear in between', () => {
    expect(fovForSpeed(0, cam)).toBe(80);
    expect(fovForSpeed(8, cam)).toBe(80);
    expect(fovForSpeed(13, cam)).toBeCloseTo(88, 9);
    expect(fovForSpeed(18, cam)).toBe(96);
    expect(fovForSpeed(40, cam)).toBe(96);
  });


  it('easeToward moves a fraction of the gap per second and never overshoots', () => {
    expect(easeToward(0, 10, 0, 8)).toBe(0);
    const a = easeToward(0, 10, 0.05, 8);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(10);
    expect(easeToward(0, 10, 100, 8)).toBeCloseTo(10, 6);
  });
});
