import { describe, expect, it } from 'vitest';
import { movementConfig, RIDE_TIERS } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';

describe('clientConfig', () => {
  it('city LOD radii; the fog ends at the outermost ring; budgets', () => {
    // Invariants only, so a config-only retune (the owner's ?perf=1 run) needs no test edit. LOD0 ≤ 160 m and
    // LOD1 ≤ 370 m are the spec's limits; the shipped radii sit below them to fit the budgets with the pack models.
    const [lod0, lod1, lod2] = clientConfig.city.lodRadii as [number, number, number];
    expect(clientConfig.city.lodRadii).toHaveLength(3);
    expect(lod0).toBeGreaterThan(0);
    expect(lod1).toBeGreaterThan(lod0);
    expect(lod2).toBeGreaterThan(lod1);
    expect(lod0).toBeLessThanOrEqual(160);
    expect(lod1).toBeLessThanOrEqual(370);
    expect(clientConfig.graphics.fogFar).toBe(lod2);
    // models are requested before their lots enter the LOD1 ring
    expect(clientConfig.city.loadAheadRadius).toBeGreaterThan(lod1);
    expect(clientConfig.city.relodDistance).toBeGreaterThan(0);
    expect(clientConfig.city.renderRegion).toBeGreaterThan(0);
    expect(clientConfig.city.labelRadius).toBeGreaterThan(0);
    expect(clientConfig.city.modelsBase).toBe('packs/');
    const { ratio, error, minDrop } = clientConfig.city.lod1;
    for (const v of [ratio, error, minDrop]) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
    expect(clientConfig.city.lod1Fallback).toBe('box');
    expect(clientConfig.graphics.drawCallBudget).toBeGreaterThan(0);
    expect(clientConfig.graphics.triangleBudget).toBeGreaterThan(0);
  });

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

  it('ui: route drift and the low-fuel share come from config (final review 7)', () => {
    expect(clientConfig.ui.routeDriftMeters).toBeGreaterThan(0);
    expect(clientConfig.ui.fuelLowPct).toBeGreaterThan(0);
    expect(clientConfig.ui.fuelLowPct).toBeLessThan(100);
  });

  it('ride camera: recenters after 1.5 s above 2 m/s at rate 3', () => {
    expect(clientConfig.camera.ride).toEqual({ recenterDelay: 1.5, recenterRate: 3, recenterMinSpeed: 2 });
  });
});
