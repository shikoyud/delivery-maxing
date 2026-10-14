import type { InputFrame } from '../input/inputFrame';
import { hasMoveInput } from './ground';
import type { PlayerState, StatModifiers } from './types';

/**
 * Apex-style sprint toggle. A Shift press flips `state.sprinting`; sprint then switches off on any tick with no move
 * input, so it can only be on while moving (a press with no move key flips on and off in the same tick, staying off).
 * While mods.canSprint is false (a Heavy order) the press is ignored and sprint is forced off.
 * Runs every tick before locomotion; no stamina.
 */
export function updateSprint(state: PlayerState, input: InputFrame, mods: StatModifiers): void {
  if (!mods.canSprint) {
    state.sprinting = false;
    return;
  }
  if (input.sprint.pressed) state.sprinting = !state.sprinting;
  if (!hasMoveInput(input)) state.sprinting = false;
}
