import { describe, expect, it } from 'vitest';
import { movementConfig } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';

describe('clientConfig', () => {
  it('water sits below the ground top and above the out-of-bounds height', () => {
    expect(clientConfig.graphics.waterLevel).toBeLessThan(0);
    expect(clientConfig.graphics.waterLevel).toBeGreaterThan(movementConfig.fall.outOfBoundsY);
  });

  it('camera far plane reaches past the fog end', () => {
    expect(clientConfig.camera.near).toBeGreaterThan(0);
    expect(clientConfig.camera.far).toBeGreaterThan(clientConfig.graphics.fogFar);
  });

  it('the camera collision ball covers the near plane at fovMax up to a 21:9 screen (no seeing through walls)', () => {
    const { near, fovMax, chase } = clientConfig.camera;
    const halfH = near * Math.tan(((fovMax / 2) * Math.PI) / 180);
    const halfW = halfH * (21 / 9);
    // Distance from the camera to a near-plane corner.
    expect(chase.collisionRadius).toBeGreaterThanOrEqual(Math.hypot(near, halfH, halfW));
  });

  it('chase camera: pivots inside the courier, look-at above the pivot, minDistance clear of the ball', () => {
    const c = clientConfig.camera.chase;
    expect(c.crouchPivotHeight).toBeLessThan(c.pivotHeight);
    expect(c.lookAtHeight).toBeGreaterThan(c.pivotHeight);
    expect(c.minDistance).toBeGreaterThan(c.collisionRadius);
    expect(c.pitchMinDeg).toBeLessThan(0);
    expect(c.pitchMaxDeg).toBeGreaterThan(0);
  });

  it('city LOD rings are three increasing radii, the last one at the fog end', () => {
    const r = clientConfig.city.lodRadii;
    expect(r).toHaveLength(3);
    expect(r[0]!).toBeGreaterThan(0);
    expect(r[1]!).toBeGreaterThan(r[0]!);
    expect(r[2]!).toBeGreaterThan(r[1]!);
    expect(r[2]!).toBeLessThanOrEqual(clientConfig.graphics.fogFar);
  });

  it('perf route viewpoints lie on the 2 km map and cover all four quadrants', () => {
    const route = clientConfig.perf.route;
    expect(route.length).toBeGreaterThanOrEqual(8);
    for (const { feet } of route) {
      expect(Math.abs(feet.x)).toBeLessThanOrEqual(960);
      expect(Math.abs(feet.z)).toBeLessThanOrEqual(960);
    }
    const quadrants = new Set(route.filter((v) => Math.hypot(v.feet.x, v.feet.z) > 100).map((v) => `${Math.sign(v.feet.x)},${Math.sign(v.feet.z)}`));
    expect(quadrants.size).toBe(4);
  });
});
