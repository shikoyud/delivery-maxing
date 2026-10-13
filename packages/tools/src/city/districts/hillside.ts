import { ordersConfig, rotatedHalfExtents, solidRect, type PieceEntry, type Rect, type Solid, type SolidKind, type Vec3 } from '@dm/shared';
import {
  emptyOutput,
  paramChecks,
  type DistrictContext,
  type DistrictOutput,
  type DistrictReport,
  type StreetRamp,
} from '../district';
import { navLinkFor, padFlightClear, padLaunchFor, type Obstacle } from '../kits';
import { box, gridLines, intersectRect, r2, v2, type GridLine } from '../layout';
import { fillLot, type FillerParams, type Lot } from '../lots';
import { GraphBuilder, splitAtChunks } from '../streets';

/** Hillside parameters (`params` of the hillside district in city.source.json). */
interface HillsideParams {
  /** Street half-width (road + sidewalks), m; gap kept from a land edge, m. */
  streetHalfWidth: number;
  edgeMargin: number;
  /** Top terrace of the NW corner cell, m; the most a terrace rises above the one below it, m. */
  topHeight: number;
  bandRiseMax: number;
  /** Steep street ramps: slope (degrees), slab thickness, how far each slab reaches on under the street at its foot. */
  rampDeg: number;
  rampThickness: number;
  rampEmbed: number;
  /** Flat street between the arterial's edge and the first ramp; least flat street between a junction and a ramp. */
  footRunup: number;
  rampFlat: number;
  /** Lots keep this far from a terrace's back wall (and the cell's north edge), and from its sides and steep street. */
  backMargin: number;
  sideMargin: number;
  /** The strip at the east end of each lower terrace holding its stairs and pad up to the next one, m. */
  featureWidth: number;
  /** Stair runs: rise per step (terrace heights are multiples of it), step depth, run width; m. */
  stairs: { rise: number; depth: number; width: number };
  /**
   * Uphill pads: `inset` m into the feature strip, `back` m in front of the wall above; the flight lands `landInset` m
   * past the wall's top edge after an apex `apexAbove` over the landing, clearing what it passes over by `clearance`.
   */
  pad: { radius: number; apexAbove: number; inset: number; back: number; landInset: number; clearance: number };
  /**
   * Chutes: cells whose top terrace is at least `minTop` m keep a `laneWidth` lane at their west edge, and a chute
   * `width` wide runs down it from the top terrace's front edge to the ground, `runout` m short of the cell's south
   * edge. Slabs `thickness` thick, at most `maxSegment` long, each reaching `overlap` m into the next (the last one
   * `embed` m into the ground).
   */
  chute: { minTop: number; width: number; laneWidth: number; thickness: number; runout: number; embed: number; overlap: number; maxSegment: number };
  /** Houses along the terrace streets (filler rules). */
  houses: Pick<FillerParams, 'pieces' | 'scaleMin' | 'scaleMax' | 'fillChance' | 'setback' | 'gapMin' | 'gapMax' | 'doorOffset'>;
}

/** Spec ranges the hillside params must stay within. */
const SPEC = { topHeight: [35, 40], rampDeg: [15, 25], chuteLength: [100, 300], minChutes: 3 } as const;
const DEG = 180 / Math.PI;
/** A stair run's reported standing points are this far off its ends (in front of the lowest step, past the top), m. */
const STAND_OFF = 1.5;

