import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { horizontalLength, vec3, type Vec3 } from '../math/vec3';
import type { PlayerState, StatModifiers } from './types';

/**
 * World-space horizontal unit vector (or zero) for the move input, rotated by look yaw.
 * Yaw 0 faces -Z and positive yaw turns left, so forward = (-sin, 0, -cos) and right = (cos, 0, -sin).
 */
export function wishDirection(input: InputFrame): Vec3 {
  const { x: strafe, y: fwd } = input.move;
  const s = Math.sin(input.look.yaw);
  const c = Math.cos(input.look.yaw);
  const x = -s * fwd + c * strafe;
  const z = -c * fwd - s * strafe;
  const l = Math.hypot(x, z);
  return l > 1e-9 ? vec3(x / l, 0, z / l) : vec3(0, 0, 0);
}

/** Speed the player is trying to reach on the ground: run or sprint, scaled by stick magnitude and speedMul. */
export function targetGroundSpeed(input: InputFrame, state: PlayerState, cfg: MovementConfig, mods: StatModifiers): number {
  const magnitude = Math.min(1, Math.hypot(input.move.x, input.move.y));
  if (magnitude === 0) return 0;
  const base = input.sprint.held ? cfg.run.sprintSpeed : cfg.run.runSpeed;
  return base * magnitude * mods.speedMul;
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

/** Air control: airAccel steers toward the wish direction but can only raise speed up to max(current, target). */
export function applyAirVelocity(state: PlayerState, wish: Vec3, target: number, cfg: MovementConfig, dt: number): void {
  if (isZero(wish)) return;
  const v = state.velocity;
  const limit = Math.max(horizontalLength(v), target);
  let [x, z] = moveToward(v.x, v.z, wish.x * limit, wish.z * limit, cfg.run.airAccel * dt);
  const l = Math.hypot(x, z);
  if (l > limit) {
    x = (x / l) * limit;
    z = (z / l) * limit;
  }
  state.velocity = vec3(x, v.y, z);
}
