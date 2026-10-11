import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { horizontalLength, vec3, type Vec3 } from '../math/vec3';
import { boostMultiplier, facing } from './ground';
import type { PlayerState, StatModifiers } from './types';

/** Below this horizontal speed (m/s) a velocity has no usable direction: the look yaw is used instead. */
const DIRECTION_EPS = 1e-6;

/** Yaw (see facing: 0 faces -Z, positive turns left) of a horizontal direction. */
const yawOf = (v: Vec3): number => Math.atan2(-v.x, -v.z);

/** Wraps an angle to (-π, π]. */
function wrapAngle(a: number): number {
  const twoPi = 2 * Math.PI;
  const w = a - twoPi * Math.floor((a + Math.PI) / twoPi);
  return w === -Math.PI ? Math.PI : w;
}

/** Points the board along the horizontal velocity, or along the look yaw when (almost) still. */
export function alignBoardHeading(state: PlayerState): void {
  state.boardHeading = horizontalLength(state.velocity) > DIRECTION_EPS ? yawOf(state.velocity) : state.yaw;
}

/**
 * Q: pulls the board out or puts it away. Only works when grounded, in ground mode and not crouched. Pulling it out
 * points the board along the current travel (or the look yaw when still). Returns whether the board was toggled.
 */
export function toggleBoard(state: PlayerState): boolean {
  if (!state.grounded || state.mode !== 'ground' || state.crouched) return false;
  state.onBoard = !state.onBoard;
  if (state.onBoard) alignBoardHeading(state);
  return true;
}

/** Board top speed: topSpeed × speedMul × boost (the global speedCap is applied by the step). */
export function boardTopSpeed(state: PlayerState, cfg: MovementConfig, mods: StatModifiers): number {
  return cfg.board.topSpeed * mods.speedMul * boostMultiplier(state, cfg);
}

/** Moves `value` toward `target` by at most `maxDelta`. */
const approach = (value: number, target: number, maxDelta: number): number =>
  value < target ? Math.min(target, value + maxDelta) : Math.max(target, value - maxDelta);

/**
 * Grounded board locomotion. There is no strafing: the heading turns toward the look yaw at no more than
 * board.turnRate·dt, and the board rolls along it at a signed speed (the velocity's share along the heading, so any
 * sideways velocity is lost to the wheels' grip). Per tick:
 * - on a slope the board gains g·sinθ along the downhill direction's share of the heading;
 * - forward input accelerates at board.accel toward boardTopSpeed (above it, friction slows it back to it);
 * - back input brakes at board.brakeDecel toward 0 (never reversing);
 * - no input: board.friction slows it toward 0.
 * Sprint and crouch are ignored. Vertical velocity is left untouched.
 */
export function applyBoardVelocity(
  state: PlayerState,
  input: InputFrame,
  cfg: MovementConfig,
  mods: StatModifiers,
  dt: number,
): void {
  const b = cfg.board;
  const turn = wrapAngle(state.yaw - state.boardHeading);
  const maxTurn = b.turnRate * dt;
  state.boardHeading = wrapAngle(state.boardHeading + Math.max(-maxTurn, Math.min(maxTurn, turn)));
  const h = facing(state.boardHeading);

  const v = state.velocity;
  let speed = v.x * h.x + v.z * h.z;

  // Slope: the in-plane gravity has magnitude g·sinθ and points along the horizontal part of the ground normal.
  const n = state.groundNormal;
  const sinTheta = Math.hypot(n.x, n.z);
  if (sinTheta > 0) speed += cfg.gravity * sinTheta * ((n.x * h.x + n.z * h.z) / sinTheta) * dt;

  const fwd = input.move.y;
  const top = boardTopSpeed(state, cfg, mods);
  if (fwd > 0) speed = speed > top ? Math.max(top, speed - b.friction * dt) : Math.min(top, speed + b.accel * fwd * dt);
  else if (fwd < 0) speed = approach(speed, 0, b.brakeDecel * -fwd * dt);
  else speed = approach(speed, 0, b.friction * dt);

  state.velocity = vec3(h.x * speed, v.y, h.z * speed);
}
