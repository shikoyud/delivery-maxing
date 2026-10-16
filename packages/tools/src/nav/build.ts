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

/** An axis-aligned box from `rect` at `y0` up to `top`, as a blocker solid. */
function blockerBox(id: string, r: Rect, y0: number, top: number): Solid {
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

/**
 * The parts of a switchback's deck whose top is less than `rise` above the band-gap floor (y0), as ground rects: the
 * entry stub (on the floor), the foot of the first leg up to where it has climbed `rise`, and the hairpin and the
 * low end of the second leg if they are that low. Everything else of the deck passes over a floor blocker that is
 * lower than `rise` minus the deck's thickness.
 */
export function floorDeckParts(c: Connector, rise: number, city: CityConfig = cityConfig): Rect[] {
  const sw = city.switchback;
  const g = switchbackGeometry(c, sw);
  const half = sw.width / 2;
  const [za, zb] = g.legZ;
  const xe = g.xs + g.run;
  const midRise = g.mid - c.y0;
  const out: Rect[] = [{ minX: c.x - half, maxX: c.x + half, minZ: c.z0, maxZ: za + half }];
  // leg 1 climbs midRise over its run from xs; leg 2 climbs from the hairpin (mid) back west to y1
  out.push({ minX: g.xs, maxX: g.xs + Math.min(g.run, (g.run * rise) / midRise), minZ: za - half, maxZ: za + half });
  if (midRise < rise) {
    out.push({ minX: xe, maxX: g.xEast, minZ: za - half, maxZ: zb + half });
    const leg2 = (g.run * (rise - midRise)) / (c.y1 - g.mid);
    out.push({ minX: Math.max(g.xs, xe - leg2), maxX: xe, minZ: zb - half, maxZ: zb + half });
  }
  return out;
}

/**
 * The floor rects of the city areas `tier` is kept off (nav.forbiddenAreasByTier), each with its area, its floor
 * height `y` and the blocker's `top`: sand, pier and marina whole, nav.blockerHeight high; a band gap as a
 * nav.gapFloorBlocker slab over its whole floor, under the switchback decks too, minus the deck parts that lie on or
 * near the floor (`floorDeckParts`: the car's way in). Empty on the greybox.
 */
export function forbiddenAreaRects(
  map: MapData,
  tier: VehicleTier,
  nav: NavConfig = navConfig,
  city: CityConfig = cityConfig,
): { id: string; rect: Rect; y: number; top: number }[] {
  if (map.kind !== 'city') return [];
  const kinds = new Set(nav.forbiddenAreasByTier[tier]);
  const { layout } = map as CityMap;
  const gb = nav.gapFloorBlocker;
  const onFloor = layout.connectors
    .filter((c) => c.kind === 'switchback')
    .flatMap((c) => floorDeckParts(c, gb.height + city.switchback.thickness + gb.deckClearance, city));
  return layout.areas
    .filter((a) => kinds.has(a.kind))
    .flatMap((a) => {
      const gap = a.kind === 'bandGap';
      const top = a.y + (gap ? gb.height : nav.blockerHeight);
      return (gap ? subtractRects(a.rect, onFloor) : [a.rect]).map((rect, i) => ({ id: `${a.id}-${i}`, rect, y: a.y, top }));
    });
}

/** One blocker box per forbidden area rect (`forbiddenAreaRects`), from the floor up to its top. */
export function areaBlockers(map: MapData, tier: VehicleTier, nav: NavConfig = navConfig): Solid[] {
  return forbiddenAreaRects(map, tier, nav).map((a) => blockerBox(`blocker-${a.id}`, a.rect, a.y, a.top));
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
  const areas = areaBlockers(map, tier, nav);
  // a blocker thinner than one fill layer would leave the floor under it walkable
  const thin = areas.find((b) => b.size.y <= layerVoxels * ch);
  if (thin) throw new Error(`navmesh ${tier}: blocker ${thin.id} is ${thin.size.y} m high, not above one ${layerVoxels * ch} m fill layer`);
  const blockers = [...zoneBlockers(map, tier, nav), ...areas];
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
