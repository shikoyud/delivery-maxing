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
});