function hillsideParams(ctx: DistrictContext): HillsideParams {
  const { fail, obj, nums } = paramChecks(ctx.district, 'hillside');
  const p = ctx.params;
  const positive = (o: Record<string, unknown>, keys: readonly string[], prefix: string): void => {
    nums(o, keys, prefix);
    for (const k of keys) if ((o[k] as number) <= 0) fail(`${prefix}${k} must be positive`);
  };
  nums(p, ['edgeMargin', 'rampEmbed', 'footRunup', 'backMargin', 'sideMargin', 'featureWidth'], '');
  positive(p, ['streetHalfWidth', 'topHeight', 'bandRiseMax', 'rampDeg', 'rampThickness', 'rampFlat'], '');
  positive(obj(p.stairs, 'stairs'), ['rise', 'depth', 'width'], 'stairs.');
  const pad = obj(p.pad, 'pad');
  nums(pad, ['apexAbove', 'inset', 'back', 'landInset', 'clearance'], 'pad.');
  positive(pad, ['radius'], 'pad.');
  const chute = obj(p.chute, 'chute');
  nums(chute, ['minTop', 'laneWidth', 'runout', 'embed', 'overlap'], 'chute.');
  positive(chute, ['width', 'thickness', 'maxSegment'], 'chute.');
  const houses = obj(p.houses, 'houses');
  nums(houses, ['scaleMax', 'fillChance', 'setback', 'gapMin', 'gapMax', 'doorOffset'], 'houses.');
  positive(houses, ['scaleMin'], 'houses.');

  const h = p as unknown as HillsideParams;
  const move = ctx.move;
  const { stairs: st, pad: pd, chute: ch, houses: hs } = h;
  if (h.topHeight < SPEC.topHeight[0] || h.topHeight > SPEC.topHeight[1]) fail('need 35 ≤ topHeight ≤ 40');
  if (h.rampDeg < SPEC.rampDeg[0] || h.rampDeg > SPEC.rampDeg[1] || h.rampDeg >= move.controller.maxSlopeClimbDeg) {
    fail('need 15 ≤ rampDeg ≤ 25, under controller.maxSlopeClimbDeg');
  }
  // A step is walked (autostep), never a mantle ledge (Ruling R17: mantle rises start at the ledge probe floor)
  if (st.rise > move.controller.maxStepHeight || st.rise >= move.mantle.minHeight) fail('stairs.rise must be a walkable step, below a mantle ledge');
  if (st.depth < move.controller.minStepWidth) fail('stairs.depth must be at least controller.minStepWidth');
  if (h.bandRiseMax < st.rise) fail('bandRiseMax must be at least one stair rise');
  if (pd.apexAbove > ordersConfig.fragile.maxFallMeters) fail('pad.apexAbove must keep the fall onto the terrace Fragile-safe');
  if (pd.landInset >= 2 * h.streetHalfWidth) fail('pad.landInset must land on the terrace street');
  if (pd.inset - pd.radius < 0 || pd.inset + pd.radius >= h.featureWidth - h.sideMargin - st.width) {
    fail('the pad must fit in the feature strip beside the stairs');
  }
  if (ch.width >= ch.laneWidth) fail('chute.width must leave room in its lane');
  if (ch.maxSegment + Math.max(ch.overlap, ch.embed) + ch.thickness > ctx.city.chunkSize) fail('a chute segment must fit in one chunk');
  if (hs.scaleMax < hs.scaleMin || hs.fillChance > 1 || hs.gapMax < hs.gapMin) {
    fail('need houses.scaleMin ≤ scaleMax, fillChance ≤ 1 and gapMin ≤ gapMax');
  }
  // A house set back from its street stays nearer to it than to any other street (lots keep these margins)
  if (hs.setback >= h.sideMargin || hs.setback >= h.backMargin) fail('houses.setback must be under sideMargin and backMargin');
  if (!Array.isArray(hs.pieces) || hs.pieces.length === 0) fail('houses.pieces must list building piece ids');
  for (const id of hs.pieces) if (ctx.pieces[id]?.kind !== 'building') fail(`houses.pieces: ${String(id)} is not a building piece`);
  return h;
}

/** Rounds a height to a whole number of stair rises. */
const toRise = (y: number, rise: number): number => r2(Math.round(y / rise) * rise);

/**
 * One arterial cell of the district. `levels` are its terrace tops, lowest (southern) first; none for a flat cell.
 * `south`/`north` are the arterials beside it (null at a land edge). `mid` is the middle of its arterial span (whole
 * metres): its street runs there, where a 100 m filler grid on the far side of a shared arterial has its street too,
 * so the two meet in one crossing instead of two overlapping junctions.
 */
interface Cell {
  id: string;
  rect: Rect;
  mid: number;
  south: number | null;
  north: number | null;
  /** Which sides of the cell face an arterial. */
  arterialSides: Lot['streets'];
  levels: number[];
  chute: boolean;
}

/**
 * A tier of a cell: the ground in front (tier 0, at y = 0) or a terrace. It spans x `x0`…rect.maxX and z `zN`…`zS`;
 * a terrace's street runs along its front (south) edge.
 */
interface Tier { level: number; x0: number; zN: number; zS: number }

/** Where things stand in a cell: the steep street's line `xs` (its mid), the stairs-and-pad strip from `featureX`, the tiers. */
interface CellLayout { cell: Cell; xs: number; featureX: number; tiers: Tier[] }

