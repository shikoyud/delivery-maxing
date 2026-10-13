import type { PieceEntry, Rail, Rect, Solid, Vec3 } from '@dm/shared';
import {
  districtGrid,
  districtQuays,
  emptyOutput,
  paramChecks,
  quayCheckpoints,
  type DistrictContext,
  type DistrictGrid,
  type DistrictOutput,
  type BowlReport,
  type DistrictReport,
  type GridLot,
  type QuayEdge,
  type RampReport,
} from '../district';
import { slopedSlab } from '../kits';
import { box, gridLines, intersectRect, r2, v2, type GridLine } from '../layout';
import { fillLot, type FillerParams } from '../lots';
import { GraphBuilder } from '../streets';

/** A horizontal axis direction. */
type Dir = '+x' | '-x' | '+z' | '-z';
/** A spot in the skatepark: metres east (u) and south (v) of its north-west corner. */
type UV = [number, number];
/** One section of a ramp's face: it climbs `rise` m at `deg`. */
interface Section { deg: number; rise: number }

/** Suburbs parameters (`params` of the suburbs district in city.source.json). */
interface SuburbsParams {
  /** Local street pitch (about), m; street half-width (road + sidewalks), m; gap kept from a land edge, m. */
  pitch: number;
  streetHalfWidth: number;
  edgeMargin: number;
  /** No house stands within this of the quay line (the open beach-front apron), m. */
  apronWidth: number;
  /** Houses on yards along the streets (filler rules: `setback` is the front yard, the gaps the side yards). */
  houses: Pick<FillerParams, 'pieces' | 'scaleMin' | 'scaleMax' | 'fillChance' | 'setback' | 'gapMin' | 'gapMax' | 'doorOffset'>;
  /**
   * Every grind rail: `height` m above the surface it is jumped onto from; a clear `runUp` m behind its first point
   * (and past its last); every point at least `minClearance` m above the surface under it.
   */
  rails: { height: number; runUp: number; minClearance: number };
  /**
   * Street rails: on `count` local street blocks (distinct streets), along one sidewalk `inset` m in from its outer
   * edge, starting and ending `endGap` m from the crossings; a block must leave a rail of at least `minLength`.
   */
  streetRails: { count: number; inset: number; endGap: number; minLength: number };
  skatepark: {
    /** The park fills the arterial cell holding this point, `margin` m in from the arterials' sidewalks. */
    cellAt: { x: number; z: number };
    margin: number;
    /** Flat run kept clear in front of every ramp foot, m (the board reaches its top speed in it). */
    runUp: number;
    /** How far each ramp slab reaches on below the surface at its foot, m. */
    embed: number;
    /** The face of a quarter pipe and of a bowl wall: sections from the foot up, each steeper than the last. */
    transition: Section[];
    /** Quarter pipes: `width` across, a `deck` m deep behind the crest, then `runOut` m clear behind the deck. */
    quarter: { width: number; deck: number; runOut: number };
    /**
     * Funboxes: a `deg` ramp up to a flat `deck` m long and `height` m high, and a ramp down; a rail along the deck
     * `offset` m off its centre line, from `inset` m after the deck's start to `endGap` m before its end.
     */
    funbox: { height: number; deg: number; width: number; deck: number; rail: { offset: number; inset: number; endGap: number } };
    /**
     * The bowl: a `floor` m square at ground level, walls (the transition) up to a `rim` m wide deck around it, and
     * an `outerDeg` ramp `outerWidth` wide up onto the rim in the middle of each side.
     */
    bowl: { at: UV; floor: number; rim: number; outerDeg: number; outerWidth: number };
    /** Each quarter pipe's foot (the middle of it), climbing toward `dir`. */
    quarters: { at: UV; dir: Dir }[];
    /** Each funbox's centre and the axis it is ridden along. */
    funboxes: { at: UV; axis: 'x' | 'z' }[];
    /**
     * Ground rails: the first point above `at`, then `points` as [along `dir`, across (+z or +x), up] m from it;
     * each point stands rails.height (+ up) above the ground.
     */
    rails: { at: UV; dir: Dir; points: [number, number, number][] }[];
    /** Gap kept between the footprints of the park's pieces (with their run-ups), m. */
    spacing: number;
  };
  /** Quay checkpoints stand `inset` m inland of the quay line, `streetClearance` m clear of the streets reaching it. */
  checkpoint: { inset: number; streetClearance: number };
}

