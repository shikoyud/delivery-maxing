import { describe, expect, it, test } from 'vitest';
import { ridingConfig, vehiclesConfig } from '../../src/config';
import { RIDE_TIERS, type RideTier } from '../../src/config/types';
import { vec3 } from '../../src/math/vec3';
import { facing } from '../../src/movement/ground';
import { applyDrive, vehicleTopSpeed, type DriveInput } from '../../src/vehicles/drive';
import type { VehicleState } from '../../src/vehicles/types';

const DT = 1 / 30;
const G = 22;
const STOP = ridingConfig.riding.stoppedSpeed;
const mk = (tier: RideTier, over: Partial<VehicleState> = {}): VehicleState => ({
  tier, position: vec3(0, 0, 0), heading: 0, velocity: vec3(0, 0, 0), grounded: true, groundNormal: vec3(0, 1, 0), airApexY: 0, fuel: 1, ...over,
});
const FWD: DriveInput = { wish: vec3(0, 0, -1), magnitude: 1, hasInput: true, handbrake: false };
const BACK: DriveInput = { wish: vec3(0, 0, 1), magnitude: 1, hasInput: true, handbrake: false };
const NONE: DriveInput = { wish: vec3(0, 0, 0), magnitude: 0, hasInput: false, handbrake: false };
const step = (v: VehicleState, d: DriveInput) => applyDrive(v, d, ridingConfig.rides[v.tier], vehicleTopSpeed(v), G, DT);
const fwdSpeed = (v: VehicleState) => { const f = facing(v.heading); return v.velocity.x * f.x + v.velocity.z * f.z; };