/** Where everything stands so far, while the district is being built. */
interface Build {
  ctx: DistrictContext;
  p: HillsideParams;
  out: DistrictOutput;
  graph: GraphBuilder;
  report: Pick<DistrictReport, 'terraces' | 'steepStreets' | 'stairRuns' | 'chutes' | 'padTargets'>;
  /** The current cell's solids (pad flights must clear them). */
  cellSolids: Solid[];
  /** Houses placed so far (for their ids). */
  houses: number;
}

/**
 * Hillside: each arterial cell is a hill of terraces stepping up from the arterial on its south side to its north
 * edge, the cells' tops rising toward the NW corner (to topHeight there). Arterials stay at street level between the
 * hills. In each cell a steep street climbs straight up from the south arterial, a 15–25° ramp onto each terrace,
 * and each terrace has a street along its front edge with houses behind it. Stairs and an uphill pad in a strip at
 * the east end of each tier climb to the next terrace. The highest cells keep a lane along their west edge with a
 * long chute from the top terrace down to the ground. The cell nearest the hub is flat, with a street through it.
 */
export function buildHillside(ctx: DistrictContext): DistrictOutput {
  const p = hillsideParams(ctx);
  const graph = new GraphBuilder(`${ctx.district}-n`);
  const b: Build = {
    ctx,
    p,
    out: emptyOutput({ nodes: [], edges: [] }),
    graph,
    report: { terraces: [], steepStreets: [], stairRuns: [], chutes: [], padTargets: [] },
    cellSolids: [],
    houses: 0,
  };
  for (const cell of planCells(ctx, p)) {
    b.cellSolids = [];
    const lay = layoutCell(b, cell);
    if (cell.levels.length === 0) {
      buildFlatCell(b, lay);
      continue;
    }
    buildTerraces(b, lay);
    buildSteepStreet(b, lay);
    buildTerraceStreets(b, lay);
    buildHouses(b, lay);
    for (let k = 0; k + 1 < lay.tiers.length; k++) buildStairs(b, lay, k);
    if (cell.chute) buildChute(b, lay);
    for (let k = 0; k + 1 < lay.tiers.length; k++) buildPad(b, lay, k);
  }
  if (b.report.chutes.length < SPEC.minChutes) {
    throw new Error(`district ${ctx.district}: only ${b.report.chutes.length} chutes (need ${SPEC.minChutes}); lower chute.minTop`);
  }
  b.out.streets = graph.graph();
  b.out.report = b.report;
  return b.out;
}

/**
 * The arterial cells and their terrace heights: a cell's top rises with its distance from the district's SE cell,
 * up to topHeight in the NW cell, rounded to whole stair rises; it is split into as few equal terraces as keep each
 * rise within bandRiseMax.
 */
function planCells(ctx: DistrictContext, p: HillsideParams): Cell[] {
  const area = intersectRect(ctx.rect, ctx.city.land);
  // No local streets: the lines are the arterials and the land edges (an infinite pitch splits no span)
  const lines = (axis: 'x' | 'z'): GridLine[] =>
    gridLines(axis === 'x' ? area.minX : area.minZ, axis === 'x' ? area.maxX : area.maxZ, ctx.city.arterials, axis, {
      pitch: Infinity,
      halfWidth: 0,
      edgeMargin: p.edgeMargin,
    });
  const xs = lines('x');
  const zs = lines('z');
  const [nx, nz] = [xs.length - 1, zs.length - 1];
  const far = nx - 1 + (nz - 1);
  const rise = p.stairs.rise;
  const cells: Cell[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const [w, e, n, s] = [xs[i]!, xs[i + 1]!, zs[j]!, zs[j + 1]!];
      const rect = { minX: r2(w.at + w.inset), maxX: r2(e.at - e.inset), minZ: r2(n.at + n.inset), maxZ: r2(s.at - s.inset) };
      const top = far > 0 ? toRise((p.topHeight * (nx - 1 - i + (nz - 1 - j))) / far, rise) : toRise(p.topHeight, rise);
      const m = top > 0 ? Math.ceil(top / p.bandRiseMax - 1e-9) : 0;
      const levels = Array.from({ length: m }, (_, k) => toRise((top * (k + 1)) / m, rise));
      cells.push({
        id: `${ctx.district}-c${i}-${j}`,
        rect,
        mid: Math.round((w.at + e.at) / 2),
        south: s.kind === 'arterial' ? s.at : null,
        north: n.kind === 'arterial' ? n.at : null,
        arterialSides: { n: n.kind === 'arterial', s: s.kind === 'arterial', w: w.kind === 'arterial', e: e.kind === 'arterial' },
        levels,
        chute: m > 0 && top >= p.chute.minTop,
      });
    }
  }
  return cells;
}

