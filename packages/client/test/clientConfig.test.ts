import { describe, expect, it } from 'vitest';
import { movementConfig, RIDE_TIERS } from '@dm/shared';
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

  it('binds phone to Tab, accept to Y and mount to F; no wall-run camera roll', () => {
    const b = clientConfig.input.bindings as Record<string, string[]>;
    expect(b.phone).toEqual(['Tab']);
    expect(b.accept).toEqual(['KeyY']);
    expect(b.mount).toEqual(['KeyF']);
    expect(b.crouch).toEqual(['KeyC']);
    expect(b.interact).toEqual(['KeyE']);
    expect('wallRunRollDeg' in clientConfig.camera).toBe(false);
    expect('rollEaseRate' in clientConfig.camera).toBe(false);
  });

  it('the courier has no parkour poses left', () => {
    for (const p of ['wallrunL', 'wallrunR', 'zip', 'grind']) expect(Object.keys(clientConfig.courier.poses)).not.toContain(p);
  });

  it('vehicle cameras sit further back and higher than on foot, growing with the tier', () => {
    const c = clientConfig.camera.chase;
    const d = RIDE_TIERS.map((t) => c.rides[t].distance);
    expect(d[0]).toBeGreaterThan(c.distance);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    for (const t of RIDE_TIERS) expect(c.rides[t].height).toBeGreaterThan(c.height);
  });
});
