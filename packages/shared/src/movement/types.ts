import type { Vec3 } from '../math/vec3';

export type MoveMode = 'ground' | 'air' | 'slide' | 'wallrun' | 'mantle' | 'zipline' | 'grind';

export interface PlayerState {
  /** Feet (bottom of the capsule). */
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  mode: MoveMode;
  onBoard: boolean;
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
