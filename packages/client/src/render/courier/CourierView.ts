import type * as THREE from 'three';
import type { PlayerState, Vec3 } from '@dm/shared';
import type { Look } from '../cosmetics';

/** What the debug API reports about the visible courier. */
export interface CourierDebug {
  /** Whether this is the animated model (false: the capsule fallback). */
  loaded: boolean;
  /** The clip playing (null for the capsule). */
  clip: string | null;
  pose: string;
  /** Animation mixer time (s); advances while the model animates. */
  time: number;
  /** The drawn yaw (root rotation; displayYaw eased at turnEaseRate). */
  yaw: number;
  packages: number;
}

/**
 * The visible courier: the animated model, or the capsule placeholder when the model fails to load (ruling R1,
 * Review Focus 4). Game drives either one the same way.
 */
export interface CourierView {
  /** Positioned at the feet and turned to displayYaw (R14). */
  readonly root: THREE.Object3D;
  /** Per frame: interpolated feet, the sim state and horizontal speed (m/s); `dt` is the frame time (s). */
  update(dt: number, state: PlayerState, feet: Vec3, speed: number): void;
  /** Hides the courier from the camera while it keeps casting its shadow (R10: camera closer than minDistance). */
  setHidden(hidden: boolean): void;
  /** One box per carried package on the courier's back. */
  setPackages(n: number): void;
  /** The outfit colour or finish and the bag colour (Decision 4). */
  applyLook(look: Look): void;
  /** The next update jumps straight to the state (no turn ease, clip or pose blend): spawn, teleport, respawn. */
  snap(): void;
  debug(): CourierDebug;
}
