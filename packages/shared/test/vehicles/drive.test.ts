import { describe, expect, it, test } from 'vitest';
import { ridingConfig, vehiclesConfig } from '../../src/config';
import { RIDE_TIERS, type RideTier } from '../../src/config/types';
import { emptyInput, type InputFrame } from '../../src/input/inputFrame';
import { vec3 } from '../../src/math/vec3';
import { facing, wrapAngle } from '../../src/movement/ground';
import { applyDrive, driveInput, vehicleTopSpeed, type DriveInput } from '../../src/vehicles/drive';
import type { VehicleState } from '../../src/vehicles/types';

const DT = 1 / 30;
const G = 22;
const STOP = ridingConfig.riding.stoppedSpeed;
const mk = (tier: RideTier, over: Partial<VehicleState> = {}): VehicleState => ({
  tier, position: vec3(0, 0, 0), heading: 0, velocity: vec3(0, 0, 0), grounded: true, groundNormal: vec3(0, 1, 0), airApexY: 0, fuel: 1, ...over,
});
const FWD: DriveInput = { throttle: 1, steer: 0, handbrake: false };
const BACK: DriveInput = { throttle: -1, steer: 0, handbrake: false };
const NONE: DriveInput = { throttle: 0, steer: 0, handbrake: false };
const LEFT: DriveInput = { throttle: 0, steer: 1, handbrake: false };
/** One drive step with the heading turned the way stepVehicle does in free space (no obstacle). */
const step = (v: VehicleState, d: DriveInput) => {
  v.heading = wrapAngle(v.heading + applyDrive(v, d, ridingConfig.rides[v.tier], vehicleTopSpeed(v), G, DT));
};
/** The same from a raw input frame. */
const stepIn = (v: VehicleState, i: InputFrame) => step(v, driveInput(i, ridingConfig.rides[v.tier]));
const frame = (x: number, y: number, yaw = 0): InputFrame => {
  const i = emptyInput();
  i.move = { x, y };
  i.look = { yaw, pitch: 0 };
  return i;
};
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

  test('W drives along the heading whatever the look yaw (Review Focus 5)', () => {
    const v = mk('car');
    for (let i = 0; i < 60; i++) stepIn(v, frame(0, 1, Math.PI));
    expect(v.heading).toBe(0);
    expect(v.velocity.z).toBeLessThan(-5);
    expect(Math.abs(v.velocity.x)).toBeLessThan(1e-9);
  });

  test('A turns the heading left at turnRateLow when stopped and toward turnRateHigh at top speed', () => {
    const spec = ridingConfig.rides.car;
    const rest = mk('car');
    stepIn(rest, frame(-1, 0));
    expect(rest.heading).toBeCloseTo(spec.turnRateLow * DT, 9);
    const fast = mk('car', { velocity: vec3(0, 0, -28) });
    stepIn(fast, frame(-1, 0));
    expect(Math.abs(fast.heading - spec.turnRateHigh * DT)).toBeLessThan(1e-9);
    expect(applyDrive(mk('car'), NONE, spec, 28, G, DT)).toBe(0);
  });

  test('reversing steers like a car: A swings the nose right', () => {
    const v = mk('car', { velocity: vec3(0, 0, 3) });
    stepIn(v, frame(-1, -1));
    expect(v.heading).toBeLessThan(0);
  });

  test('S brakes first, then reverses to reverseSpeed; the skateboard only stops', () => {
    const car = mk('car', { velocity: vec3(0, 0, -10) });
    let prev = fwdSpeed(car);
    for (let i = 0; i < 300; i++) {
      step(car, BACK);
      const s = fwdSpeed(car);
      expect(s).toBeLessThanOrEqual(prev + 1e-9); // 10 → 0 → -6, never back up
      expect(s).toBeGreaterThanOrEqual(-6 - 1e-9);
      if (prev > STOP) expect(prev - s).toBeCloseTo(Math.min(prev, ridingConfig.rides.car.brakeDecel * DT), 9); // brakes, does not reverse yet
      prev = s;
    }
    expect(fwdSpeed(car)).toBeCloseTo(-6, 9);
    expect(car.heading).toBe(0);
    for (const [tier, reverse] of [['bicycle', -2], ['motorbike', -2.5]] as const) {
      const v = mk(tier, { velocity: vec3(0, 0, -5) });
      for (let i = 0; i < 300; i++) step(v, BACK);
      expect(fwdSpeed(v)).toBeCloseTo(reverse, 9);
    }
    const board = mk('skateboard', { velocity: vec3(0, 0, -5) });
    for (let i = 0; i < 300; i++) { step(board, BACK); expect(fwdSpeed(board)).toBeGreaterThanOrEqual(-1e-9); }
    expect(fwdSpeed(board)).toBeCloseTo(0, 12);
  });

  test('steer scales the turn; A and D are mirror images', () => {
    const spec = ridingConfig.rides.bicycle;
    const half = applyDrive(mk('bicycle'), { ...LEFT, steer: 0.5 }, spec, 16, G, DT);
    expect(half).toBeCloseTo(0.5 * spec.turnRateLow * DT, 9);
    expect(applyDrive(mk('bicycle'), { ...LEFT, steer: -1 }, spec, 16, G, DT)).toBeCloseTo(-spec.turnRateLow * DT, 9);
  });

  test('driveInput: throttle is move.y, steer is -move.x, Space is the handbrake', () => {
    const i = frame(0.5, -0.25, 2);
    i.jump.held = true;
    expect(driveInput(i, ridingConfig.rides.car)).toEqual({ throttle: -0.25, steer: -0.5, handbrake: true });
  });

  it('S above stoppedSpeed brakes without turning', () => {
    const v = mk('car', { velocity: vec3(0, 0, -10) });
    step(v, BACK);
    expect(v.heading).toBe(0);
    expect(fwdSpeed(v)).toBeCloseTo(10 - ridingConfig.rides.car.brakeDecel * DT, 9);
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
    const r = mk('car', { fuel: 0 });
    for (let i = 0; i < 300; i++) step(r, BACK);
    expect(fwdSpeed(r)).toBeCloseTo(-3, 9);
  });

  it('running dry at 28 m/s: speed coasts down at coastDecel (no one-tick drop) and settles at 3 m/s', () => {
    const v = mk('car', { fuel: 0, velocity: vec3(0, 0, -28) });
    const decel = ridingConfig.rides.car.coastDecel;
    step(v, FWD);
    expect(fwdSpeed(v)).toBeCloseTo(28 - decel * DT, 9);
    let prev = fwdSpeed(v);
    for (let i = 0; i < 30 * 30; i++) {
      step(v, FWD);
      const s = fwdSpeed(v);
      expect(s).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - s).toBeLessThanOrEqual(decel * DT + 1e-9);
      expect(s).toBeLessThanOrEqual(28);
      prev = s;
    }
    expect(fwdSpeed(v)).toBeCloseTo(3, 9);
  });

  describe('skateboard keeps the SP1 board behaviours', () => {
    it('R3: S at low speed stops the board, never rolling backwards', () => {
      const v = mk('skateboard', { velocity: vec3(0, 0, -STOP / 2) });
      for (let i = 0; i < 120; i++) { step(v, BACK); expect(fwdSpeed(v)).toBeGreaterThanOrEqual(-1e-9); }
      expect(fwdSpeed(v)).toBeCloseTo(0, 12);
      expect(v.heading).toBe(0);
    });

    it('R4: D turns the heading and the board rolls along it', () => {
      const v = mk('skateboard', { velocity: vec3(0, 0, -10) });
      const right: DriveInput = { throttle: 1, steer: -1, handbrake: false };
      for (let i = 0; i < 5; i++) step(v, right);
      expect(v.heading).toBeLessThan(0);
      // The grip bleeds the sideways velocity: after a while the board rolls along its heading.
      for (let k = 0; k < 30; k++) step(v, right);
      const f = facing(v.heading);
      expect(Math.abs(v.velocity.x * f.z - v.velocity.z * f.x)).toBeLessThan(1e-9);
      expect(fwdSpeed(v)).toBeGreaterThan(5);
    });

    it('keeps coasting friction', () => {
      const spec = ridingConfig.rides.skateboard;
      const v = mk('skateboard', { velocity: vec3(0, 0, -6) });
      step(v, NONE);
      expect(fwdSpeed(v)).toBeCloseTo(6 - spec.coastDecel * DT, 9);
    });
  });
});