/**
 * Horizontal run of a ramp climbing `rise` m at rampDeg, up to a whole metre (so the ramp is at most rampDeg steep):
 * street nodes on whole metres keep the core's road and sidewalk slab edges exact (see layout.ts snapLine).
 */
const rampRun = (p: HillsideParams, rise: number): number => Math.ceil(rise / Math.tan(p.rampDeg / DEG) - 1e-9);

/**
 * The cell's tiers from south to north: the ground in front, deep enough for the first ramp and its run-up, then the
 * terraces in equal bands to the north edge (on whole metres). Lower tiers stop at the chute lane; the top one
 * spans the cell. Throws when a terrace cannot hold its ramp (or stairs) up to the next.
 */
function layoutCell(b: Build, cell: Cell): CellLayout {
  const { p, ctx } = b;
  const r = cell.rect;
  const fail = (why: string): never => {
    throw new Error(`district ${ctx.district}: ${cell.id}: ${why}`);
  };
  const featureX = r2(r.maxX - p.featureWidth);
  const m = cell.levels.length;
  if (m === 0) return { cell, xs: cell.mid, featureX, tiers: [] };
  if (cell.south === null) fail('a terraced cell needs an arterial on its south side');
  const laneX = cell.chute ? r2(r.minX + p.chute.laneWidth) : r.minX;
  const xs = cell.mid;
  if (xs - p.streetHalfWidth <= laneX || xs + p.streetHalfWidth >= featureX) fail('the steep street runs into the chute lane or the stairs');
  const hw = p.streetHalfWidth;
  const frontS = Math.floor(r.maxZ - p.footRunup) - rampRun(p, cell.levels[0]!);
  const depth = (frontS - r.minZ) / m;
  const tiers: Tier[] = [{ level: 0, x0: laneX, zN: frontS, zS: r.maxZ }];
  for (let k = 0; k < m; k++) {
    const zS = k === 0 ? frontS : Math.round(frontS - k * depth);
    const zN = k === m - 1 ? r.minZ : Math.round(frontS - (k + 1) * depth);
    tiers.push({ level: cell.levels[k]!, x0: k === m - 1 ? r.minX : laneX, zN, zS });
  }
  for (let k = 1; k < m; k++) {
    const t = tiers[k]!;
    const rise = tiers[k + 1]!.level - t.level;
    const room = t.zS - 2 * hw - t.zN; // between the terrace street and the wall above
    if (rampRun(p, rise) + p.rampFlat > room) fail(`terrace ${k} has ${room} m for a ${rampRun(p, rise)} m ramp`);
    if (stairsDepth(p, rise) + STAND_OFF > room || p.pad.back + p.pad.radius > room) fail(`terrace ${k} cannot hold its stairs and pad`);
  }
  if (stairsDepth(p, cell.levels[0]!) + STAND_OFF > r.maxZ - frontS) fail('the ground in front cannot hold the first stairs');
  return { cell, xs, featureX, tiers };
}

/** Depth of a stair run climbing `rise`. */
const stairsDepth = (p: HillsideParams, rise: number): number => Math.round(rise / p.stairs.rise) * p.stairs.depth;

/** Adds solids to the output and to the current cell's list. */
function addSolids(b: Build, solids: Solid[]): void {
  b.out.solids.push(...solids);
  b.cellSolids.push(...solids);
}

/** Each terrace: a ground plateau over its tier, split at chunk borders. */
function buildTerraces(b: Build, lay: CellLayout): void {
  const r = lay.cell.rect;
  lay.tiers.forEach((t, k) => {
    if (k === 0) return;
    const id = `${lay.cell.id}-t${k}`;
    const rect = { minX: t.x0, maxX: r.maxX, minZ: t.zN, maxZ: t.zS };
    const solids = splitAtChunks(rect, b.ctx.city.chunkSize).map((piece, n) => box(`${id}-${n}`, 'ground', piece, 0, t.level));
    addSolids(b, solids);
    b.report.terraces.push({ id, rect, top: t.level, solids: solids.map((s) => s.id) });
  });
}

