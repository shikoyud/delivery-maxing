import type {
  BoostOrb,
  Checkpoint,
  District,
  JumpPad,
  MovementConfig,
  NavLink,
  PieceCatalog,
  PieceEntry,
  PoiKind,
  Prop,
  Rail,
  Rect,
  Rng,
  Solid,
  StreetEdge,
  StreetNode,
  Vec3,
  ZipLine,
} from '@dm/shared';
import { type ArterialLines, gridLines, intersectRect, r2, type GridLine } from './layout';
import { type FillerParams, fillLot, type Lot } from './lots';
import type { StreetStyle } from './source';
import { GraphBuilder, type StreetGraph } from './streets';

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

/** A marked rooftop gap: a sprint jump taking off at `from` (feet on the roof edge) lands on `landing` near `to`. */
export interface RooftopGap { from: Vec3; to: Vec3; landing: Rect }
/**
 * A wall-run alley: `floor` is the open strip between the two wall faces, running along `axis`; `walls` lists the
 * collider solid ids forming each side (the side at the lower coordinate first).
 */
export interface WallRunAlley { id: string; floor: Rect; axis: 'x' | 'z'; walls: [string[], string[]] }
/** Where a jump pad should put its rider: feet near `target`, standing on `landing` (a roof). */
export interface PadTarget { pad: string; target: Vec3; landing: Rect }

/** Test metadata about what a district built, for its content tests (map:build never writes it). */
export interface DistrictReport {
  rooftopGaps: RooftopGap[];
  alleys: WallRunAlley[];
  padTargets: PadTarget[];
  zipLines: string[];
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
  /** What the district's content tests check (absent for the plain filler). */
  report?: Partial<DistrictReport>;
}

/** A lot of a district grid, with its column (`i`, west to east) and row (`j`, north to south) among the grid's spans. */
export interface GridLot extends Lot { i: number; j: number }

export interface DistrictGrid {
  xs: GridLine[];
  zs: GridLine[];
  /** Every non-empty span between consecutive lines, as a lot. */
  lots: GridLot[];
  /** The local streets (arterials come from the core). */
  streets: StreetGraph;
}

/**
 * A district's street grid inside the arterials: local streets splitting each span between arterials (or land edges)
 * into blocks of about `pitch`, joined into a street graph, and the lots between them. Throws when a local street
 * would cross the plaza's clear circle.
 */
export function districtGrid(ctx: DistrictContext, local: { pitch: number; halfWidth: number; edgeMargin: number }): DistrictGrid {
  const { land, arterials, plaza } = ctx.city;
  const area = intersectRect(ctx.rect, land);
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
  for (const x of xs) if (x.kind === 'local') g.street(zs.map((z) => ({ x: x.at, y: 0, z: z.at })), local.halfWidth);
  for (const z of zs) if (z.kind === 'local') g.street(xs.map((x) => ({ x: x.at, y: 0, z: z.at })), local.halfWidth);

  const lots: GridLot[] = [];
  const span = (a: GridLine, b: GridLine): [number, number] => [r2(a.at + a.inset), r2(b.at - b.inset)];
  for (let j = 1; j < zs.length; j++) {
    for (let i = 1; i < xs.length; i++) {
      const [xa, xb, za, zb] = [xs[i - 1]!, xs[i]!, zs[j - 1]!, zs[j]!];
      const [minX, maxX] = span(xa, xb);
      const [minZ, maxZ] = span(za, zb);
      if (maxX <= minX || maxZ <= minZ) continue;
      lots.push({
        i: i - 1,
        j: j - 1,
        rect: { minX, minZ, maxX, maxZ },
        streets: { w: xa.kind !== 'edge', e: xb.kind !== 'edge', n: za.kind !== 'edge', s: zb.kind !== 'edge' },
      });
    }
  }
  return { xs, zs, lots, streets: g.graph() };
}

/** An output with nothing in it but `streets`, for builders to fill. */
export function emptyOutput(streets: StreetGraph): DistrictOutput {
  return {
    solids: [],
    props: [],
    zipLines: [],
    jumpPads: [],
    boostOrbs: [],
    rails: [],
    checkpoints: [],
    navLinks: [],
    streets,
    poiSlots: [],
  };
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
  const { palettes, plaza } = ctx.city;
  const grid = districtGrid(ctx, { pitch: p.pitch, halfWidth: p.streetHalfWidth, edgeMargin: p.edgeMargin });

  const pieceList: PieceEntry[] = p.pieces.map((id) => ctx.pieces[id]!);
  let n = 0;
  const fill = { params: p, pieces: pieceList, palettes, plaza: { center: plaza.center, radius: plaza.clearRadius }, newId: () => `${ctx.district}-b${n++}` };
  const placed = grid.lots.flatMap((lot) => fillLot(lot, ctx.rng, fill));

  return {
    ...emptyOutput(grid.streets),
    solids: placed.flatMap((b) => b.solids),
    props: placed.map((b) => b.prop),
    poiSlots: placed.map((b) => ({ position: b.door, kind: 'door', elevated: false, district: ctx.district, access: 'street' })),
  };
}
