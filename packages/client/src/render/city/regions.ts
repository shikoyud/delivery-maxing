import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AreaKind, CityLayout, CityMap, MapData, Rect, Solid, SolidKind } from '@dm/shared';
import { gridTexture, solidColor, solidGeometry, solidMatrix } from '../greyboxMeshes';
import { cityPalette } from '../palette';

/** `"rx,rz"`: the square render region of side `size` containing (x, z), region (0,0) covering [0, size). */
export function regionOf(x: number, z: number, size: number): string {
  return `${Math.floor(x / size)},${Math.floor(z / size)}`;
}

// Art dimensions (metres).
/** Sidewalk strip width: this share of the deck's short side, at most SIDEWALK_MAX. */
const SIDEWALK_SHARE = 0.15;
const SIDEWALK_MAX = 2;
/** The strip stands this high on the deck (a kerb). */
const SIDEWALK_HEIGHT = 0.04;
/** A layout street is drawn as a slab this thick lifted ROAD_LIFT off its ground (the ground slab is its collider). */
const ROAD_LIFT = 0.02;
const ROAD_THICKNESS = 0.04;
/**
 * Depth layers (polygonOffset factor and units): what lies on something must win its depth test however small the
 * gap, so the ground is pushed back furthest, the terrain and the flat areas (parks, lots, the quay…) less, the
 * decks, walls, lot boxes and pack models not at all, and the layout streets are pulled nearer still. Every drawn
 * surface is then higher than what it covers AND in a nearer (or the same) layer, so the depth test cannot pick
 * the wrong one however far away. Without this the 0.8–2 cm gaps between the slabs fall under the depth precision
 * a few hundred metres out, and they flicker (the SP5 playtest's striped streets). cityFlats.test scans the city.
 */
export const DEPTH_LAYER = {
  /** Layout streets: their deck lies over the lane mouths and decks that cross their edges. */
  streets: -1,
  solids: 0,
  /** Flat areas: the top tier (what lies on other areas) at 1, each tier below it one further back. */
  flats: (tier: number, maxTier: number): number => 1 + (maxTier - tier),
  /** Terrain blocks (band-gap floors, cliffs, the beach): behind every flat, in front of the ground they lie on. */
  terrain: (maxTier: number): number => 2 + maxTier,
  /** The ground slabs: behind everything. */
  ground: (maxTier: number): number => 3 + maxTier,
} as const;
/** Flat ground areas (parks, plazas…) sit under the streets. */
export const AREA_LIFT = 0.001;
export const AREA_THICKNESS = 0.002;
/**
 * The lowest up-facing surface any placed pack model has above its lot (the ground plate of House_49…52 at 10 mm):
 * every flat tier tops out under it, so a model is never buried in the slab it stands on (cityFlats.test checks the city).
 */
export const MODEL_BASE_MIN = 0.01;

/** Solids drawn by others: lots are the block meshes (blockMeshes.ts), hospital blocks hospitalMeshes.ts. */
const NOT_REGION: ReadonlySet<SolidKind> = new Set(['building', 'prop', 'hospital']);
/** Solid kinds drawn as asphalt with a sidewalk strip along each long side. */
const PAVED: ReadonlySet<SolidKind> = new Set(['road', 'ramp', 'stairs']);
/** Areas with a flat colour of their own (sand, pier and breakwater are terrain solids coloured the same way). */
const AREA_COLORS: Partial<Record<AreaKind, number>> = cityPalette;

const colorOf = (hex: number): THREE.Color => new THREE.Color(hex);

