import { yawOf, type MoveMode, type PlayerState, type Vec3 } from '@dm/shared';
import type { CourierConfig, CourierPoseName } from '../../clientConfig';

/** Clips of Robot Expressive the courier uses. */
export type CourierClip = 'Idle' | 'Walking' | 'Running' | 'Jump';

/** What the courier model shows: a clip at a playback rate, with a procedural pose layered over it. */
export interface CourierAnim {
  clip: CourierClip;
  timeScale: number;
  pose: 'none' | CourierPoseName;
}

/**
 * Which side of the courier a wall is on, from the way it faces (yaw: 0 faces −Z, positive turns left) and the wall's
 * normal (pointing away from the wall, toward the courier). A wall on the left has its normal pointing right.
 */
export function wallSide(yaw: number, normal: Vec3): 'L' | 'R' {
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  return normal.x * rightX + normal.z * rightZ >= 0 ? 'L' : 'R';
}

/** Modes where the courier moves on its own, not along its input: it faces its travel there (R14). */
const TRAVEL_MODES: ReadonlySet<MoveMode> = new Set<MoveMode>(['zipline', 'slide', 'grind', 'wallrun', 'mantle']);
/** A mantle path shorter than this horizontally (m) is straight up and gives no direction. */
const MANTLE_MIN_RUN = 1e-3;

/**
 * The yaw the courier is drawn at (R14, spec §4 "the courier faces its direction of travel"). On a zip line, in a
 * slide, grind or wall-run it is the yaw of the horizontal velocity (on a zip line the ride direction) while that is
 * faster than facingMinSpeed; a mantle faces along its own path (the velocity is zeroed while it climbs). Otherwise,
 * and on the ground, on the board and in the air, it is state.heading, which already follows the input.
 */
export function displayYaw(state: PlayerState, cfg: CourierConfig): number {
  if (!TRAVEL_MODES.has(state.mode)) return state.heading;
  if (state.mode === 'mantle') {
    const m = state.mantle;
    if (!m) return state.heading;
    const run = { x: m.to.x - m.from.x, y: 0, z: m.to.z - m.from.z };
    return Math.hypot(run.x, run.z) > MANTLE_MIN_RUN ? yawOf(run) : state.heading;
  }
  const v = state.velocity;
  return Math.hypot(v.x, v.z) > cfg.facingMinSpeed ? yawOf(v) : state.heading;
}

/** Ground locomotion by speed: Idle, Walking, or Running with a playback rate that follows the speed (floored at runMinTimeScale). */
function locomotion(speed: number, cfg: CourierConfig): Pick<CourierAnim, 'clip' | 'timeScale'> {
  if (speed < cfg.idleSpeed) return { clip: 'Idle', timeScale: 1 };
  if (speed < cfg.walkMaxSpeed) return { clip: 'Walking', timeScale: 1 };
  return { clip: 'Running', timeScale: Math.max(cfg.runMinTimeScale, speed / cfg.runSpeedForFullRun) };
}

const still = (pose: CourierAnim['pose']): CourierAnim => ({ clip: 'Idle', timeScale: 1, pose });

/**
 * The courier's animation for a sim state and horizontal speed (pure). Precedence: zip line, mantle, board, grind,
 * slide, wall-run, air (fall pose when dropping faster than fallSpeed), crouch, then ground locomotion.
 */
export function animFor(state: PlayerState, speed: number, cfg: CourierConfig): CourierAnim {
  switch (state.mode) {
    case 'zipline':
      return still('zip');
    case 'mantle':
      return { clip: 'Jump', timeScale: 1, pose: 'mantle' };
    default:
      break;
  }
  if (state.onBoard) return still('board');
  switch (state.mode) {
    case 'grind':
      return still('grind');
    case 'slide':
      return still('slide');
    case 'wallrun': {
      const side = state.wallRun.normal ? wallSide(displayYaw(state, cfg), state.wallRun.normal) : 'L';
      return { ...locomotion(Math.max(speed, cfg.walkMaxSpeed), cfg), pose: side === 'L' ? 'wallrunL' : 'wallrunR' };
    }
    case 'air':
      return { clip: 'Jump', timeScale: 1, pose: state.velocity.y < -cfg.fallSpeed ? 'fall' : 'none' };
    default:
      return { ...locomotion(speed, cfg), pose: state.crouched ? 'crouch' : 'none' };
  }
}

/** Wraps an angle to (−π, π]. */
function wrapPi(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Eases a yaw toward `target` the short way round (exponential, `rate` 1/s); never overshoots. */
export function easeYaw(yaw: number, target: number, dt: number, rate: number): number {
  return yaw + wrapPi(target - yaw) * (1 - Math.exp(-rate * Math.max(0, dt)));
}

/** The courier's visual height offset after leaving a zip line (R16); see stepDismountEase. */
export interface DismountEase {
  /** Added to the feet height this frame (m). */
  offset: number;
  /** Last frame's mode and drawn height (feet + offset); null before the first frame. */
  lastMode: MoveMode | null;
  lastY: number | null;
}

export function createDismountEase(): DismountEase {
  return { offset: 0, lastMode: null, lastY: null };
}

/**
 * The y offset to draw the courier root at this frame (R16). Leaving a zip line moves the feet by up to the hang drop
 * in one tick (onto the platform under the cable end); on that frame the offset takes up the whole jump, so the
 * courier stays where it was drawn, and then decays exponentially at `rate` (1/s). Any exit counts (a dismount that
 * jumps on the same tick leaves in 'air'); a jump-off mid-line has no jump, so its offset is tiny. A snap (spawn,
 * teleport, respawn) clears it.
 */
export function stepDismountEase(e: DismountEase, mode: MoveMode, feetY: number, dt: number, rate: number, snap: boolean): number {
  const decay = Math.exp(-rate * Math.max(0, dt));
  if (snap || e.lastY === null) e.offset = 0;
  else if (e.lastMode === 'zipline' && mode !== 'zipline') e.offset = (e.lastY - feetY) * decay;
  else e.offset *= decay;
  e.lastMode = mode;
  e.lastY = feetY + e.offset;
  return e.offset;
}
