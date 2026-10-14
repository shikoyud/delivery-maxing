import { importNavMesh, init, NavMeshQuery, type NavMesh } from 'recast-navigation';
import { navConfig } from '../config';
import type { NavConfig, VehicleTier } from '../config';
import { distance as dist, vec3, type Vec3 } from '../math/vec3';

// Runtime routing on the five per-tier navmeshes (spec §5.2): built by `pnpm map:build` into map/nav/, loaded here
// from their bytes. Recast reports a partial path (one that stops short of an unreachable target) as a success, so
// every query here checks that the path really starts at `from` and ends at the target.

/** The tiers in a fixed order (one navmesh each). */
export const NAV_TIERS: readonly VehicleTier[] = ['walk', 'skateboard', 'bicycle', 'motorbike', 'car'];

let ready: Promise<void> | undefined;

/** Loads the recast WASM module once; await it before building, loading or querying a navmesh. */
export function initNav(): Promise<void> {
  ready ??= init().catch((e: unknown) => {
    ready = undefined; // a failed load can be retried
    throw e;
  });
  return ready;
}

/** Length of a polyline in 3D. */
export function pathLength(path: readonly Vec3[]): number {
  let d = 0;
  for (let k = 1; k < path.length; k++) d += dist(path[k - 1]!, path[k]!);
  return d;
}

/** Whether a path's last point is within `tol` of `target` (a partial path stops short of it). */
export function reaches(path: readonly Vec3[], target: Vec3, tol: number): boolean {
  const last = path[path.length - 1];
  return last !== undefined && dist(last, target) <= tol;
}

/** Whether a path's first point is within `tol` of `origin` (a start off the mesh snaps to a far polygon). */
export function startsAt(path: readonly Vec3[], origin: Vec3, tol: number): boolean {
  const first = path[0];
  return first !== undefined && dist(first, origin) <= tol;
}

const copy = (p: Vec3): Vec3 => vec3(p.x, p.y, p.z);

/** Path queries on one navmesh, reusing one NavMeshQuery. */
export class NavPaths {
  private readonly query: NavMeshQuery;

  constructor(navMesh: NavMesh, private readonly nav: NavConfig = navConfig) {
    this.query = new NavMeshQuery(navMesh, { maxNodes: nav.maxNodes });
  }

  /** Recast's straight path from `from` to `to`, both ends snapped within `halfExtents` (empty when none). */
  compute(from: Vec3, to: Vec3, halfExtents: Vec3 = this.nav.queryHalfExtents): Vec3[] {
    const r = this.query.computePath(from, to, {
      halfExtents,
      maxPathPolys: this.nav.maxPathPolys,
      maxStraightPathPoints: this.nav.maxStraightPathPoints,
    });
    return r.success ? r.path.map(copy) : [];
  }

  /** The path length from `from` to `to`, or Infinity unless the path starts within `tol` of `from` and reaches `to`. */
  distance(from: Vec3, to: Vec3, tol: number = this.nav.reachTolerance): number {
    const path = this.compute(from, to);
    return startsAt(path, from, tol) && reaches(path, to, tol) ? pathLength(path) : Infinity;
  }

  /** The point of the mesh closest to `p` within `halfExtents`, or null. */
  closestPoint(p: Vec3, halfExtents: Vec3 = this.nav.queryHalfExtents): Vec3 | null {
    const r = this.query.findClosestPoint(p, { halfExtents });
    return r.success && r.polyRef !== 0 ? copy(r.point) : null;
  }

  destroy(): void {
    this.query.destroy();
  }
}

/**
 * A route for one tier to a door. `drive` is the tier's path to the door or, when the door is off the tier's mesh, to
 * the point it can reach closest to the door; `footLeg` then runs from there to the door. `length` sums both.
 */
export interface RouteToDoor {
  drive: Vec3[];
  footLeg: [Vec3, Vec3] | null;
  length: number;
}

/** Path distances, closest points and door routes on the five per-tier navmeshes. Call `initNav()` first. */
export class NavRouter {
  private constructor(
    private readonly meshes: Record<VehicleTier, NavMesh>,
    private readonly paths: Record<VehicleTier, NavPaths>,
    private readonly nav: NavConfig,
  ) {}

  /** Imports the five navmeshes from their `exportNavMesh` bytes (map/nav/greybox-<tier>.bin). */
  static fromBinaries(bins: Record<VehicleTier, Uint8Array>, cfg: NavConfig = navConfig): NavRouter {
    const meshes = {} as Record<VehicleTier, NavMesh>;
    const paths = {} as Record<VehicleTier, NavPaths>;
    for (const t of NAV_TIERS) {
      meshes[t] = importNavMesh(bins[t]).navMesh;
      paths[t] = new NavPaths(meshes[t], cfg);
    }
    return new NavRouter(meshes, paths, cfg);
  }

  /** Path length for `tier` from `from` to `to`; Infinity unless the path starts and ends within reachTolerance. */
  distance(tier: VehicleTier, from: Vec3, to: Vec3): number {
    return this.paths[tier].distance(from, to, this.nav.reachTolerance);
  }

  /** The point of `tier`'s mesh closest to `p` within `halfExtents` (default nav.queryHalfExtents), or null. */
  closestPoint(tier: VehicleTier, p: Vec3, halfExtents: Vec3 = this.nav.queryHalfExtents): Vec3 | null {
    return this.paths[tier].closestPoint(p, halfExtents);
  }

  /**
   * `tier`'s route from `from` to `door`. The door end is snapped to the mesh's closest point to the door, searched
   * within carRoadMaxDoorDistance on every axis, the box doubling up to doorSearchMaxRadius; when the path stops short
   * of the door (the door is off the mesh, or its closest point is on a part the tier cannot reach from `from`), the
   * rest is a straight foot leg. Null when `from` is not on the tier's mesh, no part of the mesh is near the door, or
   * the foot leg would be longer than maxFootLeg (a straight line that long would cut through the city).
   */
  routeToDoor(tier: VehicleTier, from: Vec3, door: Vec3): RouteToDoor | null {
    const tol = this.nav.reachTolerance;
    const paths = this.paths[tier];
    let target: Vec3 | null = null;
    for (let r = this.nav.carRoadMaxDoorDistance; r <= this.nav.doorSearchMaxRadius && !target; r *= 2) {
      target = paths.closestPoint(door, vec3(r, r, r));
    }
    if (!target) return null;
    const drive = paths.compute(from, target);
    if (!startsAt(drive, from, tol)) return null;
    const end = drive[drive.length - 1]!;
    const leg = dist(end, door);
    if (leg <= tol) return { drive, footLeg: null, length: pathLength(drive) };
    if (leg > this.nav.maxFootLeg) return null;
    return { drive, footLeg: [copy(end), copy(door)], length: pathLength(drive) + leg };
  }

  destroy(): void {
    for (const t of NAV_TIERS) {
      this.paths[t].destroy();
      this.meshes[t].destroy();
    }
  }
}
