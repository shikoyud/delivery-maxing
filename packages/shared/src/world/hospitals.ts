import type { Vec3 } from '../math/vec3';
import type { Hospital, MapData } from './mapTypes';

const flatDistance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

/** The hospital whose centre is nearest to `p` on the x/z plane (the first one wins a tie). */
export function nearestHospital(map: MapData, p: Vec3): Hospital {
  let best: Hospital | undefined;
  let bestD = Infinity;
  for (const h of map.hospitals) {
    const d = flatDistance(h.center, p);
    if (d < bestD) { best = h; bestD = d; }
  }
  if (!best) throw new Error('map has no hospitals');
  return best;
}

/** The hospital whose safe radius contains `p` (horizontal, inclusive), or null. */
export function inSafeZone(map: MapData, p: Vec3): Hospital | null {
  for (const h of map.hospitals) {
    if (flatDistance(h.center, p) <= h.safeRadius) return h;
  }
  return null;
}
