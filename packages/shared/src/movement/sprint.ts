import type { InputFrame } from '../input/inputFrame';
import { hasMoveInput } from './ground';
import type { PlayerState } from './types';

/**
 * Apex-style sprint toggle. A Shift press flips `state.sprinting`; sprint then switches off on any tick with no move
 * input, so it can only be on while moving (a press with no move key flips on and off in the same tick, staying off).
 * Runs every tick before locomotion; no stamina.
 */
export function updateSprint(state: PlayerState, input: InputFrame): void {
  if (input.sprint.pressed) state.sprinting = !state.sprinting;
  if (!hasMoveInput(input)) state.sprinting = false;
}