/**
 * A slab along z whose top face runs from `hi` (its upper end, at the smaller z) down to `lo`, reaching `embed` m on
 * past `lo` along the same slope: a box tilted about x (rotationDeg.x is the slope).
 */
function slopedSlab(id: string, kind: SolidKind, hi: Vec3, lo: Vec3, width: number, thickness: number, embed: number): Solid {
  const run = lo.z - hi.z;
  const drop = hi.y - lo.y;
  if (!(run > 0) || !(drop > 0)) throw new Error(`${id}: a sloped slab must fall toward +z`);
  const a = Math.atan2(drop, run);
  const len = Math.hypot(run, drop) + embed;
  // Down the top face (0, −sin a, cos a); the face's normal (0, cos a, sin a): local +z and +y turned by Rx(a)
  const mid = { y: hi.y - (Math.sin(a) * len) / 2, z: hi.z + (Math.cos(a) * len) / 2 };
  return {
    id,
    kind,
    center: v2({ x: hi.x, y: mid.y - (Math.cos(a) * thickness) / 2, z: mid.z - (Math.sin(a) * thickness) / 2 }),
    size: v2({ x: width, y: thickness, z: len }),
    rotationDeg: v2({ x: a * DEG, y: 0, z: 0 }),
  };
}

/**
 * The steep street: from the south arterial straight north up a ramp onto each terrace, across its street to the next
 * ramp, ending at the top terrace's street. Ramps are road slabs (the core builds the flat parts).
 */
function buildSteepStreet(b: Build, lay: CellLayout): void {
  const { p, ctx, graph } = b;
  const { roadTop } = ctx.city.streets;
  const { tiers, xs, cell } = lay;
  const hw = p.streetHalfWidth;
  const points: Vec3[] = [{ x: xs, y: 0, z: cell.south! }];
  const ramps: StreetRamp[] = [];
  for (let k = 0; k + 1 < tiers.length; k++) {
    const [lo, hi] = [tiers[k]!, tiers[k + 1]!];
    const top = v2({ x: xs, y: hi.level, z: lo.zN });
    const foot = v2({ x: xs, y: lo.level, z: lo.zN + rampRun(p, hi.level - lo.level) });
    const junction = v2({ x: xs, y: hi.level, z: hi.zS - hw });
    const deg = Math.atan2(hi.level - lo.level, foot.z - top.z) * DEG;
    if (deg < SPEC.rampDeg[0] || deg > SPEC.rampDeg[1]) throw new Error(`district ${ctx.district}: ${cell.id}: ramp ${k} is ${deg.toFixed(1)}°`);
    points.push(foot, top, junction);
    const up = (v: Vec3): Vec3 => v2({ ...v, y: v.y + roadTop });
    const slab = slopedSlab(`${cell.id}-ramp-${k}`, 'road', up(top), up(foot), 2 * hw, p.rampThickness, p.rampEmbed);
    addSolids(b, [slab]);
    ramps.push({ solid: slab.id, bottom: up(foot), top: up(top) });
  }
  graph.street(points, hw);
  const at = (v: Vec3): Vec3 => v2({ ...v, y: v.y + roadTop });
  b.report.steepStreets.push({ id: `${cell.id}-street`, from: at(points[0]!), to: at(points[points.length - 1]!), ramps });
}

/** A street along the front edge of each terrace, across its whole width, crossing the steep street. */
function buildTerraceStreets(b: Build, lay: CellLayout): void {
  const hw = b.p.streetHalfWidth;
  lay.tiers.forEach((t, k) => {
    if (k === 0) return;
    const z = t.zS - hw;
    b.graph.street([{ x: t.x0, y: t.level, z }, { x: lay.xs, y: t.level, z }, { x: lay.cell.rect.maxX, y: t.level, z }], hw);
  });
}

/**
 * Fills `lot` with houses (filler rows facing its street sides), standing at `level`, and adds them with their door
 * slots.
 */
