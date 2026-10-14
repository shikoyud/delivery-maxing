import { ridingConfig, vehiclesConfig } from '../config';
import type { RideSpec, RidingConfig, VehiclesConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { vec3, type Vec3 } from '../math/vec3';
import { facing, hasMoveInput, wishDirection, yawOf } from '../movement/ground';
import type { VehicleState } from './types';

/** Input whose direction has a dot product with the heading below this points back. */
const BACK_DOT = -0.5;

export interface DriveInput {
  wish: Vec3;
  magnitude: number;
  hasInput: boolean;
  handbrake: boolean;
}

/** Drive input of one frame; Space (jump) is the handbrake. */
export function driveInput(input: InputFrame): DriveInput {
  return {
    wish: wishDirection(input),
    magnitude: Math.min(1, Math.hypot(input.move.x, input.move.y)),
    hasInput: hasMoveInput(input),
    handbrake: input.jump.held,
  };
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

function wrapAngle(a: number): number {
  const twoPi = 2 * Math.PI;
  const w = a - twoPi * Math.floor((a + Math.PI) / twoPi);
  return w === -Math.PI ? Math.PI : w;
}

const approach = (value: number, target: number, maxDelta: number): number =>
  value < target ? Math.min(target, value + maxDelta) : Math.max(target, value - maxDelta);

/**
 * Grounded arcade drive of one ride. Rolls along the heading at a signed speed; sideways velocity decays at the
 * grip. Mutates the heading and the horizontal velocity only (vertical velocity is untouched). |speed| never
 * exceeds topSpeed, slopes included.
 */
export function applyDrive(
  v: VehicleState,
  d: DriveInput,
  spec: RideSpec,
  topSpeed: number,
  gravity: number,
  dt: number,
  stoppedSpeed: number = ridingConfig.riding.stoppedSpeed,
): void {
  const h0 = facing(v.heading);
  let s = v.velocity.x * h0.x + v.velocity.z * h0.z;
  const back = d.hasInput && d.wish.x * h0.x + d.wish.z * h0.z < BACK_DOT;
  const braking = back && s > stoppedSpeed;
  const reversing = back && !braking && spec.reverseSpeed > 0;

  if (d.hasInput && !braking && !reversing) {
    const t = Math.max(0, Math.min(1, topSpeed > 0 ? Math.abs(s) / topSpeed : 0));
    const rate = spec.turnRateLow + (spec.turnRateHigh - spec.turnRateLow) * t;
    const maxTurn = rate * dt;
    const turn = wrapAngle(yawOf(d.wish) - v.heading);
    v.heading = wrapAngle(v.heading + Math.max(-maxTurn, Math.min(maxTurn, turn)));
  }
  const h = facing(v.heading);
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

  if (d.handbrake) s = approach(s, 0, spec.handbrakeDecel * dt);
  else if (braking) s = approach(s, 0, spec.brakeDecel * d.magnitude * dt);
  else if (reversing) s = approach(s, -spec.reverseSpeed, spec.accel * d.magnitude * dt);
  else if (back) s = approach(s, 0, spec.coastDecel * dt); // turning around in place
  else if (d.hasInput) s = s > topSpeed ? approach(s, topSpeed, spec.coastDecel * dt) : Math.min(topSpeed, s + spec.accel * d.magnitude * dt);
  else s = approach(s, 0, spec.coastDecel * dt);

  s = Math.max(-topSpeed, Math.min(topSpeed, s));
  v.velocity = vec3(h.x * s + sx, v.velocity.y, h.z * s + sz);
}