/** Spec minimums. */
const SPEC = { parkSize: 120, parkRails: 8, railStreets: 2 } as const;
const DEG = 180 / Math.PI;
const DIRS: Record<Dir, { x: number; z: number }> = { '+x': { x: 1, z: 0 }, '-x': { x: -1, z: 0 }, '+z': { x: 0, z: 1 }, '-z': { x: 0, z: -1 } };
const isDir = (v: unknown): v is Dir => typeof v === 'string' && v in DIRS;
const isUV = (v: unknown): v is UV => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

function suburbsParams(ctx: DistrictContext): SuburbsParams {
  const { fail, obj, nums, positive } = paramChecks(ctx.district, 'suburbs');
  const p = ctx.params;
  nums(p, ['edgeMargin', 'apronWidth'], '');
  positive(p, ['pitch', 'streetHalfWidth'], '');
  const houses = obj(p.houses, 'houses');
  nums(houses, ['scaleMax', 'fillChance', 'setback', 'gapMin', 'gapMax', 'doorOffset'], 'houses.');
  positive(houses, ['scaleMin'], 'houses.');
  positive(obj(p.rails, 'rails'), ['height', 'runUp', 'minClearance'], 'rails.');
  const sr = obj(p.streetRails, 'streetRails');
  nums(sr, ['inset', 'endGap'], 'streetRails.');
  positive(sr, ['count', 'minLength'], 'streetRails.');
  const sk = obj(p.skatepark, 'skatepark');
  const at = obj(sk.cellAt, 'skatepark.cellAt');
  if (![at.x, at.z].every((v) => typeof v === 'number' && Number.isFinite(v))) fail('skatepark.cellAt must be a point { x, z }');
  nums(sk, ['margin', 'embed', 'spacing'], 'skatepark.');
  positive(sk, ['runUp'], 'skatepark.');
  if (!Array.isArray(sk.transition) || sk.transition.length === 0) fail('skatepark.transition must list sections');
  (sk.transition as unknown[]).forEach((s, k) => positive(obj(s, `skatepark.transition[${k}]`), ['deg', 'rise'], `skatepark.transition[${k}].`));
  const quarter = obj(sk.quarter, 'skatepark.quarter');
  nums(quarter, ['runOut'], 'skatepark.quarter.');
  positive(quarter, ['width', 'deck'], 'skatepark.quarter.');
  const funbox = obj(sk.funbox, 'skatepark.funbox');
  positive(funbox, ['height', 'deg', 'width', 'deck'], 'skatepark.funbox.');
  nums(obj(funbox.rail, 'skatepark.funbox.rail'), ['offset', 'inset', 'endGap'], 'skatepark.funbox.rail.');
  const bowl = obj(sk.bowl, 'skatepark.bowl');
  positive(bowl, ['floor', 'rim', 'outerDeg', 'outerWidth'], 'skatepark.bowl.');
  if (!isUV(bowl.at)) fail('skatepark.bowl.at must be [u, v]');
  const list = (v: unknown, name: string, ok: (e: Record<string, unknown>) => boolean): void => {
    if (!Array.isArray(v)) fail(`${name} must be a list`);
    (v as unknown[]).forEach((e, k) => {
      if (!ok(obj(e, `${name}[${k}]`))) fail(`${name}[${k}] is malformed`);
    });
  };
  list(sk.quarters, 'skatepark.quarters', (e) => isUV(e.at) && isDir(e.dir));
  list(sk.funboxes, 'skatepark.funboxes', (e) => isUV(e.at) && (e.axis === 'x' || e.axis === 'z'));
  list(sk.rails, 'skatepark.rails', (e) => {
    const pts = e.points;
    return isUV(e.at) && isDir(e.dir) && Array.isArray(pts) && pts.length >= 2 &&
      pts.every((q) => Array.isArray(q) && q.length === 3 && q.every((x) => typeof x === 'number' && Number.isFinite(x)));
  });
  nums(obj(p.checkpoint, 'checkpoint'), ['inset', 'streetClearance'], 'checkpoint.');

  const s = p as unknown as SuburbsParams;
  checkRules(ctx, s, fail);
  return s;
}

