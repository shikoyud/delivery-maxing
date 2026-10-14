import type { VehicleTier } from '../config/types';
import { vec3, type Vec3 } from '../math/vec3';
import { forbiddenZoneAt } from '../world/access';
import type { AccessZone, MapData } from '../world/mapTypes';

/** A blocked move stops this far before the crossed zone edge (m). */
export const ACCESS_CLIP_GAP = 0.05;

export interface AccessClip {
  move: Vec3;
  /** The forbidden zone the move would have entered, else null. */
  zone: AccessZone | null;
  /** Outward normal of the crossed rect edge, else null. */
  normal: Vec3 | null;
}

/**
 * Invisible access walls (spec §4.3). When `from` is outside every zone forbidden to `tier` and `from + move` is
 * inside one (or would end within ACCESS_CLIP_GAP of it, measured along the move), the move's component across the
 * crossed rect edge is cut so it stops ACCESS_CLIP_GAP before that edge (never pushed back out); the component along the edge and the vertical part are kept, so the vehicle slides
 * along the edge. The crossed edge is the one the segment enters through last (slab method). Starting inside a
 * forbidden zone is never blocked, so a summoned or towed vehicle can always drive out; nor is a drop into a zone's
 * height band from above (no edge is crossed).
 */
export function clipToAccess(map: MapData, tier: VehicleTier, from: Vec3, move: Vec3): AccessClip {
  const unclipped: AccessClip = { move, zone: null, normal: null };
  if (forbiddenZoneAt(map, tier, from)) return unclipped;
  // The end point looks ACCESS_CLIP_GAP further along the horizontal move, so a move that would end inside the gap
  // in front of an edge is clipped too: the vehicle comes to rest exactly at the gap, not creeping up to the edge.
  const len = Math.hypot(move.x, move.z);
  const k = len > 0 ? 1 + ACCESS_CLIP_GAP / len : 1;
  const ahead = vec3(move.x * k, move.y, move.z * k);
  const zone = forbiddenZoneAt(map, tier, vec3(from.x + ahead.x, from.y + ahead.y, from.z + ahead.z));
  if (!zone) return unclipped;

  const r = zone.rect;
  // Entry time through each axis' near side (-Infinity when the segment starts within that slab).
  const entry = (p: number, d: number, min: number, max: number): number => {
    if (p < min) return d > 0 ? (min - p) / d : Infinity;
    if (p > max) return d < 0 ? (max - p) / d : Infinity;
    return -Infinity;
  };
  const tx = entry(from.x, ahead.x, r.minX, r.maxX);
  const tz = entry(from.z, ahead.z, r.minZ, r.maxZ);
  // Entered from above or below (falling into the zone's height band): there is no edge to stop before.
  if (tx === -Infinity && tz === -Infinity) return unclipped;
  if (tx >= tz) {
    const toMin = from.x < r.minX;
    const edge = toMin ? r.minX - ACCESS_CLIP_GAP : r.maxX + ACCESS_CLIP_GAP;
    const dx = toMin ? Math.max(0, Math.min(move.x, edge - from.x)) : Math.min(0, Math.max(move.x, edge - from.x));
    return { move: vec3(dx, move.y, move.z), zone, normal: vec3(toMin ? -1 : 1, 0, 0) };
  }
  const toMin = from.z < r.minZ;
  const edge = toMin ? r.minZ - ACCESS_CLIP_GAP : r.maxZ + ACCESS_CLIP_GAP;
  const dz = toMin ? Math.max(0, Math.min(move.z, edge - from.z)) : Math.min(0, Math.max(move.z, edge - from.z));
  return { move: vec3(move.x, move.y, dz), zone, normal: vec3(0, 0, toMin ? -1 : 1) };
}
