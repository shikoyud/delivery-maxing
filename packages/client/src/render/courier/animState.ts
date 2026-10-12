import type { PlayerState, Vec3 } from '@dm/shared';
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
 * Which side of the courier a wall is on, from its heading (yaw: 0 faces −Z, positive turns left) and the wall's
 * normal (pointing away from the wall, toward the courier). A wall on the left has its normal pointing right.
 */
export function wallSide(heading: number, normal: Vec3): 'L' | 'R' {
  const rightX = Math.cos(heading);
  const rightZ = -Math.sin(heading);
  return normal.x * rightX + normal.z * rightZ >= 0 ? 'L' : 'R';
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
      const side = state.wallRun.normal ? wallSide(state.heading, state.wallRun.normal) : 'L';
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
