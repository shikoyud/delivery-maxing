import { ridingConfig, vehiclesConfig } from '../config';
import type { RideSpec, RidingConfig, VehiclesConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { vec3 } from '../math/vec3';
import { facing } from '../movement/ground';
import type { VehicleState } from './types';

/** WASD alone drives a ride; the mouse (look) never steers it (Decision 7). */
export interface DriveInput {
  /** W positive, S negative (-1..1). */
  throttle: number;
  /** A positive (turns left, like yaw), D negative (-1..1). */
  steer: number;
  handbrake: boolean;
}

/** Drive input of one frame: W/S throttle, A/D steer, Space (jump) the handbrake. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Task 4: Space is the handbrake only where spec.jumpHeight is null
export function driveInput(input: InputFrame, spec: RideSpec): DriveInput {
  return { throttle: input.move.y, steer: -input.move.x, handbrake: input.jump.held };
}

/** The tier's spec top speed; the empty-tank crawl speed when a tank exists and is empty. */
export function vehicleTopSpeed(
  v: VehicleState,
  cfg: { vehicles: VehiclesConfig; riding: RidingConfig } = { vehicles: vehiclesConfig, riding: ridingConfig },
): number {
  const top = cfg.vehicles[v.tier].topSpeed;
  if (cfg.riding.rides[v.tier].fuel !== null && v.fuel <= 0) return Math.min(top, cfg.riding.riding.emptyTankSpeed);
  return top;
}

const approach = (value: number, target: number, maxDelta: number): number =>
  value < target ? Math.min(target, value + maxDelta) : Math.max(target, value - maxDelta);

/**
 * Grounded arcade drive of one ride. Rolls along the heading at a signed speed; sideways velocity decays at the
 * grip. Mutates the horizontal velocity only (vertical velocity is untouched); it does not turn `v.heading`: it
 * returns the heading change this step asks for (steer × the speed-dependent turn rate × dt, mirrored while
 * reversing so A swings the nose right, as in a real car; 0 without steer), and the caller turns the collider
 * (which may refuse) before the next step. A/D turn a stopped ride on the spot.
 *
 * W accelerates along the heading; S brakes above stoppedSpeed and at or below it reverses toward the ride's
 * reverseSpeed (a ride without one only stops). Speed is driven toward topSpeed (above it, it coasts down at
 * coastDecel: an empty tank slows gradually); |speed| never exceeds the tier's spec cap (`capSpeed`,
 * vehicles.json topSpeed), slopes included.
 */
export function applyDrive(
  v: VehicleState,
  d: DriveInput,
  spec: RideSpec,
  topSpeed: number,
  gravity: number,
  dt: number,
  stoppedSpeed: number = ridingConfig.riding.stoppedSpeed,
  capSpeed: number = vehiclesConfig[v.tier].topSpeed,
): number {
  const h0 = facing(v.heading);
  let s = v.velocity.x * h0.x + v.velocity.z * h0.z;
  const braking = d.throttle < 0 && s > stoppedSpeed;
  const reversing = d.throttle < 0 && !braking && spec.reverseSpeed > 0;

  let delta = 0;
  if (d.steer !== 0) {
    const t = Math.max(0, Math.min(1, topSpeed > 0 ? Math.abs(s) / topSpeed : 0));
    const rate = spec.turnRateLow + (spec.turnRateHigh - spec.turnRateLow) * t;
    delta = d.steer * rate * dt * (s < -stoppedSpeed ? -1 : 1);
  }
  // The speed maths rolls along the heading this step asks for (as if the turn is granted); the caller's turn may
  // be refused, and the sideways velocity that leaves then slides the vehicle off the obstacle as before.
  const h = facing(v.heading + delta);
  s = v.velocity.x * h.x + v.velocity.z * h.z;

  // Sideways velocity (relative to the new heading) decays toward 0 at the grip.
  let sx = v.velocity.x - h.x * s;
  let sz = v.velocity.z - h.z * s;
  const sideLen = Math.hypot(sx, sz);
  if (sideLen > 0) {
    const k = Math.max(0, sideLen - (d.handbrake ? spec.handbrakeGrip : spec.grip) * dt) / sideLen;
    sx *= k;
    sz *= k;
  }

  // Slope: in-plane gravity g·sinθ points along the horizontal part of the ground normal.
  const n = v.groundNormal;
  const sinTheta = Math.hypot(n.x, n.z);
  if (sinTheta > 0) s += gravity * sinTheta * spec.slopeGravityScale * ((n.x * h.x + n.z * h.z) / sinTheta) * dt;

  const amount = Math.min(1, Math.abs(d.throttle));
  if (d.handbrake) s = approach(s, 0, spec.handbrakeDecel * dt);
  else if (reversing) s = approach(s, -Math.min(spec.reverseSpeed, topSpeed), spec.accel * amount * dt);
  else if (d.throttle < 0) s = approach(s, 0, spec.brakeDecel * amount * dt); // braking; a ride without reverse stops
  else if (d.throttle > 0) s = s > topSpeed ? approach(s, topSpeed, spec.coastDecel * dt) : Math.min(topSpeed, s + spec.accel * amount * dt);
  else s = approach(s, 0, spec.coastDecel * dt);

  const cap = Math.max(topSpeed, capSpeed);
  s = Math.max(-cap, Math.min(cap, s));
  v.velocity = vec3(h.x * s + sx, v.velocity.y, h.z * s + sz);
  return delta;
}
