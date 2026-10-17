import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { horizontalLength, vec3, type Vec3 } from '../math/vec3';
import type { PlayerState, StatModifiers } from './types';

/** Horizontal forward unit vector for look yaw. Yaw 0 faces -Z and positive yaw turns left. */
export function facing(yaw: number): Vec3 {
  return vec3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

/** Horizontal right unit vector for look yaw (see facing). */
export function rightOf(yaw: number): Vec3 {
  return vec3(Math.cos(yaw), 0, -Math.sin(yaw));
}

/** Yaw (see facing: 0 faces -Z, positive turns left) of a horizontal direction. */
export function yawOf(v: Vec3): number {
  return Math.atan2(-v.x, -v.z);
}

/** True when the move input is non-zero. */
export function hasMoveInput(input: InputFrame): boolean {
  return input.move.x !== 0 || input.move.y !== 0;
}

/** World-space horizontal unit vector (or zero) for the move input, rotated by look yaw. */
export function wishDirection(input: InputFrame): Vec3 {
  const { x: strafe, y: fwd } = input.move;
  const f = facing(input.look.yaw);
  const r = rightOf(input.look.yaw);
  const x = f.x * fwd + r.x * strafe;
  const z = f.z * fwd + r.z * strafe;
  const l = Math.hypot(x, z);
  return l > 1e-9 ? vec3(x / l, 0, z / l) : vec3(0, 0, 0);
}

/**
 * Speed the player is trying to reach on the ground: run or sprint, scaled by stick magnitude and speedMul
 * (sprint also by sprintMul).
 * Crouched (crouch-walk), the target is capped at run.crouchSpeed.
 */
export function targetGroundSpeed(input: InputFrame, state: PlayerState, cfg: MovementConfig, mods: StatModifiers): number {
  const magnitude = Math.min(1, Math.hypot(input.move.x, input.move.y));
  if (magnitude === 0) return 0;
  const base = state.sprinting ? cfg.run.sprintSpeed * mods.sprintMul : cfg.run.runSpeed;
  const target = base * magnitude * mods.speedMul;
  return state.crouched ? Math.min(target, cfg.run.crouchSpeed) : target;
}

/** Moves the horizontal vector (x, z) toward (tx, tz) by at most maxDelta. */
function moveToward(x: number, z: number, tx: number, tz: number, maxDelta: number): [number, number] {
  const dx = tx - x;
  const dz = tz - z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d === 0) return [tx, tz];
  return [x + (dx / d) * maxDelta, z + (dz / d) * maxDelta];
}

const isZero = (v: Vec3) => v.x === 0 && v.z === 0;

/**
 * Ground acceleration (controller ruling R1):
 * - no input: decelerate toward 0 at groundDecel;
 * - input with speed above target while heading the same way: keep momentum, losing at most
 *   overspeedDecay·dt per tick, while steering toward the wish direction;
 * - otherwise: accelerate toward wish·target at groundAccel.
 */
export function applyGroundVelocity(state: PlayerState, wish: Vec3, target: number, cfg: MovementConfig, dt: number): void {
  const v = state.velocity;
  const speed = horizontalLength(v);
  let x: number;
  let z: number;
  if (isZero(wish) || target <= 0) {
    [x, z] = moveToward(v.x, v.z, 0, 0, cfg.run.groundDecel * dt);
  } else if (speed > target && v.x * wish.x + v.z * wish.z > 0) {
    const newSpeed = Math.max(target, speed - cfg.run.overspeedDecay * dt);
    const sx = v.x + wish.x * cfg.run.groundAccel * dt;
    const sz = v.z + wish.z * cfg.run.groundAccel * dt;
    const l = Math.hypot(sx, sz);
    x = (sx / l) * newSpeed;
    z = (sz / l) * newSpeed;
  } else {
    [x, z] = moveToward(v.x, v.z, wish.x * target, wish.z * target, cfg.run.groundAccel * dt);
  }
  state.velocity = vec3(x, v.y, z);
}

/**
 * Quake-style air control (ruling R13): accelerate only along the wish direction, and only while v·wish < target
 * (addspeed = target − v·wish, at most airAccel·dt). Velocity is never steered toward wish·target, so perpendicular
 * momentum survives. The horizontal speed is then clamped to max(speed before, target).
 */
export function applyAirVelocity(state: PlayerState, wish: Vec3, target: number, cfg: MovementConfig, dt: number): void {
  if (isZero(wish)) return;
  const v = state.velocity;
  const before = horizontalLength(v);
  const addSpeed = Math.min(target - (v.x * wish.x + v.z * wish.z), cfg.run.airAccel * dt);
  if (addSpeed <= 0) return;
  let x = v.x + wish.x * addSpeed;
  let z = v.z + wish.z * addSpeed;
  const limit = Math.max(before, target);
  const l = Math.hypot(x, z);
  if (l > limit) {
    x = (x / l) * limit;
    z = (z / l) * limit;
  }
  state.velocity = vec3(x, v.y, z);
}

/** Wraps an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  const twoPi = 2 * Math.PI;
  const w = a - twoPi * Math.floor((a + Math.PI) / twoPi);
  return w === -Math.PI ? Math.PI : w;
}
