import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  accessAllowed,
  expandGreybox,
  movementConfig,
  NAV_TIERS,
  navConfig,
  ridingConfig,
  vec3,
  type GreyboxSource,
  type MapData,
  type MovementConfig,
  type NavConfig,
  type RidingConfig,
  type Solid,
  type VehicleTier,
} from '@dm/shared';
import { exportNavMesh, type NavMesh } from 'recast-navigation';
import { generateTiledNavMesh } from 'recast-navigation/generators';
import { GREYBOX_SOURCE, navBinPath } from './files';
import { solidsToTriangles } from './geometry';

// The build-time navmeshes (spec §5.2): one per tier, from every solid of the map plus a blocker box over each access
// zone the tier may not enter, for the tier's agent (radius, height, step and slope).

/** A tier's navmesh agent in metres and degrees. */
export interface NavAgent {
  radius: number;
  height: number;
  climb: number;
  slopeDeg: number;
}

/**
 * The agent for `tier`: on foot the courier's capsule and controller (movement.json); riding, the ride's collider
 * radius (the upright capsule's or the lengthwise capsule's) and height, step height and slope limit (riding.json).
 *
 * On foot the climb is nav.walkClimb (0.8 m), not the step height. Recast's ledge filter rejects a cell whose
 * neighbours' floors span more than one climb, and on stairs whose tread is about one cell (the town stairs: 0.35 m
 * treads, 0.3 m cells) a cell has the step below on one side and the step above on the other: two rises. With the
 * plain step height (0.4 m) the 0.25 m-rise stairs the courier walks up get no navmesh at all. The climb is clamped to
 * the mantle height (1.2 m), so the walk mesh never takes a ledge the courier cannot get up.
 */
export function navAgent(
  tier: VehicleTier,
  move: MovementConfig = movementConfig,
  ride: RidingConfig = ridingConfig,
  nav: NavConfig = navConfig,
): NavAgent {
  if (tier === 'walk') {
    return {
      radius: move.capsule.radius,
      height: move.capsule.height,
      climb: Math.min(nav.walkClimb, move.mantle.maxHeight),
      slopeDeg: move.controller.maxSlopeClimbDeg,
    };
  }
  const r = ride.rides[tier];
  return { radius: r.collider.radius, height: r.collider.height, climb: r.maxStepHeight, slopeDeg: r.maxSlopeClimbDeg };
}

/** One box per access zone forbidden to `tier`: the zone rect, from `minY` to `maxY + nav.blockerHeight`. */
export function zoneBlockers(map: MapData, tier: VehicleTier, nav: NavConfig = navConfig): Solid[] {
  return map.accessZones
    .filter((z) => !accessAllowed(tier, z.kind))
    .map((z) => {
      const r = z.rect;
      const top = z.maxY + nav.blockerHeight;
      return {
        id: `blocker-${z.id}`,
        kind: 'prop' as const,
        center: vec3((r.minX + r.maxX) / 2, (z.minY + top) / 2, (r.minZ + r.maxZ) / 2),
        size: vec3(r.maxX - r.minX, top - z.minY, r.maxZ - r.minZ),
      };
    });
}

/** `tier`'s navmesh of `map`. Call `initNav()` first. Throws when recast fails. */
export function buildTierNavMesh(map: MapData, tier: VehicleTier, nav: NavConfig = navConfig): NavMesh {
  const agent = navAgent(tier, movementConfig, ridingConfig, nav);
  const cs = nav.cellSize;
  const ch = nav.cellHeight;
  const walkableHeight = Math.ceil(agent.height / ch);
  const walkableClimb = Math.floor(agent.climb / ch + 1e-9);
  // Fill layers one voxel above the climb: never lifted onto the surface below, and lower than the agent.
  const layerVoxels = walkableClimb + 1;
  if (layerVoxels >= walkableHeight) throw new Error(`navmesh ${tier}: agent height must exceed its climb by 2 voxels`);
  const { positions, indices } = solidsToTriangles(map.solids, zoneBlockers(map, tier, nav), layerVoxels * ch);
  const result = generateTiledNavMesh(positions, indices, {
    cs,
    ch,
    tileSize: nav.tileSize,
    walkableRadius: Math.ceil(agent.radius / cs),
    walkableHeight,
    walkableClimb,
    walkableSlopeAngle: agent.slopeDeg,
    minRegionArea: nav.minRegionArea,
    maxEdgeLen: nav.maxEdgeLen,
  });
  if (!result.success) throw new Error(`navmesh ${tier}: ${result.error}`);
  return result.navMesh;
}

/** The five navmeshes of `map` as `exportNavMesh` bytes. Call `initNav()` first. */
export function buildTierBinaries(map: MapData, nav: NavConfig = navConfig): Record<VehicleTier, Uint8Array> {
  const bins = {} as Record<VehicleTier, Uint8Array>;
  for (const t of NAV_TIERS) {
    const mesh = buildTierNavMesh(map, t, nav);
    bins[t] = exportNavMesh(mesh);
    mesh.destroy();
  }
  return bins;
}

/** The expanded greybox map (map/greybox.json). */
export function readGreyboxMap(repo: string): MapData {
  return expandGreybox(JSON.parse(readFileSync(join(repo, GREYBOX_SOURCE), 'utf8')) as GreyboxSource);
}

/** The committed navmesh bytes of every tier (throws when one is missing). */
export function readNavBinaries(repo: string): Record<VehicleTier, Uint8Array> {
  const bins = {} as Record<VehicleTier, Uint8Array>;
  for (const t of NAV_TIERS) bins[t] = new Uint8Array(readFileSync(join(repo, navBinPath(t))));
  return bins;
}
