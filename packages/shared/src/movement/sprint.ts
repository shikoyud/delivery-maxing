import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { hasMoveInput } from './ground';
import type { PlayerState, StatModifiers } from './types';

/**
 * Apex-style sprint toggle with stamina. A Shift press flips `state.sprinting`; sprint then switches off on any tick
 * with no move input, so it can only be on while moving (a press with no move key flips on and off in the same tick,
 * staying off). While mods.canSprint is false (a Heavy order) the press is ignored and sprint is forced off.
 *
 * Stamina drains at cfg.stamina.sprintDrainPerSecond while sprinting and regenerates at regenPerSecond while not.
 * Sprint shuts off when the bar empties, and the toggle is refused below minSprintStart (an empty bar can't stutter
 * sprint back on every tick).
 */
export function updateSprint(state: PlayerState, input: InputFrame, mods: StatModifiers, cfg: MovementConfig['stamina'], dt: number): void {
  if (!mods.canSprint) state.sprinting = false;
  else {
    if (input.sprint.pressed && (state.sprinting || state.stamina >= cfg.minSprintStart)) state.sprinting = !state.sprinting;
    if (!hasMoveInput(input)) state.sprinting = false;
  }
  if (state.sprinting) {
    state.stamina = Math.max(0, state.stamina - cfg.sprintDrainPerSecond * dt);
    if (state.stamina === 0) state.sprinting = false;
  } else {
    state.stamina = Math.min(cfg.max, state.stamina + cfg.regenPerSecond * dt);
  }
}
