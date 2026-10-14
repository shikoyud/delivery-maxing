import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { horizontalLength, vec3 } from '../math/vec3';
import type { MoveResult } from './body';
import type { PlayerState } from './types';

/**
 * Starts a crouch-slide. Needs all of: crouch pressed this tick, grounded (on foot, in ground mode), sprinting (the sprint toggle is on),
 * not riding, and horizontal speed ≥ slide.minEntrySpeed. The caller crouches the body.
 * With the burst ready (slideBoostCooldown ≤ 0) the start adds slide.boostSpeed along the horizontal velocity (horizontal speed
 * stays within speedCap) and starts the cooldown: 'boosted'. During the cooldown the slide keeps its speed: 'plain'.
 * Slides that begin by landing (R26) never come through here, so they never get a burst.
 */
export function startSlide(state: PlayerState, input: InputFrame, cfg: MovementConfig): 'none' | 'boosted' | 'plain' {
  if (!input.crouch.pressed || !state.sprinting) return 'none';
  if (!state.grounded || state.mode !== 'ground' || state.riding) return 'none';
  const speed = horizontalLength(state.velocity);
  if (speed < cfg.slide.minEntrySpeed) return 'none';
  state.mode = 'slide';
  if (state.slideBoostCooldown > 0) return 'plain';
  const boosted = Math.min(speed + cfg.slide.boostSpeed, cfg.speedCap);
  const k = Math.max(boosted, speed) / speed; // never slows a start that is already past the cap
  state.velocity = vec3(state.velocity.x * k, state.velocity.y, state.velocity.z * k);
  state.slideBoostCooldown = cfg.slide.boostCooldown;
  return 'boosted';
}

/**
 * Post-move slide update. While sliding:
 * - friction (slide.friction) removes speed against the velocity;
 * - gravity pulls downhill: g · slopeGravityScale · (n.x, 0, n.z), projected onto the ground plane;
 * - input does nothing.
 * The slide ends (mode 'ground') when speed drops below slide.endSpeed or when the player is no longer crouched
 * (crouch released and the capsule could stand: the caller resolves crouch before this).
 */
export function updateSlide(state: PlayerState, move: MoveResult, cfg: MovementConfig, dt: number): void {
  if (!state.grounded || state.mode !== 'slide') return;

  const n = move.groundNormal;
  const g = cfg.gravity * cfg.slide.slopeGravityScale;
  // a = g·(n.x, 0, n.z); minus its component along n leaves the downhill pull in the ground plane.
  const along = g * (n.x * n.x + n.z * n.z);
  let x = state.velocity.x + (g * n.x - along * n.x) * dt;
  let z = state.velocity.z + (g * n.z - along * n.z) * dt;

  const sp = Math.hypot(x, z);
  if (sp > 0) {
    const k = Math.max(0, sp - cfg.slide.friction * dt) / sp;
    x *= k;
    z *= k;
  }
  state.velocity = vec3(x, state.velocity.y, z);

  if (!state.crouched || Math.hypot(x, z) < cfg.slide.endSpeed) state.mode = 'ground';
}
