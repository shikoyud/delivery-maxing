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
  RotY,
  Solid,
  StreetEdge,
  StreetNode,
  Vec3,
  ZipLine,
} from '@dm/shared';
import { type ArterialLines, gridLines, intersectRect, r2, top, v2, type GridLine } from './layout';
import { type FillerParams, fillLot, type Lot } from './lots';
import type { Edge, StreetStyle } from './source';
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
  /** Map edges that are water: the land stops at the quay line inside each. */
  waterEdges: readonly Edge[];
  /** Quay checkpoints stand at most this far apart along a quay, m. */
  checkpointSpacing: number;
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

/**
 * A container stack: `tiers` containers high over `rect`, its top at `top`. It is climbed over the mantle-step crates
 * `steps` (lowest first), facing `dir` (the yaw that turns +z toward the stack).
 */
export interface ContainerStack { id: string; rect: Rect; top: number; tiers: number; steps: string[]; dir: RotY }
/** A crane: the walkable top of its jib (`jib` at `height`), the pads up to it and the zip lines leaving it. */
export interface CraneReport { id: string; height: number; jib: Rect; pads: string[]; zips: string[] }
/** A district's quays: where the land stops (`line` on the `across` axis), and the checkpoints along them. */
export interface QuayReport { quays: QuayEdge[]; checkpoints: string[] }

/** A terrace: a flat plateau over `rect` (its solids `solids`, split at chunk borders) with its top at `top`. */
export interface Terrace { id: string; rect: Rect; top: number; solids: string[] }
/** One ramp of a steep street: the `solid` (a rotated road slab) from `bottom` to `top`, on its road surface. */
export interface StreetRamp { solid: string; bottom: Vec3; top: Vec3 }
/**
 * A steep street: a straight street running from `from` (on the arterial at its foot) up its `ramps` (lowest first)
 * to `to` (on the street of its top terrace), every point on the road surface of its centre line.
 */
export interface SteepStreet { id: string; from: Vec3; to: Vec3; ramps: StreetRamp[] }
/** A stair run: `steps` (solid ids, lowest first) walked from `from` (in front of the lowest step) to `to` (above). */
export interface StairRun { id: string; steps: string[]; from: Vec3; to: Vec3 }
/** A chute: `segments` (solid ids, top end first) laid end to end, its surface running from `start` down to `end`. */
export interface ChuteReport { id: string; segments: string[]; start: Vec3; end: Vec3 }

/**
 * A grind rail: along a street's sidewalk (`street`) or in the skatepark. `approach` is a standing spot behind its
 * first point, on its first segment's line, where a courier starts a run at it.
 */
export interface RailReport { id: string; kind: 'street' | 'skatepark'; approach: Vec3 }
/**
 * A ramp of the skatepark (`solids`, lowest first): its face climbs from `foot` (on the surface in front) along the
 * horizontal unit direction `facing` to `top` (its crest, level with the deck or rim behind it).
 */
export interface RampReport {
  id: string;
  kind: 'quarter' | 'funbox' | 'bowl-wall' | 'bowl-outer';
  solids: string[];
  foot: Vec3;
  top: Vec3;
  facing: { x: number; z: number };
}
/**
 * The skatepark bowl: a sunken-looking floor at ground level ringed by walls (`walls`, ramp ids) up to a rim deck at
 * `height`, the whole bowl inside `rim`; outer ramps (`outerRamps`) climb onto the rim from outside.
 */
export interface BowlReport { id: string; floor: Rect; rim: Rect; height: number; walls: string[]; outerRamps: string[] }

/**
 * A POI access kit (Task 13): what takes a courier up to an elevated POI on `ledge` (top at `top`) and back down.
 * `mantle`: crate steps (`steps`, lowest first) climbed from `approach` facing along `facing`, the `climb` mantle link
 * and the `drop` link down. `pad-zip`: the `pad` launching onto `target` and the zip line `zip` riding down from the
 * roof (end a) to street level (end b).
 */
export type PoiKit =
  | { poi: string; kind: 'mantle'; ledge: Rect; top: number; steps: string[]; approach: Vec3; facing: { x: number; z: number }; climb: string; drop: string }
  | { poi: string; kind: 'pad-zip'; ledge: Rect; top: number; pad: string; target: Vec3; zip: string };