/** The movement and spec rules the suburbs params must keep. */
function checkRules(ctx: DistrictContext, s: SuburbsParams, fail: (why: string) => never): void {
  const move = ctx.move;
  const { houses: hs, rails, streetRails: sr, skatepark: sk } = s;
  if (hs.scaleMax < hs.scaleMin || hs.fillChance > 1 || hs.gapMax < hs.gapMin) fail('need houses.scaleMin ≤ scaleMax, fillChance ≤ 1 and gapMin ≤ gapMax');
  if (!Array.isArray(hs.pieces) || hs.pieces.length === 0) fail('houses.pieces must list building piece ids');
  for (const id of hs.pieces) if (ctx.pieces[id]?.kind !== 'building') fail(`houses.pieces: ${String(id)} is not a building piece`);
  // Rideable: every face below the slope the controller climbs and the slope it slides off
  const maxDeg = Math.min(move.controller.maxSlopeClimbDeg, move.controller.minSlopeSlideDeg);
  const degs = [...sk.transition.map((t) => t.deg), sk.funbox.deg, sk.bowl.outerDeg];
  if (degs.some((d) => d >= maxDeg)) fail(`skatepark ramps must be under ${maxDeg}° (controller.maxSlopeClimbDeg, minSlopeSlideDeg)`);
  // The board reaches its top speed in a ramp's run-up; a bowl wall gets its run-up across the floor
  const toTop = move.board.topSpeed ** 2 / (2 * move.board.accel);
  if (sk.runUp < toTop) fail(`skatepark.runUp must be at least the ${toTop} m the board needs to reach its top speed`);
  if (sk.bowl.floor < sk.runUp) fail('skatepark.bowl.floor must hold a ramp run-up');
  // A rail is caught by jumping onto it: its first point at most a jump above the takeoff; every point clear of
  // the surface under it
  if (!Number.isInteger(sr.count) || sr.count < SPEC.railStreets) fail(`streetRails.count must be an integer ≥ ${SPEC.railStreets}`);
  if (sr.inset + move.capsule.radius > ctx.city.streets.sidewalkWidth) fail('streetRails.inset must keep a grinding courier over the sidewalk');
  if (sk.rails.length + 2 * sk.funboxes.length < SPEC.parkRails) fail(`the skatepark needs at least ${SPEC.parkRails} rails`);
  for (const [k, r] of sk.rails.entries()) {
    if (rails.height + r.points[0]![2] > move.jump.height) fail(`skatepark.rails[${k}] starts higher than a jump`);
    if (r.points.some((q) => rails.height + q[2] < rails.minClearance)) fail(`skatepark.rails[${k}] dips under rails.minClearance`);
    // It is approached along `dir`: it starts above `at`, and its first segment runs along `dir`
    const [p0, p1] = [r.points[0]!, r.points[1]!];
    if (p0[0] !== 0 || p0[1] !== 0 || p1[1] !== 0 || !(p1[0] > 0)) fail(`skatepark.rails[${k}] must start above its at spot, its first segment along dir`);
    // Both end segments level: leaving a rail down a sloped end segment, the courier's feet (lifted above the rail)
    // are closest to a point just short of the end, so the rail catches them again at once (PlayerSim tryStartGrind)
    const [q1, q0] = [r.points[r.points.length - 1]!, r.points[r.points.length - 2]!];
    if (p1[2] !== p0[2] || q1[2] !== q0[2]) fail(`skatepark.rails[${k}] must start and end with a level segment`);
  }
  if (rails.height > move.jump.height) fail('rails.height must be within a jump');
  const fr = sk.funbox.rail;
  if (fr.offset + move.capsule.radius > sk.funbox.width / 2) fail('skatepark.funbox.rail must stand over the deck');
  if (fr.inset + fr.endGap >= sk.funbox.deck || fr.inset <= 2 * move.capsule.radius) fail('skatepark.funbox.rail must fit along the deck after its approach');
}

/** A local frame on the ground: `o` its origin, `d` the unit direction along it, `c` across it (+z or +x). */
interface Frame { o: { x: number; z: number }; d: { x: number; z: number }; c: { x: number; z: number } }
const frame = (o: { x: number; z: number }, d: { x: number; z: number }): Frame => ({ o, d, c: d.x !== 0 ? { x: 0, z: 1 } : { x: 1, z: 0 } });
const point = (f: Frame, along: number, across: number, y: number): Vec3 =>
  v2({ x: f.o.x + f.d.x * along + f.c.x * across, y, z: f.o.z + f.d.z * along + f.c.z * across });
