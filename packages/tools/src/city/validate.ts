import {
  accessAllowed,
  cityConfig,
  NAV_TIERS,
  navConfig,
  type CatalogIndex,
  type CityConfig,
  type CityLayout,
  type CityMap,
  type Level,
  type Lot,
  type NavConfig,
  type NavRouter,
  type Rect,
  type Vec3,
  type VehicleTier,
} from '@dm/shared';
import { forbiddenAreaRects } from '../nav/build';
import { validateMapNav } from '../nav/validate';

// The city's checks, run by `pnpm map:check`: validateLayout on map/city.layout.json, validateCityNav on the city's
// committed navmeshes (the SP4 checks of validateMapNav, plus the city's own).

const EPS = 1e-6;
const fmt = (p: Vec3): string => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`;
const inside = (r: Rect, x: number, z: number, e = EPS): boolean => x > r.minX + e && x < r.maxX - e && z > r.minZ + e && z < r.maxZ - e;
const within = (r: Rect, outer: Rect): boolean =>
  r.minX >= outer.minX - EPS && r.maxX <= outer.maxX + EPS && r.minZ >= outer.minZ - EPS && r.maxZ <= outer.maxZ + EPS;
const overlap = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;

/** The distance from (x, z) to rect `r` on the ground plane (0 inside). */
function rectDistance(r: Rect, x: number, z: number): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

/** Pairs of overlapping rects among `items`, by a sweep along x. */
function overlappingPairs<T extends { rect: Rect }>(items: readonly T[]): [T, T][] {
  const sorted = [...items].sort((a, b) => a.rect.minX - b.rect.minX);
  const out: [T, T][] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length && sorted[j]!.rect.minX < a.rect.maxX - EPS; j++) {
      if (overlap(a.rect, sorted[j]!.rect)) out.push([a, sorted[j]!]);
    }
  }
  return out;
}

/** Where a lot's front door belongs: centred on its `facing` edge, `offset` outside the rect, at its base height. */
function expectedDoor(lot: Lot, offset: number): Vec3 {
  const r = lot.rect;
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  const [x, z] = { S: [cx, r.minZ - offset], N: [cx, r.maxZ + offset], E: [r.maxX + offset, cz], W: [r.minX - offset, cz] }[lot.facing] as [number, number];
  return { x, y: lot.y, z };
}

/**
 * Every problem of a city layout, one message each: a duplicate id (one namespace for blocks, lots, roads, curved
 * roads, connectors, areas, hospitals and gas stations); a lot whose asset is not in the catalog; two lots that
 * overlap; a lot on a road (a rect road, or within half a curved road's width of its centre line); a lot off its
 * level or band (outside its block, on another level than its block, a block outside its level's z range or, for a
 * slope block, outside the band above its level, or a base height other than its level's or the area it stands on);
 * a door off the sidewalk (a front door not `door.offset` outside its lot's facing edge at the lot's height, an upper
 * door not on its lot's edge on the upper level's ground (a level, or a band's terrace top at y1), or either inside another lot).
 */
export function validateLayout(layout: CityLayout, cat: CatalogIndex, city: CityConfig = cityConfig): string[] {
  const messages: string[] = [];

  const seen = new Map<string, string>();
  const collections = ['blocks', 'lots', 'roads', 'curvedRoads', 'connectors', 'areas', 'hospitals', 'gasStations'] as const;
  for (const key of collections) {
    for (const item of layout[key] as { id: string }[]) {
      const first = seen.get(item.id);
      if (first) messages.push(`${item.id}: duplicate id (in ${first} and ${key})`);
      else seen.set(item.id, key);
    }
  }

  for (const lot of layout.lots) if (!cat.has(lot.asset)) messages.push(`${lot.id}: asset ${lot.asset} is not in the catalog`);

  for (const [a, b] of overlappingPairs(layout.lots)) messages.push(`${a.id} and ${b.id}: lots overlap`);

  const roads = overlappingPairs<{ id: string; rect: Rect; road: boolean }>([
    ...layout.lots.map((l) => ({ id: l.id, rect: l.rect, road: false })),
    ...layout.roads.map((r) => ({ id: r.id, rect: r.rect, road: true })),
  ]);
  for (const [a, b] of roads) {
    if (a.road !== b.road) messages.push(`${a.road ? b.id : a.id}: lot is on road ${a.road ? a.id : b.id}`);
  }
  for (const road of layout.curvedRoads) {
    for (const lot of layout.lots) {
      const hit = road.polyline.slice(1).some((b, i) => {
        const a = road.polyline[i]!;
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
        for (let k = 0; k <= n; k++) {
          if (rectDistance(lot.rect, a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n) < road.width / 2 - 0.01) return true;
        }
        return false;
      });
      if (hit) messages.push(`${lot.id}: lot is on road ${road.id}`);
    }
  }

  const blocks = new Map(layout.blocks.map((b) => [b.id, b]));
  const bandAbove = (level: Level) => Object.values(layout.bands).find((b) => Math.abs(b.y0 - layout.levels[level].y) < EPS);
  for (const b of layout.blocks) {
    const lv = layout.levels[b.level];
    const band = b.district === 'slope' ? bandAbove(b.level) : undefined;
    const [z0, z1] = band ? [band.z0, band.z1] : [lv.z0, lv.z1];
    if (b.rect.minZ < z0 - EPS || b.rect.maxZ > z1 + EPS) {
      messages.push(`${b.id}: block z ${b.rect.minZ}..${b.rect.maxZ} is off its ${band ? 'band' : 'level'} ${b.level} (${z0}..${z1})`);
    }
  }
  for (const lot of layout.lots) {
    const b = blocks.get(lot.block);
    if (!b) {
      messages.push(`${lot.id}: block ${lot.block} does not exist`);
      continue;
    }
    if (b.level !== lot.level) messages.push(`${lot.id}: lot on level ${lot.level} in block ${b.id} on level ${b.level}`);
    if (!within(lot.rect, b.rect)) messages.push(`${lot.id}: lot is off its block ${b.id} (its level or band)`);
    const cx = (lot.rect.minX + lot.rect.maxX) / 2;
    const cz = (lot.rect.minZ + lot.rect.maxZ) / 2;
    const ground = layout.levels[lot.level].y;
    const onArea = layout.areas.some((a) => Math.abs(a.y - lot.y) < EPS && inside(a.rect, cx, cz, 0));
    if (Math.abs(lot.y - ground) > EPS && !onArea) messages.push(`${lot.id}: base height ${lot.y} is off its level ${lot.level} (${ground})`);
  }

  const offset = city.door.offset;
  const closed = layout.lots.filter((l) => !l.open);
  const inOtherLot = (lot: Lot, p: Vec3): Lot | undefined => closed.find((o) => o.id !== lot.id && Math.abs(o.y - p.y) < 30 && inside(o.rect, p.x, p.z, 0.01));
  for (const lot of layout.lots) {
    if (lot.door) {
      const want = expectedDoor(lot, offset);
      const d = Math.hypot(lot.door.x - want.x, lot.door.y - want.y, lot.door.z - want.z);
      if (d > 0.01) messages.push(`${lot.id}: door ${fmt(lot.door)} is off the sidewalk (expected ${fmt(want)}, ${offset} m outside its ${lot.facing} edge)`);
      const other = inOtherLot(lot, lot.door);
      if (other) messages.push(`${lot.id}: door ${fmt(lot.door)} is inside lot ${other.id}`);
    }
    if (lot.upperDoor) {
      const p = lot.upperDoor.position;
      const r = lot.rect;
      const onEdge = rectDistance(r, p.x, p.z) < 0.01 && !inside(r, p.x, p.z, 0.01);
      // the upper level's ground: a level, or the terrace top of a band (its terrain is y1 high from z0 to z1)
      const grounds = [...Object.values(layout.levels), ...Object.values(layout.bands).map((b) => ({ y: b.y1, z0: b.z0, z1: b.z1 }))];
      const ground = grounds.find((g) => Math.abs(g.y - p.y) < EPS && p.z >= g.z0 - EPS && p.z <= g.z1 + EPS);
      if (!onEdge || !ground || Math.abs(lot.upperDoor.y - p.y) > EPS) {
        messages.push(`${lot.id}: upper door ${fmt(p)} is off the sidewalk (not on its lot's edge on the upper level's ground)`);
      }
      const other = inOtherLot(lot, p);
      if (other) messages.push(`${lot.id}: upper door ${fmt(p)} is inside lot ${other.id}`);
    }
  }
  return messages;
}

/** A sample grid over `r`, about `step` apart: each cell's centre and half size. */
function grid(r: Rect, step: number): { x: number; z: number; hx: number; hz: number }[] {
  const nx = Math.max(1, Math.ceil((r.maxX - r.minX) / step));
  const nz = Math.max(1, Math.ceil((r.maxZ - r.minZ) / step));
  const [hx, hz] = [(r.maxX - r.minX) / nx / 2, (r.maxZ - r.minZ) / nz / 2];
  const out = [];
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) out.push({ x: r.minX + (2 * i + 1) * hx, z: r.minZ + (2 * k + 1) * hz, hx, hz });
  return out;
}

/** An avenue point of each level (the centre of its first avenue; Hillcrest Drive's middle vertex on the ridge). */
function levelPoints(map: CityMap): { level: Level; at: Vec3 }[] {
  const { layout } = map;
  const out: { level: Level; at: Vec3 }[] = [];
  for (const level of Object.keys(layout.levels) as Level[]) {
    const lv = layout.levels[level];
    const ave = layout.roads.find((r) => r.kind === 'avenue' && Math.abs(r.y - lv.y) < EPS && r.rect.minZ >= lv.z0 && r.rect.maxZ <= lv.z1);
    if (ave) {
      out.push({ level, at: { x: (ave.rect.minX + ave.rect.maxX) / 2, y: ave.y, z: (ave.rect.minZ + ave.rect.maxZ) / 2 } });
      continue;
    }
    const drive = layout.curvedRoads.find((r) => r.polyline.some((p) => p.z >= lv.z0 && p.z <= lv.z1));
    if (drive) out.push({ level, at: drive.polyline[Math.floor(drive.polyline.length / 2)]! });
  }
  return out;
}

/**
 * Every navigation problem of the city on `router`'s meshes, one message each: the SP4 checks (`validateMapNav`), and
 *  - a polygon of a tier's mesh inside an access zone the tier may not enter, or on a city area it is kept off
 *    (nav.forbiddenAreasByTier: the car on sand, the pier, the marina or a band-gap floor), sampled on a
 *    nav.forbiddenSampleStep grid: the closest point of the mesh to each sample, within the sample's cell and the
 *    zone's height range, must be null or outside the zone;
 *  - a level whose avenue is not reachable by car from every other level's avenue (or has no avenue point);
 *  - an upper door off the walk mesh (its reachability from the hospitals is an SP4 check);
 *  - a band gap whose centre is off the walk mesh, not reachable on foot from the nearest hospital spawn, or from which
 *    that spawn or the upper level's avenue is not reachable on foot (a courier who fell in walks out: Review Focus 3).
 */
export function validateCityNav(map: CityMap, router: NavRouter, nav: NavConfig = navConfig): string[] {
  const messages = validateMapNav(map, router, nav);
  const tol = nav.reachTolerance;
  const onMesh = (tier: VehicleTier, p: Vec3): Vec3 | null => {
    const q = router.closestPoint(tier, p);
    return q && Math.hypot(q.x - p.x, q.z - p.z) <= tol && Math.abs(q.y - p.y) <= tol ? q : null;
  };

  for (const tier of NAV_TIERS) {
    const regions = [
      ...map.accessZones.filter((z) => !accessAllowed(tier, z.kind)).map((z) => ({ what: `${z.kind} zone ${z.id}`, rect: z.rect, minY: z.minY, maxY: z.maxY })),
      ...forbiddenAreaRects(map, tier, nav).map((a) => ({ what: `area ${a.id}`, rect: a.rect, minY: a.y, maxY: a.y })),
    ];
    for (const r of regions) {
      const midY = (r.minY + r.maxY) / 2;
      const hy = (r.maxY - r.minY) / 2 + 0.5;
      for (const s of grid(r.rect, nav.forbiddenSampleStep)) {
        const q = router.closestPoint(tier, { x: s.x, y: midY, z: s.z }, { x: s.hx, y: hy, z: s.hz });
        if (q && inside(r.rect, q.x, q.z, 0.05) && q.y >= r.minY - 0.5 && q.y <= r.maxY + 0.5) {
          messages.push(`${tier} mesh has a polygon inside ${r.what} at ${fmt(q)}`);
          break;
        }
      }
    }
  }

  const levels = levelPoints(map);
  for (const level of Object.keys(map.layout.levels)) {
    if (!levels.some((l) => l.level === level)) messages.push(`level ${level}: no avenue point to check car reachability from`);
  }
  const carAt = levels.map((l) => ({ ...l, on: onMesh('car', l.at) }));
  for (const a of carAt) if (!a.on) messages.push(`level ${a.level}: avenue point ${fmt(a.at)} is not on the car mesh`);
  for (const a of carAt) {
    for (const b of carAt) {
      if (a === b || !a.on || !b.on) continue;
      if (!Number.isFinite(router.distance('car', a.on, b.on))) messages.push(`level ${b.level}: avenue not reachable by car from the level ${a.level} avenue`);
    }
  }

  for (const p of map.pois.filter((q) => q.upper)) {
    if (!onMesh('walk', p.position)) messages.push(`${p.id}: upper door ${fmt(p.position)} is not on the walk mesh`);
  }

  for (const gap of map.layout.areas.filter((a) => a.kind === 'bandGap')) {
    const c = { x: (gap.rect.minX + gap.rect.maxX) / 2, y: gap.y, z: (gap.rect.minZ + gap.rect.maxZ) / 2 };
    const at = onMesh('walk', c);
    if (!at) {
      messages.push(`${gap.id}: band-gap centre ${fmt(c)} is not on the walk mesh`);
      continue;
    }
    const h = [...map.hospitals].sort((p, q) => Math.hypot(p.spawn.x - c.x, p.spawn.z - c.z) - Math.hypot(q.spawn.x - c.x, q.spawn.z - c.z))[0];
    if (h) {
      if (!Number.isFinite(router.distance('walk', h.spawn, at))) messages.push(`${gap.id}: band-gap centre not reachable on foot from the ${h.id} spawn`);
      if (!Number.isFinite(router.distance('walk', at, h.spawn))) messages.push(`${gap.id}: the ${h.id} spawn not reachable on foot from the band-gap centre`);
    }
    const band = Object.values(map.layout.bands).find((b) => gap.rect.minZ >= b.z0 - EPS && gap.rect.maxZ <= b.z1 + EPS);
    const upper = band && levels.find((l) => Math.abs(map.layout.levels[l.level].y - band.y1) < EPS);
    const up = upper && onMesh('walk', upper.at);
    if (up && !Number.isFinite(router.distance('walk', at, up))) messages.push(`${gap.id}: the level ${upper.level} avenue not reachable on foot from the band-gap centre`);
  }
  return messages;
}