/** Test metadata about what a district built, for its content tests (map:build never writes it). */
export interface DistrictReport {
  rooftopGaps: RooftopGap[];
  alleys: WallRunAlley[];
  padTargets: PadTarget[];
  zipLines: string[];
  containerStacks: ContainerStack[];
  cranes: CraneReport[];
  quay: QuayReport;
  terraces: Terrace[];
  steepStreets: SteepStreet[];
  stairRuns: StairRun[];
  chutes: ChuteReport[];
  rails: RailReport[];
  ramps: RampReport[];
  bowl: BowlReport;
  /** The skatepark's plaza. */
  skatepark: Rect;
  /** The POI pass's access kits (the city-wide POI pass, not a district). */
  poiKits: PoiKit[];
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

/**
 * The lines of the district's arterial cells along one axis: the arterials inside it and its land edges (with
 * `edgeMargin`), no local streets (an infinite pitch splits no span).
 */
export function arterialCellLines(ctx: DistrictContext, axis: 'x' | 'z', edgeMargin: number): GridLine[] {
  const area = intersectRect(ctx.rect, ctx.city.land);
  const [min, max] = axis === 'x' ? [area.minX, area.maxX] : [area.minZ, area.maxZ];
  return gridLines(min, max, ctx.city.arterials, axis, { pitch: Infinity, halfWidth: 0, edgeMargin });
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

/** An elevated slot in the middle of a solid's top (a roof or a stack top), reached as `access` says. */
export function roofSlot(district: District, s: Solid, access: PoiSlot['access']): PoiSlot {
  return { position: v2({ x: s.center.x, y: top(s), z: s.center.z }), kind: 'door', elevated: true, district, access };
}

/** Checks for a district's `params` (each failure names the district, the template and the field). */
export interface ParamChecks {
  fail: (why: string) => never;
  /** `v` as an object, or fail naming it. */
  obj: (v: unknown, name: string) => Record<string, unknown>;
  /** Each of `keys` of `o` is a non-negative finite number (failures name `prefix` + key). */
  nums: (o: Record<string, unknown>, keys: readonly string[], prefix: string) => void;
  /** Each of `keys` of `o` is a positive finite number: sizes and loop steps (a zero step would never end a loop). */
  positive: (o: Record<string, unknown>, keys: readonly string[], prefix: string) => void;
}

export function paramChecks(district: District, template: string): ParamChecks {
  return namedChecks(`district ${district}: ${template} params`);
}

/** ParamChecks whose failures start with `label`. */
export function namedChecks(label: string): ParamChecks {
  const fail = (why: string): never => {
    throw new Error(`${label}: ${why}`);
  };
  const nums = (o: Record<string, unknown>, keys: readonly string[], prefix: string): void => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail(`${prefix}${k} must be a non-negative number`);
    }
  };
  return {
    fail,
    obj: (v, name) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${name} must be an object`)),
    nums,
    positive: (o, keys, prefix) => {
      nums(o, keys, prefix);
      for (const k of keys) if ((o[k] as number) <= 0) fail(`${prefix}${k} must be positive`);
    },
  };
}

/**
 * A quay along one water edge of a district: the land stops at `line` on the `across` axis, the water lies beyond it
 * toward `out`, and the quay runs from `from` to `to` along the other axis (inside the district).
 */
export interface QuayEdge { edge: Edge; across: 'x' | 'z'; line: number; out: 1 | -1; from: number; to: number }

/** The quays of a district: one along each water edge of the land that the district's rect reaches. */
export function districtQuays(ctx: DistrictContext): QuayEdge[] {
  const { land, waterEdges } = ctx.city;
  const r = ctx.rect;
  const out: QuayEdge[] = [];
  const alongX = { from: Math.max(r.minX, land.minX), to: Math.min(r.maxX, land.maxX) };
  const alongZ = { from: Math.max(r.minZ, land.minZ), to: Math.min(r.maxZ, land.maxZ) };
  for (const edge of waterEdges) {
    if (edge === 'east' && r.maxX >= land.maxX) out.push({ edge, across: 'x', line: land.maxX, out: 1, ...alongZ });
    if (edge === 'west' && r.minX <= land.minX) out.push({ edge, across: 'x', line: land.minX, out: -1, ...alongZ });
    if (edge === 'south' && r.maxZ >= land.maxZ) out.push({ edge, across: 'z', line: land.maxZ, out: 1, ...alongX });
    if (edge === 'north' && r.minZ <= land.minZ) out.push({ edge, across: 'z', line: land.minZ, out: -1, ...alongX });
  }
  return out.filter((q) => q.to > q.from);
}

/** The point `inset` m inland of quay `q`'s line at `along` (rounded to 0.01 m), at height `y`. */
export function quayPoint(q: QuayEdge, along: number, inset: number, y: number): Vec3 {
  const across = q.line - q.out * inset;
  return v2(q.across === 'x' ? { x: across, y, z: along } : { x: along, y, z: across });
}

/**
 * Checkpoints along quay `q`, `inset` m inland of its line: as few as keep consecutive ones at most `spacing` apart
 * and the quay's ends within spacing / 2, each moved off the street corridors crossing the quay (`streets`: centre
 * lines with their half-widths) by `clearance`. Ids are `<prefix><k>`.
 */
export function quayCheckpoints(
  q: QuayEdge,
  streets: readonly { at: number; halfWidth: number }[],
  opts: { spacing: number; inset: number; clearance: number; prefix: string },
): Checkpoint[] {
  const len = q.to - q.from;
  for (let n = Math.max(1, Math.ceil(len / opts.spacing)); n <= Math.ceil(len) + 1; n++) {
    const at: number[] = [];
    for (let k = 0; k < n; k++) {
      let a = q.from + (len * (k + 0.5)) / n;
      for (const s of streets) {
        const clear = s.halfWidth + opts.clearance;
        if (Math.abs(a - s.at) < clear) a = a < s.at ? s.at - clear : s.at + clear;
      }
      at.push(r2(a));
    }
    const gaps = at.slice(1).map((a, k) => a - at[k]!);
    const ends = [at[0]! - q.from, q.to - at[n - 1]!];
    const ok = ends.every((e) => e >= 0 && e <= opts.spacing / 2) && gaps.every((g) => g > 0 && g <= opts.spacing);
    if (ok) return at.map((a, k) => ({ id: `${opts.prefix}${k}`, position: quayPoint(q, a, opts.inset, 0) }));
  }
  throw new Error(`quay ${q.edge}: no checkpoint layout keeps them ${opts.spacing} m apart off the streets`);
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