/** The rect between `along` a0…a1 and `across` c0…c1 of frame `f`. */
function rectIn(f: Frame, a0: number, a1: number, c0: number, c1: number): Rect {
  const ps = [point(f, a0, c0, 0), point(f, a1, c1, 0)];
  return { minX: Math.min(ps[0]!.x, ps[1]!.x), maxX: Math.max(ps[0]!.x, ps[1]!.x), minZ: Math.min(ps[0]!.z, ps[1]!.z), maxZ: Math.max(ps[0]!.z, ps[1]!.z) };
}

/** A local street block: the stretch of line `line` (x = at for `axis` 'z', z = at for 'x') between two crossings. */
interface Block { axis: 'x' | 'z'; at: number; from: number; to: number; crossings: boolean }

/** Where everything stands so far, while the district is being built. */
interface Build {
  ctx: DistrictContext;
  p: SuburbsParams;
  out: DistrictOutput;
  report: Pick<DistrictReport, 'rails' | 'ramps' | 'skatepark' | 'quay'> & { bowl?: BowlReport };
  /** The arterial cell given to the skatepark (between the arterials' centre lines). */
  cell: Rect;
  /** Footprints (with run-ups) of the park's pieces placed so far. */
  footprints: { id: string; rect: Rect }[];
  houses: number;
}

/**
 * Suburbs & Skatepark: a 100 m grid of wide streets (half-width 10) with houses on yards facing them, a skatepark
 * filling one arterial cell (quarter pipes, funboxes with deck rails, a bowl and a garden of ground rails), grind
 * rails along the sidewalks of a few streets, and the south water edge kept as an open beach-front quay with
 * respawn checkpoints.
 */
export function buildSuburbs(ctx: DistrictContext): DistrictOutput {
  const p = suburbsParams(ctx);
  const quays = districtQuays(ctx);
  const grid = districtGrid(ctx, { pitch: p.pitch, halfWidth: p.streetHalfWidth, edgeMargin: p.edgeMargin });
  const cell = parkCell(ctx, p);
  const b: Build = {
    ctx,
    p,
    out: emptyOutput({ nodes: [], edges: [] }),
    report: { rails: [], ramps: [], skatepark: parkRect(ctx, p, cell), quay: { quays, checkpoints: [] } },
    cell,
    footprints: [],
    houses: 0,
  };
  const blocks = buildStreets(b, grid);
  for (const lot of grid.lots) buildHouses(b, lot, quays);
  buildSkatepark(b);
  addStreetRails(b, blocks);
  addQuayCheckpoints(b, grid, quays);
  b.out.report = b.report;
  return b.out;
}

/** The arterial cell (between arterial centre lines) holding skatepark.cellAt; it must have arterials on all sides. */
function parkCell(ctx: DistrictContext, p: SuburbsParams): Rect {
  const area = intersectRect(ctx.rect, ctx.city.land);
  const { x, z } = p.skatepark.cellAt;
  const span = (axis: 'x' | 'z', v: number): [GridLine, GridLine] => {
    // No local streets: the lines are the arterials and the land edges (an infinite pitch splits no span)
    const lines = gridLines(axis === 'x' ? area.minX : area.minZ, axis === 'x' ? area.maxX : area.maxZ, ctx.city.arterials, axis, {
      pitch: Infinity,
      halfWidth: 0,
      edgeMargin: 0,
    });
    const k = lines.findIndex((l, i) => i + 1 < lines.length && l.at < v && v < lines[i + 1]!.at);
    if (k < 0) throw new Error(`district ${ctx.district}: skatepark.cellAt lies outside the district`);
    const pair: [GridLine, GridLine] = [lines[k]!, lines[k + 1]!];
    if (pair.some((l) => l.kind !== 'arterial')) throw new Error(`district ${ctx.district}: the skatepark cell must have arterials on all sides`);
    return pair;
  };
  const [w, e] = span('x', x);
  const [n, s] = span('z', z);
  return { minX: w.at, maxX: e.at, minZ: n.at, maxZ: s.at };
}

