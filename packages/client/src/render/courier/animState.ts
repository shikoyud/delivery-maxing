import { yawOf, type MoveMode, type PlayerState, type RideTier } from '@dm/shared';
import type { CourierConfig, CourierPoseName } from '../../clientConfig';

/** Clips of Robot Expressive the courier uses. */
export type CourierClip = 'Idle' | 'Walking' | 'Running' | 'Jump';

/** What the courier model shows: a clip at a playback rate, with a procedural pose layered over it. */
export interface CourierAnim {
  clip: CourierClip;
  timeScale: number;
  pose: 'none' | CourierPoseName;
  /** The courier is not drawn at all (inside the car). */
  hidden?: true;
}

/** Modes where the courier moves on its own, not along its input: it faces its travel there (R14). */
const TRAVEL_MODES: ReadonlySet<MoveMode> = new Set<MoveMode>(['slide', 'mantle']);
/** A mantle path shorter than this horizontally (m) is straight up and gives no direction. */
const MANTLE_MIN_RUN = 1e-3;

/**
 * The yaw the courier is drawn at (R14, spec §4 "the courier faces its direction of travel"). In a slide it is the yaw
 * of the horizontal velocity while that is faster than facingMinSpeed; a mantle faces along its own path (the velocity
 * is zeroed while it climbs). Otherwise, on the ground, riding and in the air, it is state.heading, which already
 * follows the input.
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

/** How the courier rides each vehicle: standing on the skateboard deck, seated on the bikes, hidden inside the car. */
const RIDE_ANIM: Record<RideTier, CourierAnim> = {
  skateboard: still('board'),
  bicycle: still('bike'),
  motorbike: still('bike'),
  car: { ...still('none'), hidden: true },
};

/**
 * The courier's animation for a sim state and horizontal speed (pure). Precedence: riding (the ride's pose, in the
 * air too), mantle, slide, air (fall pose when dropping faster than fallSpeed), crouch, then ground locomotion.
 */
export function animFor(state: PlayerState, speed: number, cfg: CourierConfig): CourierAnim {
  if (state.riding) return { ...RIDE_ANIM[state.riding] };
  if (state.mode === 'mantle') return { clip: 'Jump', timeScale: 1, pose: 'mantle' };
  switch (state.mode) {
    case 'slide':
      return still('slide');
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
