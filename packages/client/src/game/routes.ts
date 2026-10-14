import type { NavRouter, RouteToDoor, Vec3, VehicleTier } from '@dm/shared';

interface Entry {
  tier: VehicleTier;
  from: Vec3;
  at: number;
  route: RouteToDoor | null;
}

/**
 * Per-target cache of door routes (spec §8 HUD arrow, Map app), so navmesh queries don't run every frame. A target's
 * route is recomputed when its tier changes, `refreshSeconds` after it was computed, or once the player is
 * `driftMeters` (ui.routeDriftMeters) from where it started; a null (unreachable) answer is cached the same way.
 */
export class RouteCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly router: Pick<NavRouter, 'routeToDoor'>,
    private readonly refreshSeconds: number,
    private readonly driftMeters: number,
  ) {}

  get(tier: VehicleTier, from: Vec3, targetId: string, door: Vec3, now: number): RouteToDoor | null {
    const e = this.entries.get(targetId);
    if (
      e &&
      e.tier === tier &&
      now >= e.at &&
      now - e.at < this.refreshSeconds &&
      Math.hypot(from.x - e.from.x, from.y - e.from.y, from.z - e.from.z) < this.driftMeters
    ) {
      return e.route;
    }
    const route = this.router.routeToDoor(tier, from, door);
    this.entries.set(targetId, { tier, from: { ...from }, at: now, route });
    return route;
  }

  /** Forgets the routes of targets not in `keep` (stops that were reached or orders that ended). */
  retain(keep: ReadonlySet<string>): void {
    for (const id of this.entries.keys()) if (!keep.has(id)) this.entries.delete(id);
  }
}

/** The route as one polyline: the drive, then the foot leg's door end. */
function routePoints(route: RouteToDoor): Vec3[] {
  return route.footLeg ? [...route.drive, route.footLeg[1]] : route.drive;
}

/**
 * The route's next corner as seen from `p`: the far end of the segment `p` is closest to (horizontally). A cached
 * route may have started a few metres back, so this follows the player along it rather than taking the second point.
 */
export function nextCorner(route: RouteToDoor, p: Vec3): Vec3 {
  const pts = routePoints(route);
  if (pts.length < 2) return pts[0] ?? p;
  let best = 1;
  let bestD = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
    const d = Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
    // Ties (standing on a corner) go to the later segment, so the corner just reached is not the next one.
    if (d <= bestD + 1e-6) {
      bestD = d;
      best = i;
    }
  }
  return pts[best]!;
}

/** World yaw from `from` facing `to` (0 faces -Z, positive turns left). */
export function yawTo(from: Vec3, to: Vec3): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}