/** The skatepark plaza: its cell inside the arterials, `margin` in from them; at least SPEC.parkSize square, clear of the hub. */
function parkRect(ctx: DistrictContext, p: SuburbsParams, cell: Rect): Rect {
  const g = ctx.city.arterials.halfWidth + p.skatepark.margin;
  const r = { minX: r2(cell.minX + g), maxX: r2(cell.maxX - g), minZ: r2(cell.minZ + g), maxZ: r2(cell.maxZ - g) };
  if (r.maxX - r.minX < SPEC.parkSize || r.maxZ - r.minZ < SPEC.parkSize) throw new Error(`district ${ctx.district}: the skatepark is under ${SPEC.parkSize} m square`);
  const { center, clearRadius } = ctx.city.plaza;
  const gap = Math.hypot(Math.max(0, r.minX - center.x, center.x - r.maxX), Math.max(0, r.minZ - center.z, center.z - r.maxZ));
  if (gap <= clearRadius) throw new Error(`district ${ctx.district}: the skatepark enters the hub's clear circle`);
  return r;
}

const inside = (p: { x: number; z: number }, r: Rect): boolean => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;

/**
 * The local streets: every block of each local grid line between consecutive crossing lines, except inside the
 * skatepark cell. Returns the blocks built.
 */
function buildStreets(b: Build, grid: DistrictGrid): Block[] {
  const g = new GraphBuilder(`${b.ctx.district}-n`);
  const hw = b.p.streetHalfWidth;
  const blocks: Block[] = [];
  const along = (axis: 'x' | 'z', at: number, cross: GridLine[]): void => {
    for (let k = 0; k + 1 < cross.length; k++) {
      const [c0, c1] = [cross[k]!, cross[k + 1]!];
      const pt = (v: number): Vec3 => (axis === 'z' ? { x: at, y: 0, z: v } : { x: v, y: 0, z: at });
      if (inside(pt((c0.at + c1.at) / 2), b.cell)) continue;
      g.street([pt(c0.at), pt(c1.at)], hw);
      blocks.push({ axis, at, from: c0.at, to: c1.at, crossings: c0.kind !== 'edge' && c1.kind !== 'edge' });
    }
  };
  for (const x of grid.xs) if (x.kind === 'local') along('z', x.at, grid.zs);
  for (const z of grid.zs) if (z.kind === 'local') along('x', z.at, grid.xs);
  b.out.streets = g.graph();
  return blocks;
}

/**
 * Houses on a lot (outside the skatepark cell): filler rows facing its streets, set back behind front yards, none
 * on the beach-front apron along a quay.
 */
function buildHouses(b: Build, lot: GridLot, quays: QuayEdge[]): void {
  const { p, ctx } = b;
  if (inside({ x: (lot.rect.minX + lot.rect.maxX) / 2, z: (lot.rect.minZ + lot.rect.maxZ) / 2 }, b.cell)) return;
  let rect = lot.rect;
  for (const q of quays) {
    const limit = q.line - q.out * p.apronWidth;
    if (q.across === 'x') rect = q.out > 0 ? { ...rect, maxX: Math.min(rect.maxX, limit) } : { ...rect, minX: Math.max(rect.minX, limit) };
    else rect = q.out > 0 ? { ...rect, maxZ: Math.min(rect.maxZ, limit) } : { ...rect, minZ: Math.max(rect.minZ, limit) };
  }
  if (rect.maxX <= rect.minX || rect.maxZ <= rect.minZ) return;
  const params: FillerParams = { ...p.houses, pitch: p.pitch, streetHalfWidth: p.streetHalfWidth, edgeMargin: p.edgeMargin };
  const pieces: PieceEntry[] = p.houses.pieces.map((id) => ctx.pieces[id]!);
  const { plaza, palettes } = ctx.city;
  const newId = (): string => `${ctx.district}-h${b.houses++}`;
  for (const house of fillLot({ ...lot, rect }, ctx.rng, { params, pieces, palettes, plaza: { center: plaza.center, radius: plaza.clearRadius }, newId })) {
    b.out.props.push(house.prop);
    b.out.solids.push(...house.solids);
    b.out.poiSlots.push({ position: house.door, kind: 'door', elevated: false, district: ctx.district, access: 'street' });
  }
}

