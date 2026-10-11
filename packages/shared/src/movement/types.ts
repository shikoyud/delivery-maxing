import type { Vec3 } from '../math/vec3';

export type MoveMode = 'ground' | 'air' | 'slide' | 'wallrun' | 'mantle' | 'zipline' | 'grind';

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

export interface WallRunState {
  /** Seconds since the current wall-run started (0 when not wall-running). */
  time: number;
  /** Horizontal unit normal of the wall being run (mode 'wallrun'), else null. */
  normal: Vec3 | null;
  /** Normal of the last wall run or jumped off since landing; blocks running the same wall again. Null after landing. */
  lastNormal: Vec3 | null;
}

export interface PlayerState {
  /** Feet: the capsule bottom minus controller.offset, i.e. (about) the ground contact point when standing. */
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  mode: MoveMode;
  onBoard: boolean;
  /** Mirrors PlayerBody.crouched: the capsule is at capsule.crouchHeight. */
  crouched: boolean;
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
  wallRun: WallRunState;
}

export interface StatModifiers {
  speedMul: number;
  jumpHeightMul: number;
}

export const NO_MODS: StatModifiers = Object.freeze({ speedMul: 1, jumpHeightMul: 1 });

export type SimEvent = { kind: 'jumped' } | { kind: 'landed'; fallHeight: number };

/** Shared, room-wide feature state (filled by Task 9). */
export interface WorldFeatureState {
  orbAvailableAt: Map<string, number>;
}