function addHouses(b: Build, lot: Lot, level: number): void {
  const { p, ctx } = b;
  const { rect } = lot;
  if (rect.maxX <= rect.minX || rect.maxZ <= rect.minZ) return;
  // fillLot reads only the house rules (not the grid pitch)
  const params: FillerParams = { ...p.houses, pitch: 0, streetHalfWidth: p.streetHalfWidth, edgeMargin: p.edgeMargin };
  const pieces: PieceEntry[] = p.houses.pieces.map((id) => ctx.pieces[id]!);
  const { plaza, palettes } = ctx.city;
  const newId = (): string => `${ctx.district}-h${b.houses++}`;
  for (const house of fillLot(lot, ctx.rng, { params, pieces, palettes, plaza: { center: plaza.center, radius: plaza.clearRadius }, newId })) {
    house.prop.position = v2({ ...house.prop.position, y: level });
    for (const s of house.solids) s.center = v2({ ...s.center, y: s.center.y + level });
    b.out.props.push(house.prop);
    addSolids(b, house.solids);
    b.out.poiSlots.push({ position: v2({ ...house.door, y: level }), kind: 'door', elevated: false, district: ctx.district, access: 'street' });
  }
}

/**
 * Houses on each tier, in a row facing the street in front of it (the arterial for the ground in front), kept
 * sideMargin from the steep street, the cell's sides and the stairs-and-pad strip, and backMargin from the wall
 * behind. The top terrace has one lot across the cell.
 */
function buildHouses(b: Build, lay: CellLayout): void {
  const { p } = b;
  const { tiers, xs, featureX, cell } = lay;
  const r = cell.rect;
  const [hw, sm] = [p.streetHalfWidth, p.sideMargin];
  const m = tiers.length - 1;
  tiers.forEach((t, k) => {
    const z = { minZ: t.zN + p.backMargin, maxZ: k === 0 ? t.zS : t.zS - 2 * hw };
    const front = { n: false, s: true, w: false, e: false };
    if (k === m) {
      addHouses(b, { rect: { minX: r.minX + sm, maxX: r.maxX - sm, ...z }, streets: front }, t.level);
      return;
    }
    addHouses(b, { rect: { minX: t.x0 + sm, maxX: xs - hw - sm, ...z }, streets: front }, t.level);
    addHouses(b, { rect: { minX: xs + hw + sm, maxX: featureX, ...z }, streets: front }, t.level);
  });
}

/**
 * A flat cell: a street straight through from the south arterial to the north one, and houses facing it and the
 * arterials around the cell (filler rows).
 */
function buildFlatCell(b: Build, lay: CellLayout): void {
  const { cell, xs } = lay;
  const r = cell.rect;
  const hw = b.p.streetHalfWidth;
  if (cell.south === null || cell.north === null) throw new Error(`district ${b.ctx.district}: ${cell.id}: a flat cell needs arterials north and south`);
  b.graph.street([{ x: xs, y: 0, z: cell.south }, { x: xs, y: 0, z: cell.north }], hw);
  const sides = cell.arterialSides;
  addHouses(b, { rect: { ...r, maxX: xs - hw }, streets: { ...sides, e: true } }, 0);
  addHouses(b, { rect: { ...r, minX: xs + hw }, streets: { ...sides, w: true } }, 0);
}

/**
 * Stairs from tier k up to tier k + 1 at the east end of the feature strip: a run straight north against the wall,
 * one stairs solid per step (stairs.rise each), the top step level with the terrace above.
 */
function buildStairs(b: Build, lay: CellLayout, k: number): void {
  const { p, ctx } = b;
  const [lo, hi] = [lay.tiers[k]!, lay.tiers[k + 1]!];
  const { rise, depth, width } = p.stairs;
  const n = Math.round((hi.level - lo.level) / rise);
  if (Math.abs(n * rise - (hi.level - lo.level)) > 1e-6) throw new Error(`${lay.cell.id}: terrace ${k + 1} is not a whole number of stair rises up`);
  const x1 = lay.cell.rect.maxX - p.sideMargin;
  const x0 = x1 - width;
  const wall = lo.zN;
  const id = `${lay.cell.id}-stairs-${k}`;
  const steps: Solid[] = [];
  for (let i = 1; i <= n; i++) {
    const rect = { minX: x0, maxX: x1, minZ: r2(wall + (n - i) * depth), maxZ: r2(wall + (n - i + 1) * depth) };
    steps.push(box(`${id}-${i - 1}`, 'stairs', rect, lo.level, lo.level + i * rise));
  }
  addSolids(b, steps);
  const x = r2((x0 + x1) / 2);
  b.report.stairRuns.push({
    id,
    steps: steps.map((s) => s.id),
    from: v2({ x, y: lo.level, z: wall + n * depth + STAND_OFF }),
    // Onto the sidewalk of the street along the terrace's front edge
    to: v2({ x, y: hi.level + ctx.city.streets.sidewalkTop, z: wall - STAND_OFF }),
  });
}

