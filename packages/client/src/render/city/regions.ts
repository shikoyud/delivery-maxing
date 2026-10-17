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
/** Depth-buffer push of the ground slabs (polygonOffset factor and units) so what lies flat on them wins the depth test. */
const GROUND_DEPTH_OFFSET = 2;
/** Flat ground areas (parks, plazas…) sit under the streets. */
const AREA_LIFT = 0.008;
const AREA_THICKNESS = 0.008;

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

/** Two kerb strips on top of a deck of size (sx, sy, sz) in the frame `m`, along its long sides. */
function sidewalkStrips(sx: number, sy: number, sz: number, m?: THREE.Matrix4, baseY = 0): THREE.BufferGeometry[] {
  const c = colorOf(cityPalette.sidewalk);
  const alongX = sx >= sz;
  const short = alongX ? sz : sx;
  const w = Math.min(SIDEWALK_MAX, short * SIDEWALK_SHARE);
  const off = short / 2 - w / 2;
  const y = baseY + sy / 2 + SIDEWALK_HEIGHT / 2;
  return [-1, 1].map((k) =>
    alongX ? box(sx, SIDEWALK_HEIGHT, w, 0, y, k * off, c, m) : box(w, SIDEWALK_HEIGHT, sz, k * off, y, 0, c, m),
  );
}

/** A paved solid (road deck, ramp, stair step): asphalt plus its two sidewalk strips, rotated with the solid. */
function pavedGeometry(s: Solid): THREE.BufferGeometry[] {
  const m = solidMatrix(s);
  return [box(s.size.x, s.size.y, s.size.z, 0, 0, 0, colorOf(cityPalette.asphalt), m), ...sidewalkStrips(s.size.x, s.size.y, s.size.z, m)];
}

/** A flat slab over `rect` from `y0` up `thickness`. */
function flat(rect: Rect, y0: number, thickness: number, c: THREE.Color): THREE.BufferGeometry {
  const sx = rect.maxX - rect.minX;
  const sz = rect.maxZ - rect.minZ;
  return box(sx, thickness, sz, (rect.minX + rect.maxX) / 2, y0 + thickness / 2, (rect.minZ + rect.maxZ) / 2, c);
}

/** A layout street (its collider is the ground slab under it): an asphalt slab and its sidewalk strips. */
function streetGeometry(rect: Rect, y: number): THREE.BufferGeometry[] {
  const sx = rect.maxX - rect.minX;
  const sz = rect.maxZ - rect.minZ;
  const m = new THREE.Matrix4().makeTranslation((rect.minX + rect.maxX) / 2, y + ROAD_LIFT + ROAD_THICKNESS / 2, (rect.minZ + rect.maxZ) / 2);
  return [box(sx, ROAD_THICKNESS, sz, 0, 0, 0, colorOf(cityPalette.asphalt), m), ...sidewalkStrips(sx, ROAD_THICKNESS, sz, m)];
}

const rectCenter = (r: Rect): [number, number] => [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2];

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
  const parts = new Map<string, { solids: THREE.BufferGeometry[]; ground: THREE.BufferGeometry[] }>();
  const entry = (x: number, z: number) => {
    const key = regionOf(x, z, regionSize);
    let e = parts.get(key);
    if (!e) parts.set(key, (e = { solids: [], ground: [] }));
    return e;
  };

  for (const s of map.solids) {
    if (NOT_REGION.has(s.kind)) continue;
    const e = entry(s.center.x, s.center.z);
    if (s.kind === 'ground') e.ground.push(solidGeometry(s));
    else if (PAVED.has(s.kind)) e.solids.push(...pavedGeometry(s));
    else {
      const area = areaKind.get(s.id);
      const own = area ? AREA_COLORS[area] : undefined;
      e.solids.push(solidGeometry(s, own !== undefined ? colorOf(own) : solidColor(s)));
    }
  }
  for (const a of layout?.areas ?? []) {
    const c = AREA_COLORS[a.kind];
    if (c === undefined) continue;
    if (a.kind === 'sand' || a.kind === 'pier' || a.kind === 'breakwater') continue; // terrain solids, coloured above
    entry(...rectCenter(a.rect)).solids.push(flat(a.rect, a.y + AREA_LIFT, AREA_THICKNESS, colorOf(c)));
  }
  for (const r of layout?.roads ?? []) entry(...rectCenter(r.rect)).solids.push(...streetGeometry(r.rect, r.y));

  const solidsMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  // The ground is pushed back in the depth buffer: the streets and areas lie only 0.8–2 cm above it, less than the
  // depth precision a few hundred metres out, and would otherwise flicker against it (the SP5 playtest's road flicker).
  const groundMaterial = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: gridTexture(),
    polygonOffset: true,
    polygonOffsetFactor: GROUND_DEPTH_OFFSET,
    polygonOffsetUnits: GROUND_DEPTH_OFFSET,
  });
  const out = new Map<string, THREE.Group>();
  for (const [key, { solids, ground }] of parts) {
    const group = new THREE.Group();
    group.name = `region ${key}`;
    for (const [name, geoms, material, castShadow] of [
      ['region-solids', solids, solidsMaterial, true],
      ['region-ground', ground, groundMaterial, false],
    ] as const) {
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
