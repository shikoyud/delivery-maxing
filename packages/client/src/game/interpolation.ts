import type { SimEvent, Vec3 } from '@dm/shared';

/**
 * Where render interpolation for the next frame starts after a tick: the pre-step position, or the post-step
 * position when the tick teleported the player (a respawn), so the camera doesn't streak across the map. On a tick
 * that left the zip line (`leftZip`) the height starts at the post-step height: the courier eases that drop itself
 * (R16), so the interpolation must not spread part of it over the next frame.
 */
export function interpolationStart(before: Vec3, after: Vec3, events: readonly SimEvent[], leftZip = false): Vec3 {
  if (events.some((e) => e.kind === 'respawned')) return { x: after.x, y: after.y, z: after.z };
  return { x: before.x, y: leftZip ? after.y : before.y, z: before.z };
}

/** Interpolates between two angles (radians) along the shorter arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}
