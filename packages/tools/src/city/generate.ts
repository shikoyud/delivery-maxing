import {
  movementConfig,
  mulberry32,
  worldConfig,
  type BoostOrb,
  type Checkpoint,
  type CityMap,
  type District,
  type JumpPad,
  type MovementConfig,
  type NavLink,
  type PieceCatalog,
  type PieceEntry,
  type PoiKind,
  type Prop,
  type Rail,
  type Rect,
  type Rng,
  type Solid,
  type StreetEdge,
  type StreetNode,
  type Vec3,
  type ZipLine,
} from '@dm/shared';
import { cliffs, groundTiles, quays } from './boundary';
import { buildHub } from './hub';
import { type ArterialLines, arterialLines, gridLines, intersectRect, landRect, r2, type GridLine } from './layout';
import { type FillerParams, fillLot, type Lot } from './lots';
import type { CitySource, StreetStyle, Template } from './source';
import { arterialGraph, GraphBuilder, mergeStreetGraphs, streetSolids } from './streets';

/** A place a POI could go; Task 13 picks the POIs from these. */
export interface PoiSlot { position: Vec3; kind: PoiKind; elevated: boolean; district: District; access: 'street' | 'kit' | 'route' }

/** City-wide facts every district builder needs, laid down by the generator core. */
export interface CityFrame {
  /** Where streets and lots may go: the map minus cliffs and water. */
  land: Rect;
  arterials: ArterialLines;
  /** Lots keep clear of this circle around the plaza centre. */
  plaza: { center: Vec3; clearRadius: number };
  streets: StreetStyle;
  /** Palette basenames buildings may use. */
  palettes: readonly string[];
  chunkSize: number;
}

export interface DistrictContext {
  district: District;
  rect: Rect;
  rng: Rng;
  pieces: PieceCatalog;
  move: MovementConfig;
  params: Record<string, unknown>;
  city: CityFrame;
}

export interface DistrictOutput {
  solids: Solid[];
  props: Prop[];
  zipLines: ZipLine[];
  jumpPads: JumpPad[];
  boostOrbs: BoostOrb[];
  rails: Rail[];
  checkpoints: Checkpoint[];
  navLinks: NavLink[];
  /** Street graph; road and sidewalk solids for its flat, axis-aligned edges are made by the core. */
  streets: { nodes: StreetNode[]; edges: StreetEdge[] };
  poiSlots: PoiSlot[];
}

const FILLER_NUMBERS = [
  'pitch', 'streetHalfWidth', 'scaleMin', 'scaleMax', 'fillChance', 'setback', 'gapMin', 'gapMax', 'edgeMargin', 'doorOffset',
] as const;