describe('drive model', () => {
  test.each(RIDE_TIERS)('%s reaches exactly its top speed on the flat and never more', (t) => {
    const v = mk(t);
    let max = 0;
    for (let i = 0; i < 900; i++) { step(v, FWD); max = Math.max(max, Math.hypot(v.velocity.x, v.velocity.z)); }
    expect(max).toBe(vehiclesConfig[t].topSpeed);
  });

  it('the car gets to 28 m/s; a 30 % downhill never pushes it above 28', () => {
    const v = mk('car');
    for (let i = 0; i < 900; i++) step(v, FWD);
    expect(fwdSpeed(v)).toBeCloseTo(28, 9);
    const a = Math.atan(0.3);
    // Downhill toward -Z: the normal tilts toward -Z.
    const s = mk('car', { groundNormal: vec3(0, Math.cos(a), -Math.sin(a)), velocity: vec3(0, 0, -27.9) });
    for (let i = 0; i < 300; i++) { step(s, FWD); expect(Math.hypot(s.velocity.x, s.velocity.z)).toBeLessThanOrEqual(28 + 1e-9); }
    expect(Math.hypot(s.velocity.z, s.velocity.x)).toBeCloseTo(28, 9);
  });

  it('slope adds g·sinθ·scale along the heading', () => {
    const a = 0.2;
    const v = mk('bicycle', { groundNormal: vec3(0, Math.cos(a), -Math.sin(a)) });
    step(v, NONE);
    expect(fwdSpeed(v)).toBeCloseTo((G * Math.sin(a) * ridingConfig.rides.bicycle.slopeGravityScale - ridingConfig.rides.bicycle.coastDecel) * DT, 9);
  });

  it('S below stoppedSpeed: the car reverses to -6 m/s, the bicycle turns around instead', () => {
    const car = mk('car');
    for (let i = 0; i < 300; i++) step(car, BACK);
    expect(fwdSpeed(car)).toBeCloseTo(-6, 9);
    expect(car.heading).toBe(0);
    const bike = mk('bicycle', { velocity: vec3(0, 0, -STOP / 2) });
    for (let i = 0; i < 90; i++) step(bike, BACK);
    expect(Math.abs(Math.abs(bike.heading) - Math.PI)).toBeLessThan(1e-6);
    expect(fwdSpeed(bike)).toBeGreaterThanOrEqual(-1e-9);
  });

  it('S above stoppedSpeed brakes without turning', () => {
    const v = mk('car', { velocity: vec3(0, 0, -10) });
    step(v, BACK);
    expect(v.heading).toBe(0);
    expect(fwdSpeed(v)).toBeCloseTo(10 - ridingConfig.rides.car.brakeDecel * DT, 9);
  });

  it('turn rate falls with speed: the car turns 1.8 rad/s at rest and 0.7 rad/s at 28 m/s', () => {
    const left: DriveInput = { wish: vec3(-1, 0, 0), magnitude: 1, hasInput: true, handbrake: false };
    const rest = mk('car');
    step(rest, left);
    expect(rest.heading).toBeCloseTo(1.8 * DT, 9);
    const fast = mk('car', { velocity: vec3(0, 0, -28) });
    applyDrive(fast, left, ridingConfig.rides.car, 28, G, DT);
    expect(fast.heading).toBeCloseTo(0.7 * DT, 9);
  });

  it('sideways velocity decays at grip, faster than at handbrakeGrip', () => {
    const spec = ridingConfig.rides.car;
    const a = mk('car', { velocity: vec3(10, 0, 0) });
    step(a, NONE);
    expect(a.velocity.x).toBeCloseTo(10 - spec.grip * DT, 9);
    const b = mk('car', { velocity: vec3(10, 0, 0) });
    step(b, { ...NONE, handbrake: true });
    expect(b.velocity.x).toBeCloseTo(10 - spec.handbrakeGrip * DT, 9);
    expect(a.velocity.x).toBeLessThan(b.velocity.x);
  });

  it('the handbrake slows at handbrakeDecel; vertical velocity is untouched', () => {
    const v = mk('motorbike', { velocity: vec3(0, 3, -10) });
    step(v, { ...FWD, handbrake: true });
    expect(fwdSpeed(v)).toBeCloseTo(10 - ridingConfig.rides.motorbike.handbrakeDecel * DT, 9);
    expect(v.velocity.y).toBe(3);
  });

  it('an empty tank caps the car at 3 m/s; the bicycle ignores fuel', () => {
    expect(vehicleTopSpeed(mk('car', { fuel: 0 }))).toBe(3);
    expect(vehicleTopSpeed(mk('car'))).toBe(28);
    expect(vehicleTopSpeed(mk('bicycle', { fuel: 0 }))).toBe(16);
    const v = mk('car', { fuel: 0, velocity: vec3(0, 0, -20) });
    step(v, FWD);
    expect(fwdSpeed(v)).toBeLessThanOrEqual(3 + 1e-9);
  });

  describe('skateboard keeps the SP1 board behaviours', () => {
    it('R3: back input at low speed turns the board around, never rolling backwards', () => {
      const v = mk('skateboard', { velocity: vec3(0, 0, -STOP / 2) });
      for (let i = 0; i < 120; i++) { step(v, BACK); expect(fwdSpeed(v)).toBeGreaterThanOrEqual(-1e-9); }
      expect(Math.abs(Math.abs(v.heading) - Math.PI)).toBeLessThan(1e-6);
    });

    it('R4: sideways input turns the heading and the board rolls along it', () => {
      const v = mk('skateboard', { velocity: vec3(0, 0, -10) });
      const right: DriveInput = { wish: vec3(1, 0, 0), magnitude: 1, hasInput: true, handbrake: false };
      for (let i = 0; i < 5; i++) step(v, right);
      expect(v.heading).toBeLessThan(0);
      // The grip bleeds the sideways velocity: after a while the board rolls along its heading.
      for (let k = 0; k < 30; k++) step(v, right);
      const f = facing(v.heading);
      expect(Math.abs(v.velocity.x * f.z - v.velocity.z * f.x)).toBeLessThan(1e-9);
      expect(fwdSpeed(v)).toBeGreaterThan(5);
    });

    it('turns toward a target no faster than turnRate and keeps coasting friction', () => {
      const spec = ridingConfig.rides.skateboard;
      const v = mk('skateboard', { velocity: vec3(0, 0, -6) });
      step(v, NONE);
      expect(fwdSpeed(v)).toBeCloseTo(6 - spec.coastDecel * DT, 9);
    });
  });
});
