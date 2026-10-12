import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { horizontalLength, vec3 } from '../math/vec3';
import type { MoveResult } from './body';
import { wishDirection } from './ground';
import type { PlayerState } from './types';

/**
 * Starts a crouch-slide. Needs all of: crouch pressed this tick, grounded (on foot, in ground mode), sprint held,
 * not on the board, and horizontal speed ≥ slide.minEntrySpeed. The caller crouches the body.
 */
export function startSlide(state: PlayerState, input: InputFrame, cfg: MovementConfig): boolean {
  if (!input.crouch.pressed || !input.sprint.held) return false;
  if (!state.grounded || state.mode !== 'ground' || state.onBoard) return false;
  if (horizontalLength(state.velocity) < cfg.slide.minEntrySpeed) return false;
  state.mode = 'slide';
  return true;
}

/**
 * Post-move slide update. Grounded on a chute, the player slides whether or not crouch is held. While sliding:
 * - friction (slide.friction, or chute.friction on a chute) removes speed against the velocity;
 * - gravity pulls downhill: g · slopeGravityScale · (n.x, 0, n.z), projected onto the ground plane;
 * - on a chute, input steers only through chute.steerAccel; off a chute, input does nothing.
 * Off a chute, the slide ends (mode 'ground') when speed drops below slide.endSpeed or when the player is no
 * longer crouched (crouch released and the capsule could stand: the caller resolves crouch before this).
 */
export function updateSlide(state: PlayerState, move: MoveResult, input: InputFrame, cfg: MovementConfig, dt: number): void {
  if (!state.grounded) return;
  const onChute = move.groundSurface === 'chute';
  if (onChute) state.mode = 'slide';
  if (state.mode !== 'slide') return;

  const n = move.groundNormal;
  const g = cfg.gravity * cfg.slide.slopeGravityScale;
  // a = g·(n.x, 0, n.z); minus its component along n leaves the downhill pull in the ground plane.
  const along = g * (n.x * n.x + n.z * n.z);
  let x = state.velocity.x + (g * n.x - along * n.x) * dt;
  let z = state.velocity.z + (g * n.z - along * n.z) * dt;

  const friction = onChute ? cfg.chute.friction : cfg.slide.friction;
  const sp = Math.hypot(x, z);
  if (sp > 0) {
    const k = Math.max(0, sp - friction * dt) / sp;
    x *= k;
    z *= k;
  }

  if (onChute) {
    const wish = wishDirection(input);
    x += wish.x * cfg.chute.steerAccel * dt;
    z += wish.z * cfg.chute.steerAccel * dt;
  }
  state.velocity = vec3(x, state.velocity.y, z);

  if (!onChute && (!state.crouched || Math.hypot(x, z) < cfg.slide.endSpeed)) state.mode = 'ground';
}