/** A box of size (sx, sy, sz) whose local frame is `m` translated by (x, y, z), filled with `c`. */
function box(sx: number, sy: number, sz: number, x: number, y: number, z: number, c: THREE.Color, m?: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
  if (m) g.applyMatrix4(m);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** The part of `[lo, hi]` left after cutting out `cuts`, as intervals; slivers under 5 cm are dropped. */
export function cutIntervals(lo: number, hi: number, cuts: readonly [number, number][]): [number, number][] {
  let out: [number, number][] = [[lo, hi]];
  for (const [a, b] of cuts) {
    const next: [number, number][] = [];
    for (const [s, e] of out) {
      if (b <= s || a >= e) next.push([s, e]);
      else {
        if (a > s) next.push([s, a]);
        if (b < e) next.push([b, e]);
      }
    }
    out = next;
  }
  return out.filter(([s, e]) => e - s >= 0.05);
}

/**
 * Two kerb strips on top of a deck of size (sx, sy, sz) in the frame `m`, along its long sides. `crossing` rects (in
 * the deck's local frame, centred on it) cut the strips where another road at the same level crosses, so no kerb
 * runs across an intersection.
 */
function sidewalkStrips(sx: number, sy: number, sz: number, m?: THREE.Matrix4, baseY = 0, crossing: readonly Rect[] = []): THREE.BufferGeometry[] {
  const c = colorOf(cityPalette.sidewalk);
  const alongX = sx >= sz;
  const short = alongX ? sz : sx;
  const long = alongX ? sx : sz;
  const w = Math.min(SIDEWALK_MAX, short * SIDEWALK_SHARE);
  const off = short / 2 - w / 2;
  const y = baseY + sy / 2 + SIDEWALK_HEIGHT / 2;
  const out: THREE.BufferGeometry[] = [];
  for (const k of [-1, 1]) {
    // the strip's across-range; a crossing rect cuts it only where it reaches into that range
    const [aLo, aHi] = [k * off - w / 2, k * off + w / 2];
    const cuts = crossing
      .filter((r) => (alongX ? r.minZ < aHi && r.maxZ > aLo : r.minX < aHi && r.maxX > aLo))
      .map((r): [number, number] => (alongX ? [r.minX, r.maxX] : [r.minZ, r.maxZ]));
    for (const [s, e] of cutIntervals(-long / 2, long / 2, cuts)) {
      const mid = (s + e) / 2;
      out.push(alongX ? box(e - s, SIDEWALK_HEIGHT, w, mid, y, k * off, c, m) : box(w, SIDEWALK_HEIGHT, e - s, k * off, y, mid, c, m));
    }
  }
  return out;
}

/** A paved solid (road deck, ramp, stair step): asphalt plus its two sidewalk strips, rotated with the solid. */
function pavedGeometry(s: Solid): THREE.BufferGeometry[] {
  // drawn ROAD_LIFT above its collider, like a street: above the flats it borders, under a street deck it crosses
  const m = new THREE.Matrix4().makeTranslation(0, ROAD_LIFT, 0).multiply(solidMatrix(s));
  return [box(s.size.x, s.size.y, s.size.z, 0, 0, 0, colorOf(cityPalette.asphalt), m), ...sidewalkStrips(s.size.x, s.size.y, s.size.z, m)];
}

/** A flat slab over `rect` from `y0` up `thickness`. */
function flat(rect: Rect, y0: number, thickness: number, c: THREE.Color): THREE.BufferGeometry {
  const sx = rect.maxX - rect.minX;
  const sz = rect.maxZ - rect.minZ;
  return box(sx, thickness, sz, (rect.minX + rect.maxX) / 2, y0 + thickness / 2, (rect.minZ + rect.maxZ) / 2, c);
}

/**
 * A layout street (its collider is the ground slab under it): an asphalt slab and its sidewalk strips, the strips
 * cut where `crossing` roads at the same level overlap it (the SP5 playtest: kerbs ran across every intersection).
 */
function streetGeometry(rect: Rect, y: number, crossing: readonly Rect[] = []): THREE.BufferGeometry[] {
  const sx = rect.maxX - rect.minX;
  const sz = rect.maxZ - rect.minZ;
  const [cx, cz] = rectCenter(rect);
  const m = new THREE.Matrix4().makeTranslation(cx, y + ROAD_LIFT + ROAD_THICKNESS / 2, cz);
  const local = crossing.map((r): Rect => ({ minX: r.minX - cx, maxX: r.maxX - cx, minZ: r.minZ - cz, maxZ: r.maxZ - cz }));
  return [box(sx, ROAD_THICKNESS, sz, 0, 0, 0, colorOf(cityPalette.asphalt), m), ...sidewalkStrips(sx, ROAD_THICKNESS, sz, m, 0, local)];
}

const rectCenter = (r: Rect): [number, number] => [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2];

const rectsOverlap = (r: Rect, s: Rect): boolean => r.minX < s.maxX && s.minX < r.maxX && r.minZ < s.maxZ && s.minZ < r.maxZ;
const rectArea = (r: Rect): number => (r.maxX - r.minX) * (r.maxZ - r.minZ);

/**
 * Areas may lie on one another at the same height (the rail, the container yard and a gas lot sit on the quay), and
 * two slabs at one height fight in the depth buffer at any distance (the SP5 playtest's striped docks). Each area
 * gets a tier: 0 for the largest, one more than the highest tier of any larger area it overlaps at its height, so
 * the smaller area is always drawn a lift step above what it lies on.
 */
export function areaTiers(areas: readonly CityLayout['areas'][number][]): [CityLayout['areas'][number], number][] {
  const sorted = [...areas].sort((a, b) => rectArea(b.rect) - rectArea(a.rect));
  const tiers: [CityLayout['areas'][number], number][] = [];
  for (const a of sorted) {
    let tier = 0;
    for (const [b, t] of tiers) if (b.y === a.y && rectsOverlap(a.rect, b.rect)) tier = Math.max(tier, t + 1);
    tiers.push([a, tier]);
  }
  return tiers;
}

/** A city map carries its layout (layoutToMap); a greybox has none. */
const isCityMap = (map: MapData): map is CityMap => map.kind === 'city' && 'layout' in map;

/**
 * The code-built city geometry merged per render region of side `regionSize` (each piece goes to the region holding
 * its centre). A region is one group of up to two meshes: `region-solids` (vertex-coloured, casting shadows) and
 * `region-ground` (the ground slabs with the SP1 grid texture). Region geometry is every solid but the lots
 * (buildings and props: the block meshes) and hospital blocks: roads, ramps and stairs as asphalt with a lighter
 * sidewalk strip along each long side, terrain green-grey (sand, pier and breakwater areas in their own colours),
 * parapets, the water floor flat blue. On a city map the layout's streets, which have no solid of their own (the
 * ground slab is their collider), are drawn on the ground the same way, over its flat-coloured areas (parks, plazas…).
 */
export function buildRegionMeshes(map: MapData, regionSize: number): Map<string, THREE.Group> {
  const layout: CityLayout | undefined = isCityMap(map) ? map.layout : undefined;
  const areaKind = new Map<string, AreaKind>(layout?.areas.map((a) => [a.id, a.kind]) ?? []);
  type Parts = { streets: THREE.BufferGeometry[]; solids: THREE.BufferGeometry[]; flats: THREE.BufferGeometry[][]; terrain: THREE.BufferGeometry[]; ground: THREE.BufferGeometry[] };
  const parts = new Map<string, Parts>();
  const entry = (x: number, z: number): Parts => {
    const key = regionOf(x, z, regionSize);
    let e = parts.get(key);
    if (!e) parts.set(key, (e = { streets: [], solids: [], flats: [], terrain: [], ground: [] }));
    return e;
  };
  // areas with a terrain solid of their own (sand, pier, breakwater, the cliffs) are coloured on that solid, not drawn flat
  const solidIds = new Set(map.solids.map((s) => s.id));
  const hasSolid = (areaId: string): boolean => solidIds.has(areaId) || solidIds.has(`${areaId}-terrain`);

  for (const s of map.solids) {
    if (NOT_REGION.has(s.kind)) continue;
    const e = entry(s.center.x, s.center.z);
    if (s.kind === 'ground') e.ground.push(solidGeometry(s));
    else if (PAVED.has(s.kind)) e.solids.push(...pavedGeometry(s));
    else {
      const area = areaKind.get(s.id);
      const own = area ? AREA_COLORS[area] : undefined;
      // terrain blocks (band-gap floors, cliffs, the beach) lie under decks and areas: behind them in depth, like the ground
      (s.kind === 'terrain' ? e.terrain : e.solids).push(solidGeometry(s, own !== undefined ? colorOf(own) : solidColor(s)));
    }
  }
  const tiers = areaTiers(layout?.areas ?? []);
  const maxTier = Math.max(0, ...tiers.map(([, t]) => t));
  for (const [a, tier] of tiers) {
    const c = AREA_COLORS[a.kind];
    if (c === undefined) continue;
    if (hasSolid(a.id)) continue;
    const e = entry(...rectCenter(a.rect));
    (e.flats[tier] ??= []).push(flat(a.rect, a.y + AREA_LIFT + tier * (AREA_LIFT + AREA_THICKNESS), AREA_THICKNESS, colorOf(c)));
  }
  const roads = layout?.roads ?? [];
  for (const r of roads) {
    const crossing = roads.filter((o) => o !== r && o.y === r.y && rectsOverlap(o.rect, r.rect)).map((o) => o.rect);
    entry(...rectCenter(r.rect)).streets.push(...streetGeometry(r.rect, r.y, crossing));
  }

  const layered = (layer: number, map: THREE.Texture | null = null): THREE.MeshLambertMaterial =>
    new THREE.MeshLambertMaterial({ vertexColors: true, map, polygonOffset: layer !== 0, polygonOffsetFactor: layer, polygonOffsetUnits: layer });
  const streetsMaterial = layered(DEPTH_LAYER.streets);
  const solidsMaterial = layered(DEPTH_LAYER.solids);
  const flatsMaterials = Array.from({ length: maxTier + 1 }, (_, tier) => layered(DEPTH_LAYER.flats(tier, maxTier)));
  const terrainMaterial = layered(DEPTH_LAYER.terrain(maxTier));
  const groundMaterial = layered(DEPTH_LAYER.ground(maxTier), gridTexture());
  const out = new Map<string, THREE.Group>();
  for (const [key, { streets, solids, flats, terrain, ground }] of parts) {
    const group = new THREE.Group();
    group.name = `region ${key}`;
    const layers: readonly (readonly [string, THREE.BufferGeometry[], THREE.Material, boolean])[] = [
      ['region-streets', streets, streetsMaterial, false], // a 4 cm slab on the ground: no shadow worth a pass
      ['region-solids', solids, solidsMaterial, true],
      // an 8 mm slab casts nothing worth a shadow pass
      ...flatsMaterials.map((m, tier) => [`region-flats-${tier}`, flats[tier] ?? [], m, false] as const),
      ['region-terrain', terrain, terrainMaterial, true],
      ['region-ground', ground, groundMaterial, false],
    ];
    for (const [name, geoms, material, castShadow] of layers) {
      if (geoms.length === 0) continue;
      const merged = mergeGeometries(geoms, false);
      for (const g of geoms) g.dispose();
      if (!merged) throw new Error(`region ${key}: ${name} geometries could not be merged`);
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = name;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    out.set(key, group);
  }
  return out;
}