/** The skatepark's pieces, each kept inside the park and clear of the others (with their run-ups). */
function buildSkatepark(b: Build): void {
  const sk = b.p.skatepark;
  const id = `${b.ctx.district}-park`;
  buildBowl(b, `${id}-bowl`);
  sk.quarters.forEach((q, k) => buildQuarter(b, `${id}-qp-${k}`, q.at, DIRS[q.dir]));
  sk.funboxes.forEach((f, k) => buildFunbox(b, `${id}-fun-${k}`, f.at, f.axis));
  sk.rails.forEach((r, k) => buildGroundRail(b, `${id}-rail-${k}`, r));
}

/** The world point of a park spot. */
const parkPoint = (b: Build, [u, v]: UV): { x: number; z: number } => ({ x: b.report.skatepark.minX + u, z: b.report.skatepark.minZ + v });

/** Claims a footprint in the park: it must lie inside the park and keep `spacing` from every other one. */
function claim(b: Build, id: string, r: Rect): void {
  const park = b.report.skatepark;
  const fail = (why: string): never => {
    throw new Error(`district ${b.ctx.district}: ${id} ${why}`);
  };
  const eps = 1e-6;
  if (r.minX < park.minX - eps || r.maxX > park.maxX + eps || r.minZ < park.minZ - eps || r.maxZ > park.maxZ + eps) fail('(with its run-ups) leaves the skatepark');
  const gap = b.p.skatepark.spacing;
  for (const o of b.footprints) {
    if (r.minX < o.rect.maxX + gap && r.maxX > o.rect.minX - gap && r.minZ < o.rect.maxZ + gap && r.maxZ > o.rect.minZ - gap) fail(`(with its run-ups) crowds ${o.id}`);
  }
  b.footprints.push({ id, rect: r });
}

/**
 * A ramp face climbing along frame `f` from `from` (on the ground) through `sections`, `width` wide: one rotated
 * ramp slab per section, each thick enough to reach the ground under its crest (no gap beneath it, seen from the
 * side) and reaching `embed` on below the face before it. Returns the slabs, the crest (along) and its height.
 */
function climb(b: Build, id: string, f: Frame, from: number, width: number, sections: readonly Section[]): { solids: Solid[]; crest: number; height: number } {
  const embed = b.p.skatepark.embed;
  const solids: Solid[] = [];
  let [a, y] = [from, 0];
  sections.forEach((s, k) => {
    const rad = s.deg / DEG;
    const run = s.rise / Math.tan(rad);
    const lo = point(f, a, 0, y);
    const hi = point(f, a + run, 0, y + s.rise);
    solids.push(slopedSlab(`${id}-s${k}`, 'ramp', hi, lo, width, (y + s.rise) * Math.cos(rad), embed));
    [a, y] = [a + run, y + s.rise];
  });
  return { solids, crest: a, height: y };
}

/** Adds a ramp's solids and its report entry. */
function addRamp(b: Build, r: RampReport, solids: Solid[]): void {
  b.out.solids.push(...solids);
  b.report.ramps.push({ ...r, solids: solids.map((s) => s.id) });
}

/** The run (horizontal length) of a ramp face of `sections`. */
const runOf = (sections: readonly Section[]): number => sections.reduce((n, s) => n + s.rise / Math.tan(s.deg / DEG), 0);

/** A quarter pipe: the transition from its foot at `at` climbing toward `d`, onto a deck, with run-up and run-out kept clear. */
function buildQuarter(b: Build, id: string, at: UV, d: { x: number; z: number }): void {
  const sk = b.p.skatepark;
  const q = sk.quarter;
  const f = frame(parkPoint(b, at), d);
  const run = runOf(sk.transition);
  claim(b, id, rectIn(f, -sk.runUp, run + q.deck + q.runOut, -q.width / 2, q.width / 2));
  const { solids, crest, height } = climb(b, id, f, 0, q.width, sk.transition);
  const deck = box(`${id}-deck`, 'ramp', rectIn(f, crest, crest + q.deck, -q.width / 2, q.width / 2), 0, height);
  addRamp(b, { id, kind: 'quarter', solids: [], foot: point(f, 0, 0, 0), top: point(f, crest, 0, height), facing: { ...d } }, solids);
  b.out.solids.push(deck);
}

