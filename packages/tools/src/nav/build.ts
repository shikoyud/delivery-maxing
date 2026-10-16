import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  accessAllowed,
  cityConfig,
  expandGreybox,
  layoutToMap,
  movementConfig,
  NAV_TIERS,
  navConfig,
  ridingConfig,
  vec3,
  switchbackGeometry,
  type CityConfig,
  type CityMap,
  type Connector,
  type GreyboxSource,
  type MapData,
  type MovementConfig,
  type NavConfig,
  type Rect,
  type RidingConfig,
  type Solid,
  type VehicleTier,
} from '@dm/shared';
import { exportNavMesh, type NavMesh } from 'recast-navigation';
import { generateTiledNavMesh } from 'recast-navigation/generators';
import { readCatalog, readLayout } from '../city/files';
import { GREYBOX_SOURCE, navBinPath, readGz } from './files';
import { solidsToTriangles } from './geometry';

// The build-time navmeshes (spec §5.2): one per tier, from every solid of the map plus a blocker box over each access
// zone the tier may not enter (and, on the city, over each area kind nav.forbiddenAreasByTier keeps it off), for the
// tier's agent (radius, height, step and slope) at the tier's cell size.

/** A tier's navmesh agent in metres and degrees, and the recast cell size it is voxelised at. */
export interface NavAgent {
  cellSize: number;
  radius: number;
  height: number;
  climb: number;
  slopeDeg: number;
}

/**
 * The agent for `tier`: on foot the courier's capsule and controller (movement.json); riding, the ride's collider
 * radius (the upright capsule's or the lengthwise capsule's) and height, step height and slope limit (riding.json).
 *
 * On foot the climb is nav.walkClimb (1 m), not the step height. Recast's ledge filter rejects a cell whose
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
  const cellSize = nav.cellSizeByTier[tier];
  if (tier === 'walk') {
    return {
      cellSize,
      radius: move.capsule.radius,
      height: move.capsule.height,
      climb: Math.min(nav.walkClimb, move.mantle.maxHeight),
      slopeDeg: move.controller.maxSlopeClimbDeg,
    };
  }
  const r = ride.rides[tier];
  return { cellSize, radius: r.collider.radius, height: r.collider.height, climb: r.maxStepHeight, slopeDeg: r.maxSlopeClimbDeg };
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

/** An axis-aligned box from `rect` at `y0` up to `y0 + nav.blockerHeight`, as a blocker solid. */
function blockerBox(id: string, r: Rect, y0: number, nav: NavConfig): Solid {
  const top = y0 + nav.blockerHeight;
  return {
    id,
    kind: 'prop',
    center: vec3((r.minX + r.maxX) / 2, (y0 + top) / 2, (r.minZ + r.maxZ) / 2),
    size: vec3(r.maxX - r.minX, top - y0, r.maxZ - r.minZ),
  };
}

const overlaps = (a: Rect, b: Rect): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

/** `r` minus the union of `holes`, as rects (one or more per x strip between hole edges; slivers under 1 mm dropped). */
export function subtractRects(r: Rect, holes: readonly Rect[]): Rect[] {
  const hits = holes.filter((h) => overlaps(r, h));
  const xs = [...new Set([r.minX, r.maxX, ...hits.flatMap((h) => [h.minX, h.maxX])])]
    .filter((x) => x >= r.minX && x <= r.maxX)
    .sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const [x0, x1] = [xs[i]!, xs[i + 1]!];
    if (x1 - x0 < 1e-3) continue;
    const cuts = hits
      .filter((h) => h.minX < x1 && h.maxX > x0)
      .map((h) => [Math.max(r.minZ, h.minZ), Math.min(r.maxZ, h.maxZ)] as const)
      .sort((a, b) => a[0] - b[0]);
    let z = r.minZ;
    for (const [a, b] of cuts) {
      if (a - z > 1e-3) out.push({ minX: x0, maxX: x1, minZ: z, maxZ: a });
      z = Math.max(z, b);
    }
    if (r.maxZ - z > 1e-3) out.push({ minX: x0, maxX: x1, minZ: z, maxZ: r.maxZ });
  }
  return out;
}

