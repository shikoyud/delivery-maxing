import type { AccessKind, RideTier } from '../config/types';
import type { Vec3 } from '../math/vec3';

export type MoveMode = 'ground' | 'air' | 'slide' | 'mantle';

export interface MantleState {
  /** Feet when the mantle started. */
  from: Vec3;
  /** Feet on top of the ledge. */
  to: Vec3;
  /** Seconds since the mantle started. */
  t: number;
  /** Horizontal velocity (y = 0) at the start, restored when the mantle finishes. */
  horizontalVelocity: Vec3;
}

export interface PlayerState {
  /** Feet: the capsule bottom minus controller.offset, i.e. (about) the ground contact point when standing. */
  position: Vec3;
  velocity: Vec3;
  /** Camera (look) yaw; only wishDirection reads it. */
  yaw: number;
  pitch: number;
  /**
   * The way the courier faces, a yaw in the facing() convention: the yaw of the wish direction on every tick with
   * movement input (unchanged otherwise), and the vehicle's heading while riding. Mantle probes along it.
   */
  heading: number;
  /** While riding: 'ground' or 'air', mirroring the vehicle. */
  mode: MoveMode;
  /** The vehicle being ridden, else null (on foot). */
  riding: RideTier | null;
  /** The tier last ridden (kept after dismounting; capacity follows it), else null. */
  lastRide: RideTier | null;
  /** Mirrors PlayerBody.crouched: the capsule is at capsule.crouchHeight. */
  crouched: boolean;
  /** Sprint toggle (Shift): on until toggled off, stamina runs out or every move key is released. Only ever true while moving. */
  sprinting: boolean;
  /** Sprint stamina, 0..cfg.stamina.max: drains while sprinting, regenerates while not. */
  stamina: number;
  grounded: boolean;
  groundNormal: Vec3;
  /** Feet position on the most recent grounded tick. */
  lastGrounded: Vec3;
  /** 0 after the step that left the ground, +1 per airborne step after that. */
  airTicks: number;
  /** Ticks since the last unconsumed jump press; 0 on the press tick, null when none is buffered. */
  jumpPressAge: number | null;
  /** Highest feet y since the player was last grounded (used for fall height). */
  airApexY: number;
  /** The mantle in progress (mode 'mantle'), else null. */
  mantle: MantleState | null;
  /** Seconds until a slide start gets its speed burst again (0 when ready); counted from the start of the last boosted slide. */
  slideBoostCooldown: number;
}

export interface StatModifiers {
  speedMul: number;
  jumpHeightMul: number;
  /** False while a Heavy order is carried: the sprint toggle is ignored and sprint stays off. */
  canSprint: boolean;
}

export const NO_MODS: StatModifiers = Object.freeze({ speedMul: 1, jumpHeightMul: 1, canSprint: true });

export type SimEvent =
  | { kind: 'jumped' }
  | { kind: 'landed'; fallHeight: number }
  | { kind: 'respawned'; hospitalId: string }
  | { kind: 'mounted'; tier: RideTier }
  | { kind: 'dismounted'; tier: RideTier }
  /** F was refused: riding faster than riding.dismountMaxSpeed, or no dismount spot is free. */
  | { kind: 'mountRefused'; reason: 'tooFast' | 'noRoom' }
  /** Out of bounds while riding: the vehicle went back to this hospital's bay (Decision 6). */
  | { kind: 'towed'; tier: RideTier; hospitalId: string }
  | { kind: 'slideStarted'; boosted: boolean }
  /** A ridden vehicle hit a wall faster than ordersConfig.fragile.crashSpeed (speed: into the wall, m/s). */
  | { kind: 'crashed'; speed: number }
  /** A ridden vehicle was stopped at the edge of an access zone its tier may not enter. */
  | { kind: 'accessBlocked'; zone: AccessKind };

