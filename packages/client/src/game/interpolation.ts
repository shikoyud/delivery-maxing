import type { SimEvent, Vec3 } from '@dm/shared';

/**
 * Where render interpolation for the next frame starts after a tick: the pre-step position, or the post-step
 * position when the tick teleported the player (a respawn), so the camera doesn't streak across the map.
 */
export function interpolationStart(before: Vec3, after: Vec3, events: readonly SimEvent[]): Vec3 {
  const p = events.some((e) => e.kind === 'respawned') ? after : before;
  return { x: p.x, y: p.y, z: p.z };
}

/** Interpolates between two angles (radians) along the shorter arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}