/** A funbox along `axis` centred at `at`: a ramp up from each end to its deck, and a rail along the deck. */
function buildFunbox(b: Build, id: string, at: UV, axis: 'x' | 'z'): void {
  const { p, ctx } = b;
  const fb = p.skatepark.funbox;
  const o = parkPoint(b, at);
  const f = frame(o, axis === 'x' ? DIRS['+x'] : DIRS['+z']);
  const section = [{ deg: fb.deg, rise: fb.height }];
  const run = runOf(section);
  const half = fb.deck / 2;
  claim(b, id, rectIn(f, -half - run - p.skatepark.runUp, half + run + p.skatepark.runUp, -fb.width / 2, fb.width / 2));
  for (const [end, d] of [['a', f.d], ['b', { x: -f.d.x, z: -f.d.z }]] as const) {
    const g = frame(o, d);
    const { solids, crest, height } = climb(b, `${id}-${end}`, g, -half - run, fb.width, section);
    addRamp(b, { id: `${id}-${end}`, kind: 'funbox', solids: [], foot: point(g, -half - run, 0, 0), top: point(g, crest, 0, height), facing: { ...d } }, solids);
  }
  b.out.solids.push(box(`${id}-deck`, 'ramp', rectIn(f, -half, half, -fb.width / 2, fb.width / 2), 0, fb.height));
  const y = fb.height + p.rails.height;
  const rail: Rail = { id: `${id}-rail`, points: [point(f, -half + fb.rail.inset, fb.rail.offset, y), point(f, half - fb.rail.endGap, fb.rail.offset, y)] };
  // The approach starts on the deck, a capsule's width in from its edge
  addRail(b, rail, 'skatepark', point(f, -half + 2 * ctx.move.capsule.radius, fb.rail.offset, fb.height));
}

/**
 * The bowl centred at bowl.at: the floor at ground level, a wall (the transition) climbing outward from each floor
 * edge (each spanning the corners, so neighbouring walls meet in a crease), a rim deck around them, and an outer ramp
 * up onto the rim in the middle of each side.
 */
function buildBowl(b: Build, id: string): void {
  const sk = b.p.skatepark;
  const bw = sk.bowl;
  const c = parkPoint(b, bw.at);
  const outer = [{ deg: bw.outerDeg, rise: sk.transition.reduce((n, s) => n + s.rise, 0) }];
  const f2 = bw.floor / 2;
  const i2 = f2 + runOf(sk.transition);
  const o2 = i2 + bw.rim;
  const out2 = o2 + runOf(outer);
  const square = (h: number): Rect => ({ minX: c.x - h, maxX: c.x + h, minZ: c.z - h, maxZ: c.z + h });
  claim(b, id, square(out2 + sk.runUp));
  const walls: string[] = [];
  const outerRamps: string[] = [];
  let height = 0;
  for (const [side, d] of [['n', DIRS['-z']], ['s', DIRS['+z']], ['w', DIRS['-x']], ['e', DIRS['+x']]] as const) {
    const f = frame(c, d);
    const wall = climb(b, `${id}-wall-${side}`, f, f2, 2 * i2, sk.transition);
    height = wall.height;
    addRamp(b, { id: `${id}-wall-${side}`, kind: 'bowl-wall', solids: [], foot: point(f, f2, 0, 0), top: point(f, wall.crest, 0, wall.height), facing: { ...d } }, wall.solids);
    walls.push(`${id}-wall-${side}`);
    const inward = frame(c, { x: -d.x, z: -d.z });
    const ramp = climb(b, `${id}-outer-${side}`, inward, -out2, bw.outerWidth, outer);
    const facing = { x: -d.x + 0, z: -d.z + 0 };
    addRamp(b, { id: `${id}-outer-${side}`, kind: 'bowl-outer', solids: [], foot: point(inward, -out2, 0, 0), top: point(inward, ramp.crest, 0, ramp.height), facing }, ramp.solids);
    outerRamps.push(`${id}-outer-${side}`);
  }
  // The rim deck: north and south strips across the whole bowl, west and east strips between them
  const ring: Rect[] = [
    { minX: c.x - o2, maxX: c.x + o2, minZ: c.z - o2, maxZ: c.z - i2 },
    { minX: c.x - o2, maxX: c.x + o2, minZ: c.z + i2, maxZ: c.z + o2 },
    { minX: c.x - o2, maxX: c.x - i2, minZ: c.z - i2, maxZ: c.z + i2 },
    { minX: c.x + i2, maxX: c.x + o2, minZ: c.z - i2, maxZ: c.z + i2 },
  ];
  ring.forEach((r, k) => b.out.solids.push(box(`${id}-rim-${k}`, 'ramp', r, 0, height)));
  b.report.bowl = { id, floor: square(f2), rim: square(o2), height, walls, outerRamps };
}

