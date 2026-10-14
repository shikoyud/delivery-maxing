import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { horizontalLength, vec3, type Vec3 } from '../math/vec3';
import { facing, hasMoveInput, yawOf } from './ground';
import type { PlayerState, StatModifiers } from './types';

/** Below this horizontal speed (m/s) a velocity has no usable direction: the courier heading is used instead. */
const DIRECTION_EPS = 1e-6;
/** Input whose direction has a dot product with the board heading below this points back: it brakes (above brakeMinSpeed). */
const BRAKE_DOT = -0.5;

/** Wraps an angle to (-π, π]. */
function wrapAngle(a: number): number {
  const twoPi = 2 * Math.PI;
  const w = a - twoPi * Math.floor((a + Math.PI) / twoPi);
  return w === -Math.PI ? Math.PI : w;
}

/** Points the board (and the courier) along the horizontal velocity, or along the courier heading when (almost) still. */
export function alignBoardHeading(state: PlayerState): void {
  state.boardHeading = horizontalLength(state.velocity) > DIRECTION_EPS ? yawOf(state.velocity) : state.heading;
  state.heading = state.boardHeading;
}

/**
 * Q: pulls the board out or puts it away. Only works when grounded, in ground mode and not crouched. Pulling it out
 * points the board along the current travel (or the courier heading when still). Returns whether the board was toggled.
 */
export function toggleBoard(state: PlayerState): boolean {
  if (!state.grounded || state.mode !== 'ground' || state.crouched) return false;
  state.onBoard = !state.onBoard;
  if (state.onBoard) alignBoardHeading(state);
  return true;
}

/** Board top speed: topSpeed × speedMul (the global speedCap is applied by the step). */
export function boardTopSpeed(cfg: MovementConfig, mods: StatModifiers): number {
  return cfg.board.topSpeed * mods.speedMul;
}

/** Moves `value` toward `target` by at most `maxDelta`. */
const approach = (value: number, target: number, maxDelta: number): number =>
  value < target ? Math.min(target, value + maxDelta) : Math.max(target, value - maxDelta);

/**
 * Grounded board locomotion. There is no strafing: the board rolls along its heading at a signed speed (the
 * velocity's share along the heading, so any sideways velocity is lost to the wheels' grip). Per tick:
 * - back input (the camera-relative wish direction has dot < -0.5 with the heading) above board.brakeMinSpeed along
 *   the heading brakes at board.brakeDecel toward 0 (never reversing) and does not turn;
 * - back input at or below brakeMinSpeed turns the board around: the heading turns toward the wish direction at no
 *   more than board.turnRate·dt and friction slows the board (no acceleration until the input no longer points back)
 *   (R3);
 * - other input, sideways included (R4), turns the heading toward the wish direction at no more than
 *   board.turnRate·dt and accelerates at board.accel toward boardTopSpeed (above it, friction slows it back to it);
 * - no input: board.friction slows it toward 0;
 * - on a slope the board gains g·sinθ along the downhill direction's share of the heading.
 * Brake and acceleration scale with the stick magnitude. Sprint and crouch are ignored. Vertical velocity is left
 * untouched. The courier heading mirrors the board heading.
 */
export function applyBoardVelocity(
  state: PlayerState,
  input: InputFrame,
  wish: Vec3,
  cfg: MovementConfig,
  mods: StatModifiers,
  dt: number,
): void {
  const b = cfg.board;
  const magnitude = Math.min(1, Math.hypot(input.move.x, input.move.y));
  const hasInput = hasMoveInput(input);
  const h0 = facing(state.boardHeading);
  const back = hasInput && wish.x * h0.x + wish.z * h0.z < BRAKE_DOT;
  const braking = back && state.velocity.x * h0.x + state.velocity.z * h0.z > b.brakeMinSpeed;
  if (hasInput && !braking) {
    const turn = wrapAngle(yawOf(wish) - state.boardHeading);
    const maxTurn = b.turnRate * dt;
    state.boardHeading = wrapAngle(state.boardHeading + Math.max(-maxTurn, Math.min(maxTurn, turn)));
  }
  state.heading = state.boardHeading;
  const h = facing(state.boardHeading);

  const v = state.velocity;
  let speed = v.x * h.x + v.z * h.z;

  // Slope: the in-plane gravity has magnitude g·sinθ and points along the horizontal part of the ground normal.
  const n = state.groundNormal;
  const sinTheta = Math.hypot(n.x, n.z);
  if (sinTheta > 0) speed += cfg.gravity * sinTheta * ((n.x * h.x + n.z * h.z) / sinTheta) * dt;

  const top = boardTopSpeed(cfg, mods);
  if (braking) speed = approach(speed, 0, b.brakeDecel * magnitude * dt);
  else if (back) speed = approach(speed, 0, b.friction * dt); // turning around (R3)
  else if (hasInput) speed = speed > top ? Math.max(top, speed - b.friction * dt) : Math.min(top, speed + b.accel * magnitude * dt);
  else speed = approach(speed, 0, b.friction * dt);

  state.velocity = vec3(h.x * speed, v.y, h.z * speed);
}