/** The obstacle a solid makes: its footprint and the top of its (rotated) box. */
function obstacleOf(s: Solid): Obstacle {
  const h = rotatedHalfExtents({ x: s.size.x / 2, y: s.size.y / 2, z: s.size.z / 2 }, s.rotationDeg);
  return { rect: solidRect(s), top: s.center.y + h.y };
}

/**
 * An uphill pad on tier k in the feature strip, `back` m in front of the wall, launching onto the street of tier
 * k + 1 `landInset` m past the wall's edge, its flight clear of the cell's solids.
 */
function buildPad(b: Build, lay: CellLayout, k: number): void {
  const { p, ctx, out, report } = b;
  const [lo, hi] = [lay.tiers[k]!, lay.tiers[k + 1]!];
  const x = r2(lay.featureX + p.pad.inset);
  const position = v2({ x, y: lo.level, z: lo.zN + p.pad.back });
  const target = v2({ x, y: hi.level + ctx.city.streets.roadTop, z: lo.zN - p.pad.landInset });
  const launch = padLaunchFor(position, target, p.pad.apexAbove, ctx.move.gravity);
  // What the pad stands on (its tier) is not in the way
  const obstacles = b.cellSolids.map(obstacleOf).filter((o) => o.top > position.y + 1e-6);
  if (!padFlightClear(position, launch, target, ctx.move.gravity, ctx.move.capsule.radius, p.pad.clearance, obstacles)) {
    throw new Error(`district ${ctx.district}: ${lay.cell.id}: the pad flight onto terrace ${k + 1} is blocked`);
  }
  const pad = { id: `${lay.cell.id}-pad-${k}`, position, radius: p.pad.radius, launch };
  out.jumpPads.push(pad);
  out.navLinks.push(navLinkFor({ ...pad, target }));
  report.padTargets.push({ pad: pad.id, target, landing: { minX: hi.x0, maxX: lay.cell.rect.maxX, minZ: hi.zN, maxZ: hi.zS } });
}

/**
 * A chute down the lane at the cell's west edge: from the top terrace's front edge straight south to the ground,
 * runout m short of the cell's south edge, in equal segments of at most maxSegment laid along one line.
 */
function buildChute(b: Build, lay: CellLayout): void {
  const { p, ctx } = b;
  const c = p.chute;
  const fail = (why: string): never => {
    throw new Error(`district ${ctx.district}: ${lay.cell.id}: ${why}`);
  };
  const topTier = lay.tiers[lay.tiers.length - 1]!;
  const x = r2(lay.cell.rect.minX + c.laneWidth / 2);
  const start = v2({ x, y: topTier.level, z: topTier.zS });
  const end = v2({ x, y: 0, z: lay.cell.rect.maxZ - c.runout });
  const length = Math.hypot(end.z - start.z, start.y - end.y);
  const a = Math.atan2(start.y - end.y, end.z - start.z);
  if (length < SPEC.chuteLength[0] || length > SPEC.chuteLength[1]) fail(`chute is ${length.toFixed(1)} m (need 100–300)`);
  if (a * DEG >= ctx.move.controller.minSlopeSlideDeg) fail('chute is steep enough to slide off as a wall');
  if (ctx.move.gravity * Math.sin(a) * Math.cos(a) ** 2 <= ctx.move.chute.friction) fail('chute is too shallow to keep its speed');
  const n = Math.ceil(length / c.maxSegment);
  const id = `${lay.cell.id}-chute`;
  const at = (t: number): Vec3 => ({ x, y: start.y + (end.y - start.y) * t, z: start.z + (end.z - start.z) * t });
  const segments = Array.from({ length: n }, (_, i) =>
    slopedSlab(`${id}-${i}`, 'chute', at(i / n), at((i + 1) / n), c.width, c.thickness, i === n - 1 ? c.embed : c.overlap),
  );
  for (const s of segments) {
    const r = solidRect(s);
    if (Math.max(r.maxX - r.minX, r.maxZ - r.minZ) > ctx.city.chunkSize) fail(`${s.id} is more than a chunk long`);
  }
  addSolids(b, segments);
  b.report.chutes.push({ id, segments: segments.map((s) => s.id), start, end });
}