/** A rail on the park's ground: its points (along `dir`, across, up) from `at`, rails.height above the ground. */
function buildGroundRail(b: Build, id: string, r: SuburbsParams['skatepark']['rails'][number]): void {
  const { p } = b;
  const f = frame(parkPoint(b, r.at), DIRS[r.dir]);
  const along = r.points.map((q) => q[0]);
  const across = r.points.map((q) => q[1]);
  const pad = p.skatepark.spacing;
  claim(b, id, rectIn(f, -p.rails.runUp, Math.max(...along) + p.rails.runUp, Math.min(...across) - pad, Math.max(...across) + pad));
  const rail: Rail = { id, points: r.points.map(([a, c, up]) => point(f, a, c, p.rails.height + up)) };
  addRail(b, rail, 'skatepark', point(f, -p.rails.runUp, 0, 0));
}

function addRail(b: Build, rail: Rail, kind: 'street' | 'skatepark', approach: Vec3): void {
  b.out.rails.push(rail);
  b.report.rails.push({ id: rail.id, kind, approach });
}

/**
 * Street rails: on streetRails.count blocks of distinct streets (a seeded pick among the blocks between two
 * crossings with room for a long enough rail), along one sidewalk (a seeded side), `inset` in from its outer edge.
 */
function addStreetRails(b: Build, blocks: Block[]): void {
  const { p, ctx } = b;
  const sr = p.streetRails;
  const hw = p.streetHalfWidth;
  const room = (k: Block): number => k.to - k.from - 2 * (hw + sr.endGap);
  const cands = blocks.filter((k) => k.crossings && room(k) >= sr.minLength);
  // Seeded Fisher–Yates
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1));
    [cands[i], cands[j]] = [cands[j]!, cands[i]!];
  }
  const lines = new Set<string>();
  for (const k of cands) {
    if (lines.size === sr.count) break;
    const key = `${k.axis}${k.at}`;
    if (lines.has(key)) continue;
    lines.add(key);
    const side = ctx.rng() < 0.5 ? 1 : -1;
    const f = frame(k.axis === 'z' ? { x: k.at, z: 0 } : { x: 0, z: k.at }, k.axis === 'z' ? DIRS['+z'] : DIRS['+x']);
    const off = side * (hw - sr.inset);
    const y = ctx.city.streets.sidewalkTop + p.rails.height;
    const [a0, a1] = [k.from + hw + sr.endGap, k.to - hw - sr.endGap];
    const rail: Rail = { id: `${ctx.district}-rail-${b.report.rails.filter((r) => r.kind === 'street').length}`, points: [point(f, a0, off, y), point(f, a1, off, y)] };
    addRail(b, rail, 'street', point(f, a0 - p.rails.runUp, off, ctx.city.streets.sidewalkTop));
  }
  if (lines.size < sr.count) throw new Error(`district ${ctx.district}: only ${lines.size} streets have room for a rail (need ${sr.count})`);
}

/** Checkpoints along each quay, on the apron, off the streets that reach the water. */
function addQuayCheckpoints(b: Build, grid: DistrictGrid, quays: QuayEdge[]): void {
  const { p, ctx } = b;
  for (const q of quays) {
    const lines = q.across === 'z' ? grid.xs : grid.zs;
    const corridors = lines.filter((l) => l.kind !== 'edge').map((l) => ({ at: l.at, halfWidth: l.inset }));
    const cps = quayCheckpoints(q, corridors, {
      spacing: ctx.city.checkpointSpacing,
      inset: p.checkpoint.inset,
      clearance: p.checkpoint.streetClearance,
      prefix: `${ctx.district}-cp-${q.edge}-`,
    });
    b.out.checkpoints.push(...cps);
    b.report.quay.checkpoints.push(...cps.map((c) => c.id));
  }
}
