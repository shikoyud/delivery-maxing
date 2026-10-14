import { navConfig, ridingConfig } from '../config';
import type { RideTier, RidingConfig } from '../config/types';
import { vec3, type Vec3 } from '../math/vec3';
import { forbiddenZoneAt } from '../world/access';
import type { NavRouter } from '../world/nav';
import type { Garage } from './Garage';

/**
 * A summon's outcome (spec §4.4): 'ok' (the vehicle moved), or why not — it is being ridden, it is carried (the
 * skateboard), it is already within summon.minDistance, the one summon cooldown is running, or there is no legal road
 * spot by the player.
 */
export type SummonResult = 'ok' | 'riding' | 'carried' | 'tooClose' | 'cooldown' | 'noSpot';

/** Navmesh points sit up to a cell above the ground: a summoned vehicle's feet drop to the ground under them. */
const GROUND_PROBE_UP = 1;
const GROUND_PROBE_DOWN = 2;

/**
 * Where a summoned `tier` vehicle goes (spec §4.4): summon.ringSamples points on a ring of radius minClearance + 2
 * around the player, each snapped to the tier's navmesh (closestPoint with nav.queryHalfExtents); the nearest that is
 * at least minClearance from the player (horizontally), outside every zone forbidden to the tier, and where the
 * vehicle fits. When no ring point qualifies, the tier's mesh point closest to the player within searchRadius on x/z,
 * under the same checks (nav.queryHalfExtents.y vertically); else null. The vehicle faces the player's `heading`,
 * its feet on the ground below the mesh point.
 */
export function findRoadSpot(
  router: NavRouter,
  garage: Garage,
  tier: RideTier,
  player: Vec3,
  heading: number,
  cfg: RidingConfig = ridingConfig,
): { position: Vec3; heading: number } | null {
  const s = cfg.summon;
  const body = garage.body(tier);
  const flat = (p: Vec3): number => Math.hypot(p.x - player.x, p.z - player.z);
  const legal = (q: Vec3 | null): Vec3 | null => {
    if (!q || flat(q) < s.minClearance || forbiddenZoneAt(garage.map, tier, q)) return null;
    const ground = body.castRay(vec3(q.x, q.y + GROUND_PROBE_UP, q.z), vec3(0, -1, 0), GROUND_PROBE_DOWN);
    const feet = ground ? vec3(q.x, ground.point.y, q.z) : q;
    return body.fitsAt(feet, heading) ? feet : null;
  };

  const ring = s.minClearance + 2;
  let best: Vec3 | null = null;
  for (let k = 0; k < s.ringSamples; k++) {
    const a = (2 * Math.PI * k) / s.ringSamples;
    const q = legal(router.closestPoint(tier, vec3(player.x + Math.cos(a) * ring, player.y, player.z + Math.sin(a) * ring)));
    if (q && (!best || flat(q) < flat(best))) best = q;
  }
  if (!best) {
    best = legal(router.closestPoint(tier, player, vec3(s.searchRadius, navConfig.queryHalfExtents.y, s.searchRadius)));
  }
  return best ? { position: best, heading } : null;
}
