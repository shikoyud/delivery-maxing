import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import type { PlayerState, StatModifiers } from './types';

/** Take-off speed for a jump of `jump.height · jumpHeightMul` under gravity `g`. */
export function jumpVelocity(cfg: MovementConfig, mods: StatModifiers): number {
  return Math.sqrt(2 * cfg.gravity * cfg.jump.height * mods.jumpHeightMul);
}

/** Coyote window in ticks (3 at 30 Hz). Read from cfg every call so tuning edits apply next tick. */
export const coyoteTicks = (cfg: MovementConfig): number => Math.round(cfg.jump.coyoteTime * cfg.tickRate);
/** Jump-buffer window in ticks (3 at 30 Hz). */
export const bufferTicks = (cfg: MovementConfig): number => Math.round(cfg.jump.bufferTime * cfg.tickRate);

/** Start-of-step timer: a press sets jumpPressAge to 0; otherwise it ages and expires past the buffer window. */
export function ageJumpBuffer(state: PlayerState, input: InputFrame, cfg: MovementConfig): void {
  if (input.jump.pressed) state.jumpPressAge = 0;
  else if (state.jumpPressAge !== null) state.jumpPressAge += 1;
  if (state.jumpPressAge !== null && state.jumpPressAge > bufferTicks(cfg)) state.jumpPressAge = null;
}

/** True when a jump press is buffered (age ≤ bufferTicks). */
export function jumpBuffered(state: PlayerState, cfg: MovementConfig): boolean {
  return state.jumpPressAge !== null && state.jumpPressAge <= bufferTicks(cfg);
}

/**
 * Jumps when a press is buffered (age ≤ bufferTicks) and the player is grounded or within coyote time
 * (airTicks ≤ coyoteTicks). Consumes the press and pushes airTicks past the coyote window.
 * Run ageJumpBuffer first in the same step.
 */
export function tryJump(state: PlayerState, input: InputFrame, cfg: MovementConfig, mods: StatModifiers, dt: number): boolean {
  void dt; // part of the shared movement-function signature; windows are counted in ticks
  if (!jumpBuffered(state, cfg)) return false;
  if (!state.grounded && state.airTicks > coyoteTicks(cfg)) return false;
  state.velocity = { ...state.velocity, y: jumpVelocity(cfg, mods) };
  state.jumpPressAge = null;
  state.airTicks = coyoteTicks(cfg) + 1;
  state.grounded = false;
  state.mode = 'air';
  state.airApexY = state.position.y;
  return true;
}