function fillerParams(district: District, params: Record<string, unknown>, pieces: PieceCatalog): FillerParams {
  const fail = (why: string): never => {
    throw new Error(`district ${district}: filler params: ${why}`);
  };
  for (const k of FILLER_NUMBERS) {
    const v = params[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail(`${k} must be a non-negative number`);
  }
  const p = params as unknown as FillerParams;
  if (p.pitch <= 0 || p.scaleMin <= 0 || p.scaleMax < p.scaleMin) fail('need pitch > 0 and 0 < scaleMin ≤ scaleMax');
  if (p.fillChance > 1 || p.gapMax < p.gapMin) fail('need fillChance ≤ 1 and gapMin ≤ gapMax');
  if (!Array.isArray(p.pieces) || p.pieces.length === 0) fail('pieces must list building piece ids');
  for (const id of p.pieces) if (pieces[id]?.kind !== 'building') fail(`${String(id)} is not a building piece`);
  return p;
}

/**
 * The generic district: a local street grid inside the arterials, and every lot between streets filled with rows of
 * buildings facing the streets, with a door slot in front of each.
 */
export function buildFiller(ctx: DistrictContext): DistrictOutput {
  const p = fillerParams(ctx.district, ctx.params, ctx.pieces);
  const { land, arterials, plaza, palettes } = ctx.city;
  const area = intersectRect(ctx.rect, land);
  const local = { pitch: p.pitch, halfWidth: p.streetHalfWidth, edgeMargin: p.edgeMargin };
  const xs = gridLines(area.minX, area.maxX, arterials, 'x', local);
  const zs = gridLines(area.minZ, area.maxZ, arterials, 'z', local);
  for (const [lines, c] of [[xs, plaza.center.x], [zs, plaza.center.z]] as const) {
    for (const l of lines) {
      if (l.kind === 'local' && Math.abs(l.at - c) < plaza.clearRadius + l.inset) {
        throw new Error(`district ${ctx.district}: local street at ${l.at} crosses the plaza`);
      }
    }
  }

  const g = new GraphBuilder(`${ctx.district}-n`);
  for (const x of xs) if (x.kind === 'local') g.street(zs.map((z) => ({ x: x.at, y: 0, z: z.at })), p.streetHalfWidth);
  for (const z of zs) if (z.kind === 'local') g.street(xs.map((x) => ({ x: x.at, y: 0, z: z.at })), p.streetHalfWidth);

  const lots: Lot[] = [];
  const span = (a: GridLine, b: GridLine): [number, number] => [r2(a.at + a.inset), r2(b.at - b.inset)];
  for (let j = 1; j < zs.length; j++) {
    for (let i = 1; i < xs.length; i++) {
      const [xa, xb, za, zb] = [xs[i - 1]!, xs[i]!, zs[j - 1]!, zs[j]!];
      const [minX, maxX] = span(xa, xb);
      const [minZ, maxZ] = span(za, zb);
      if (maxX <= minX || maxZ <= minZ) continue;
      lots.push({
        rect: { minX, minZ, maxX, maxZ },
        streets: { w: xa.kind !== 'edge', e: xb.kind !== 'edge', n: za.kind !== 'edge', s: zb.kind !== 'edge' },
      });
    }
  }

  const pieceList: PieceEntry[] = p.pieces.map((id) => ctx.pieces[id]!);
  let n = 0;
  const fill = { params: p, pieces: pieceList, palettes, plaza: { center: plaza.center, radius: plaza.clearRadius }, newId: () => `${ctx.district}-b${n++}` };
  const placed = lots.flatMap((lot) => fillLot(lot, ctx.rng, fill));

  return {
    solids: placed.flatMap((b) => b.solids),
    props: placed.map((b) => b.prop),
    zipLines: [],
    jumpPads: [],
    boostOrbs: [],
    rails: [],
    checkpoints: [],
    navLinks: [],
    streets: g.graph(),
    poiSlots: placed.map((b) => ({ position: b.door, kind: 'door', elevated: false, district: ctx.district, access: 'street' })),
  };
}

const BUILDERS: Record<Template, (ctx: DistrictContext) => DistrictOutput> = {
  downtown: buildFiller,
  harbor: buildFiller,
  hillside: buildFiller,
  suburbs: buildFiller,
};

/** FNV-1a of the district name mixed with the seed: each district has its own random stream. */
export function districtSeed(seed: number, name: string): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * Expands the city source into the placement file: ground, cliffs and quays, the hub, arterials with a checkpoint at
 * every crossing, then each district's builder output, merged in source order. Deterministic for a given source.
 */
export function generateCity(src: CitySource, pieces: PieceCatalog): CityMap {
  const chunkSize = worldConfig.chunkSize;
  const land = landRect(src);
  const arterials = arterialLines(src, land);
  const hub = buildHub(src);
  const frame: CityFrame = {
    land,
    arterials,
    plaza: { center: hub.hub.center, clearRadius: src.hub.clearRadius },
    streets: src.streets,
    palettes: src.buildingPalettes,
    chunkSize,
  };

  const outputs = src.districts.map((d) =>
    BUILDERS[d.template]({
      district: d.district,
      rect: d.rect,
      rng: mulberry32(districtSeed(src.seed, d.district)),
      pieces,
      move: movementConfig,
      params: d.params,
      city: frame,
    }),
  );
  const all = <K extends keyof DistrictOutput>(k: K): DistrictOutput[K] =>
    outputs.flatMap((o) => o[k] as unknown[]) as DistrictOutput[K];

  const streets = mergeStreetGraphs([arterialGraph(land, arterials, hub.hub, src.hub.clearRadius), ...outputs.map((o) => o.streets)]);

  const c = hub.hub.center;
  const crossings: Checkpoint[] = [];
  for (const z of arterials.zs) {
    for (const x of arterials.xs) {
      if (Math.hypot(x - c.x, z - c.z) < src.hub.clearRadius) continue;
      crossings.push({ id: `cp-${crossings.length}`, position: { x, y: src.streets.roadTop, z } });
    }
  }

  return {
    kind: 'city',
    seed: src.seed,
    size: src.size,
    chunkSize,
    districts: src.districts.map((d) => ({ district: d.district, rect: d.rect })),
    hub: hub.hub,
    solids: [
      ...groundTiles(src, chunkSize),
      ...cliffs(src, chunkSize),
      ...quays(src, chunkSize),
      ...hub.solids,
      ...streetSolids(streets, src.streets, chunkSize),
      ...all('solids'),
    ],
    props: all('props'),
    zipLines: all('zipLines'),
    jumpPads: all('jumpPads'),
    boostOrbs: all('boostOrbs'),
    rails: all('rails'),
    checkpoints: [hub.checkpoint, ...crossings, ...all('checkpoints')],
    pois: [],
    streets,
    navLinks: all('navLinks'),
    thiefSpawns: [],
  };
}
