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
  /** Camera (look) yaw; only wishDirection reads it. */
  yaw: number;
  pitch: number;
  /**
   * The way the courier faces, a yaw in the facing() convention: the yaw of the wish direction on every tick with
   * movement input (unchanged otherwise), and boardHeading while on the board. Mantle and wall-run probe along it.
   */
  heading: number;
  mode: MoveMode;
  onBoard: boolean;
  /** Board heading as a yaw (see ground.ts facing). Set when the board comes out and on each board landing. */
  boardHeading: number;
  /** Mirrors PlayerBody.crouched: the capsule is at capsule.crouchHeight. */
  crouched: boolean;
  /** Sprint toggle (Shift): on until toggled off or every move key is released. Only ever true while moving. */
  sprinting: boolean;
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
  /** Feet y of the first wall-run start since the player last landed (or was reset); null when none (R25). */
  wallChainStartY: number | null;
  /** The zip line ride in progress (mode 'zipline'): line id, metres from its `a` end, direction (+1 toward b), speed. */
  zip: { id: string; s: number; dir: 1 | -1; speed: number } | null;
  /** The grind in progress (mode 'grind'): rail id, segment index, metres from that segment's start, direction (+1 toward the last point), speed. */
  grind: { id: string; segment: number; s: number; dir: 1 | -1; speed: number } | null;
  /** Seconds of boost-orb speed boost left (0 when none). */
  boostLeft: number;
  /** Seconds until each jump pad (by id) can trigger again; absent or 0 when ready. */
  padCooldown: Record<string, number>;
}

export interface StatModifiers {
  speedMul: number;
  jumpHeightMul: number;
}

export const NO_MODS: StatModifiers = Object.freeze({ speedMul: 1, jumpHeightMul: 1 });

export type SimEvent =
  | { kind: 'jumped' }
  | { kind: 'landed'; fallHeight: number }
  | { kind: 'jumpPad'; padId: string }
  | { kind: 'orbCollected'; orbId: string }
  | { kind: 'respawned'; checkpointId: string }
  | { kind: 'boardToggled'; onBoard: boolean };

/** Shared, room-wide feature state (see triggers.ts). */
export interface WorldFeatureState {
  orbAvailableAt: Map<string, number>;
}