/** The ground rects of a switchback's deck: entry stub, both legs, hairpin landing, exit stub. */
export function switchbackFootprint(c: Connector, city: CityConfig = cityConfig): Rect[] {
  const g = switchbackGeometry(c, city.switchback);
  const half = city.switchback.width / 2;
  const [za, zb] = g.legZ;
  const xe = g.xs + g.run;
  return [
    { minX: c.x - half, maxX: c.x + half, minZ: c.z0, maxZ: za + half },
    { minX: g.xs, maxX: xe, minZ: za - half, maxZ: za + half },
    { minX: xe, maxX: g.xEast, minZ: za - half, maxZ: zb + half },
    { minX: g.xs, maxX: xe, minZ: zb - half, maxZ: zb + half },
    { minX: c.x - half, maxX: c.x + half, minZ: zb - half, maxZ: c.z1 },
  ];
}

/**
 * The ground rects of the city areas `tier` is kept off (nav.forbiddenAreasByTier), each with its area: the whole
 * area, except that a band gap leaves out the deck of every switchback in it (the deck is the car's way up; the gap
 * floor around and inside the U is not). Empty on the greybox.
 */
export function forbiddenAreaRects(map: MapData, tier: VehicleTier, nav: NavConfig = navConfig, city: CityConfig = cityConfig): { id: string; rect: Rect; y: number }[] {
  if (map.kind !== 'city') return [];
  const kinds = new Set(nav.forbiddenAreasByTier[tier]);
  const { layout } = map as CityMap;
  const decks = layout.connectors.filter((c) => c.kind === 'switchback').flatMap((c) => switchbackFootprint(c, city));
  return layout.areas
    .filter((a) => kinds.has(a.kind))
    .flatMap((a) =>
      (a.kind === 'bandGap' ? subtractRects(a.rect, decks) : [a.rect]).map((rect, i) => ({ id: `${a.id}-${i}`, rect, y: a.y })),
    );
}

/** One blocker box per forbidden area rect (`forbiddenAreaRects`), from the area's height up nav.blockerHeight. */
export function areaBlockers(map: MapData, tier: VehicleTier, nav: NavConfig = navConfig): Solid[] {
  return forbiddenAreaRects(map, tier, nav).map((a) => blockerBox(`blocker-${a.id}`, a.rect, a.y, nav));
}

/** `tier`'s navmesh of `map`. Call `initNav()` first. Throws when recast fails. */
export function buildTierNavMesh(map: MapData, tier: VehicleTier, nav: NavConfig = navConfig): NavMesh {
  const agent = navAgent(tier, movementConfig, ridingConfig, nav);
  const cs = agent.cellSize;
  const ch = nav.cellHeight;
  const walkableHeight = Math.ceil(agent.height / ch);
  const walkableClimb = Math.floor(agent.climb / ch + 1e-9);
  // Fill layers one voxel above the climb: never lifted onto the surface below, and lower than the agent.
  const layerVoxels = walkableClimb + 1;
  if (layerVoxels >= walkableHeight) throw new Error(`navmesh ${tier}: agent height must exceed its climb by 2 voxels`);
  const blockers = [...zoneBlockers(map, tier, nav), ...areaBlockers(map, tier, nav)];
  const { positions, indices } = solidsToTriangles(map.solids, blockers, layerVoxels * ch);
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

/** The city map expanded from the committed map/city.layout.json and map/catalog.json. */
export function readCityMap(repo: string): CityMap {
  return layoutToMap(readLayout(repo), readCatalog(repo));
}

/** The committed navmesh bytes of every tier of a map, inflated (throws when one is missing). */
export function readNavBinaries(repo: string, kind: MapData['kind']): Record<VehicleTier, Uint8Array> {
  const bins = {} as Record<VehicleTier, Uint8Array>;
  for (const t of NAV_TIERS) bins[t] = readGz(repo, navBinPath(kind, t));
  return bins;
}
