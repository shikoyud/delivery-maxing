import { distance, worldConfig, type CityMap, type MovementConfig, type NavConfig, type Vec3 } from '@dm/shared';
import { init, NavMeshQuery, type NavMesh, type OffMeshConnectionParams } from 'recast-navigation';
import { generateTiledNavMesh } from 'recast-navigation/generators';
import { Space } from '../city/poiSpace';
import { solidsToTriangles } from './geometry';

// The build-time navmesh (spec §5.2): the city's solids for the base movement kit (capsule, step height, slope), with
// the navigation links (pads, zip lines, mantle stacks, drops) as off-mesh connections.

let ready: Promise<void> | undefined;

/** Loads the recast WASM module once; await it before building or querying a navmesh. */
export function initNav(): Promise<void> {
  ready ??= init();
  return ready;
}

/**
 * Where each navigation link's ends stand: a link end (a zip line's cable end hangs above its roof or street) drops to
 * the highest flat surface under it, as `Reach` sees it at generation; an end with nothing flat under it keeps its
 * height. Ends sit one cell height above the surface, where recast puts the navmesh (it rounds span tops up a voxel):
 * Detour drops a connection whose start lies below its tile's lowest polygon less the climb height, and a start
 * exactly on the solid's top lands right on that limit.
 */
function offMeshConnections(city: CityMap, nav: NavConfig): OffMeshConnectionParams[] {
  const space = new Space(city.chunkSize / 4);
  for (const s of city.solids) space.addSolid(s);
  const stand = (p: Vec3): Vec3 => {
    const e = space.surface(p.x, p.z, p.y);
    return { x: p.x, y: (e ? e.top : p.y) + nav.cellHeight, z: p.z };
  };
  return city.navLinks.map((l) => ({
    startPosition: stand(l.from),
    endPosition: stand(l.to),
    radius: nav.linkRadius,
    bidirectional: l.bidirectional,
  }));
}

/**
 * The city's navmesh for the base movement kit. Call `initNav()` first. Throws when recast fails, or when a navigation
 * link is longer (across) than a tile: Detour joins an off-mesh link's far end only within its own tile and the eight
 * around it, and silently drops a link that reaches further (the harbor's crane zips run 250 m).
 */
export function buildCityNavMesh(city: CityMap, move: MovementConfig, nav: NavConfig = worldConfig.nav): NavMesh {
  const cs = nav.cellSize;
  const ch = nav.cellHeight;
  const tile = Number((nav.tileSize * cs).toFixed(3));
  for (const l of city.navLinks) {
    const across = Math.hypot(l.to.x - l.from.x, l.to.z - l.from.z);
    if (across > tile) throw new Error(`navmesh: link ${l.id} spans ${across.toFixed(1)} m, more than a ${tile} m tile (raise nav.tileSize)`);
  }
  const { positions, indices } = solidsToTriangles(city.solids);
  const result = generateTiledNavMesh(positions, indices, {
    cs,
    ch,
    tileSize: nav.tileSize,
    walkableRadius: Math.ceil(move.capsule.radius / cs),
    walkableHeight: Math.ceil(move.capsule.height / ch),
    walkableClimb: Math.floor(move.controller.maxStepHeight / ch),
    walkableSlopeAngle: move.controller.maxSlopeClimbDeg,
    minRegionArea: nav.minRegionArea,
    maxEdgeLen: nav.maxEdgeLen,
    buildBvTree: nav.buildBvTree,
    offMeshConnections: offMeshConnections(city, nav),
  });
  if (!result.success) throw new Error(`navmesh: ${result.error}`);
  return result.navMesh;
}

/** Length of a path polyline in 3D (a link counts as the straight segment between its ends). */
export function pathLength(path: readonly Vec3[]): number {
  let d = 0;
  for (let k = 1; k < path.length; k++) d += distance(path[k - 1]!, path[k]!);
  return d;
}

/**
 * Whether a path gets to `target`: its last point is within `tol` of it. Recast's computePath reports success with a
 * partial path that stops short when the target cannot be reached (Review Focus 2), so success alone proves nothing.
 */
export function reaches(path: readonly Vec3[], target: Vec3, tol: number): boolean {
  const last = path[path.length - 1];
  return last !== undefined && distance(last, target) <= tol;
}

/** Path queries on one navmesh, reusing one NavMeshQuery. */
export class NavPaths {
  private readonly query: NavMeshQuery;

  constructor(navMesh: NavMesh, private readonly nav: NavConfig = worldConfig.nav) {
    this.query = new NavMeshQuery(navMesh, { maxNodes: nav.maxNodes });
  }

  /** Recast's straight path from `from` to `to`, start and end snapped within the query extents. */
  compute(from: Vec3, to: Vec3): { success: boolean; path: Vec3[] } {
    const r = this.query.computePath(from, to, {
      halfExtents: this.nav.queryHalfExtents,
      maxPathPolys: this.nav.maxPathPolys,
      maxStraightPathPoints: this.nav.maxStraightPathPoints,
    });
    return { success: r.success, path: r.path.map((p) => ({ x: p.x, y: p.y, z: p.z })) };
  }

  /** The path length from `from` to `to`, or −1 unless the path starts within `tol` of `from` and reaches `to`. */
  distance(from: Vec3, to: Vec3, tol: number): number {
    const { success, path } = this.compute(from, to);
    if (!success || !reaches(path.slice(0, 1), from, tol) || !reaches(path, to, tol)) return -1;
    return pathLength(path);
  }

  destroy(): void {
    this.query.destroy();
  }
}
