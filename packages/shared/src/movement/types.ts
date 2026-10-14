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
   * movement input (unchanged otherwise), and boardHeading while on the board. Mantle probes along it.
   */
  heading: number;
  mode: MoveMode;
  onBoard: boolean;
  /** Board heading as a yaw (see ground.ts facing). Set when the board comes out and on each board landing. */
  boardHeading: number;
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
  | { kind: 'boardToggled'; onBoard: boolean }
  | { kind: 'slideStarted'; boosted: boolean };

