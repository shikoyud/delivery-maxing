import { ordersConfig, type PieceEntry, type Rect, type RotY, type Solid, type Vec3 } from '@dm/shared';
import {
  districtGrid,
  districtQuays,
  emptyOutput,
  paramChecks,
  quayCheckpoints,
  quayPoint,
  roofSlot,
  type DistrictContext,
  type DistrictGrid,
  type DistrictOutput,
  type DistrictReport,
  type GridLot,
  type QuayEdge,
} from '../district';
import {
  cableClear,
  MANTLE_STEP_MIN_RISE,
  mantleStepRises,
  mantleSteps,
  navLinkFor,
  obstacleOf,
  padFlightClear,
  padLaunchFor,
  zipBetween,
  GridIndex,
  type Obstacle,
} from '../kits';
import { box, distToRect, r2, top, v2 } from '../layout';
import { fillLot, type FillerParams } from '../lots';

/** Harbor Docks parameters (`params` of the harbor district in city.source.json). */
interface HarborParams {
  /** Local street pitch (about), m; local street half-width (road + sidewalks); gap kept from a land edge. */
  pitch: number;
  streetHalfWidth: number;
  edgeMargin: number;
  /** Nothing is built on the open apron this wide along each quay, m. */
  apronWidth: number;
  /** Chance that a lot away from the quays is a container yard (else a warehouse block). */
  yardChance: number;
  /** Warehouse rows along the streets of a warehouse block (filler rules, wide building pieces). */
  warehouses: Pick<FillerParams, 'pieces' | 'scaleMin' | 'scaleMax' | 'fillChance' | 'setback' | 'gapMin' | 'gapMax' | 'doorOffset'>;
  /** One container box, m: `length` across a yard row, `width` along it. */
  container: { length: number; width: number; height: number };
  /**
   * Yard rows of container stacks (`colsMin`–`colsMax` boxes side by side, `tiersMin`–`tiersMax` high), `gapMin`–
   * `gapMax` apart along the row, a stack in each slot with chance `fillChance`. Rows stand `aisle` apart, the mantle
   * steps of each row in the aisle on one side (+v with chance `stepsForwardChance`); yards keep `margin` from their
   * lot's edges. Inland, a yard's rows run along x with chance `rowsAlongXChance` (on a terminal, along the quay).
   */
  yard: {
    margin: number; aisle: number; colsMin: number; colsMax: number; tiersMin: number; tiersMax: number;
    gapMin: number; gapMax: number; fillChance: number; rowsAlongXChance: number; stepsForwardChance: number;
  };
  /** Rise of each mantle-step crate, at most, m. */
  stepRise: number;
  /** Room left in an aisle beyond the tallest stack's steps, to run at them, m. */
  runUp: number;
  /**
   * Tower cranes, `count` of them spread along the quays, `heightMin`–`heightMax` tall (the jib top). The mast stands
   * `setback` m inland of the quay line; the jib reaches `jibLength` inland of it and `counterJibLength` seaward.
   * Containers keep `clear` m inland of the mast.
   */
  crane: {
    count: number; heightMin: number; heightMax: number; setback: number; clear: number; mastSize: number;
    jibLength: number; counterJibLength: number; jibWidth: number; jibThickness: number;
    cab: { length: number; height: number }; counterweight: { length: number; height: number };
  };
  /**
   * Pads beside each mast (one each way along the quay, `offsets` m from the jib's line, the first clear flight wins)
   * launch onto the jib `targetAlong` m inland of the mast, over `apexAbove`.
   */
  pad: { radius: number; apexAbove: number; offsets: number[]; targetAlong: number; clearance: number };
  /**
   * From each jib's inland end a zip line runs down to a yard stack, and from its seaward end one runs down to the
   * quay apron (candidate ends every `apronStep` m). Each is `minLength`–`maxLength` long, no steeper than maxSlope;
   * its ends hang `endHeight` above the surface, `endInset` in from a jib end.
   */
  zip: { endHeight: number; endInset: number; minLength: number; maxLength: number; maxSlope: number; apronStep: number };
  /** Quay checkpoints stand `inset` m inland of the quay line, `streetClearance` m clear of the streets reaching it. */
  checkpoint: { inset: number; streetClearance: number };
}

/** Spec ranges the harbor params must stay within. */
const SPEC = { tiers: [1, 3], craneHeight: [30, 40], zipLength: [120, 300], minCranes: 3 } as const;

function harborParams(ctx: DistrictContext): HarborParams {
  const { fail, obj, nums, positive } = paramChecks(ctx.district, 'harbor');
  const p = ctx.params;
  nums(p, ['edgeMargin', 'apronWidth', 'yardChance', 'runUp'], '');
  positive(p, ['pitch', 'streetHalfWidth', 'stepRise'], '');
  nums(obj(p.warehouses, 'warehouses'), ['scaleMin', 'scaleMax', 'fillChance', 'setback', 'gapMin', 'gapMax', 'doorOffset'], 'warehouses.');
  positive(obj(p.container, 'container'), ['length', 'width', 'height'], 'container.');
  const yard = obj(p.yard, 'yard');
  nums(yard, ['margin', 'gapMin', 'gapMax', 'fillChance', 'rowsAlongXChance', 'stepsForwardChance'], 'yard.');
  positive(yard, ['aisle', 'colsMin', 'colsMax', 'tiersMin', 'tiersMax'], 'yard.');
  const crane = obj(p.crane, 'crane');
  nums(crane, ['setback', 'clear', 'counterJibLength'], 'crane.');
  positive(crane, ['count', 'heightMin', 'heightMax', 'mastSize', 'jibLength', 'jibWidth', 'jibThickness'], 'crane.');
  positive(obj(crane.cab, 'crane.cab'), ['length', 'height'], 'crane.cab.');
  positive(obj(crane.counterweight, 'crane.counterweight'), ['length', 'height'], 'crane.counterweight.');
  const pad = obj(p.pad, 'pad');
  nums(pad, ['apexAbove', 'targetAlong', 'clearance'], 'pad.');
  positive(pad, ['radius'], 'pad.');
  if (!Array.isArray(pad.offsets) || pad.offsets.length === 0 || !pad.offsets.every((x) => typeof x === 'number' && x > 0)) {
    fail('pad.offsets must list positive numbers');
  }
  const zip = obj(p.zip, 'zip');
  nums(zip, ['endHeight', 'endInset'], 'zip.');
  positive(zip, ['minLength', 'maxLength', 'maxSlope', 'apronStep'], 'zip.');
  nums(obj(p.checkpoint, 'checkpoint'), ['inset', 'streetClearance'], 'checkpoint.');

  const h = p as unknown as HarborParams;
  const { yard: y, crane: c, zip: z } = h;
  const move = ctx.move;
  const chances = {
    yardChance: h.yardChance, 'yard.fillChance': y.fillChance, 'yard.rowsAlongXChance': y.rowsAlongXChance,
    'yard.stepsForwardChance': y.stepsForwardChance, 'warehouses.fillChance': h.warehouses.fillChance,
  };
  for (const [k, v] of Object.entries(chances)) {
    if (v > 1) fail(`${k} must be at most 1`);
  }
  for (const [k, v] of Object.entries({ 'yard.colsMin': y.colsMin, 'yard.colsMax': y.colsMax, 'yard.tiersMin': y.tiersMin, 'yard.tiersMax': y.tiersMax, 'crane.count': c.count })) {
    if (!Number.isInteger(v)) fail(`${k} must be an integer`);
  }
  if (y.colsMin < 1 || y.colsMax < y.colsMin) fail('need 1 ≤ yard.colsMin ≤ yard.colsMax');
  if (y.tiersMin < SPEC.tiers[0] || y.tiersMax < y.tiersMin || y.tiersMax > SPEC.tiers[1]) fail('need 1 ≤ yard.tiersMin ≤ yard.tiersMax ≤ 3');
  if (y.gapMax < y.gapMin) fail('need yard.gapMin ≤ yard.gapMax');
  // Ruling R17: a kit step a running courier can mantle rises at least MANTLE_STEP_MIN_RISE (the wall probe height)
  if (h.stepRise < MANTLE_STEP_MIN_RISE || h.stepRise > move.mantle.maxHeight) {
    fail(`stepRise must be within [${MANTLE_STEP_MIN_RISE}, mantle.maxHeight ${move.mantle.maxHeight}] (R17)`);
  }
  // …and so does every rise the steps of a 1…tiersMax stack really make (the climb split evenly: tiers·height/(n + 1))
  for (let t = y.tiersMin; t <= y.tiersMax; t++) {
    for (const r of mantleStepRises(t * h.container.height, h.stepRise)) {
      if (r < MANTLE_STEP_MIN_RISE - 1e-6 || r > Math.min(h.stepRise, move.mantle.maxHeight) + 1e-6) {
        fail(`a ${t}-tier stack's mantle steps rise ${r.toFixed(2)} m, outside [${MANTLE_STEP_MIN_RISE}, stepRise] (R17)`);
      }
    }
  }
  if (h.warehouses.scaleMin <= 0 || h.warehouses.scaleMax < h.warehouses.scaleMin) fail('need 0 < warehouses.scaleMin ≤ scaleMax');
  if (h.warehouses.gapMax < h.warehouses.gapMin) fail('need warehouses.gapMin ≤ gapMax');
  if (c.count < SPEC.minCranes) fail(`crane.count must be at least ${SPEC.minCranes}`);
  if (c.heightMin < SPEC.craneHeight[0] || c.heightMax < c.heightMin || c.heightMax > SPEC.craneHeight[1]) {
    fail('need 30 ≤ crane.heightMin ≤ crane.heightMax ≤ 40');
  }
  if (c.setback - c.mastSize / 2 <= h.apronWidth) fail('the crane mast must stand inland of the apron');
  if (c.jibLength + c.counterJibLength > ctx.city.chunkSize) fail('a jib must fit in one chunk');
  if (h.pad.apexAbove > ordersConfig.fragile.maxFallMeters) fail('pad.apexAbove must keep the fall onto the jib Fragile-safe');
  if (z.minLength < SPEC.zipLength[0] || z.maxLength < z.minLength || z.maxLength > SPEC.zipLength[1]) {
    fail('need 120 ≤ zip.minLength ≤ zip.maxLength ≤ 300');
  }
  if (h.checkpoint.inset >= h.apronWidth) fail('checkpoints must stand on the apron');
  // The tallest stack's steps, plus the run-up, fit in an aisle
  const steps = mantleSteps({ x: 0, y: 0, z: 0 }, { x: 0, y: y.tiersMax * h.container.height, z: 0 }, 0, h.stepRise);
  const run = steps.length > 0 ? Math.max(...steps.map((s) => s.size.z / 2 - s.center.z)) : 0;
  if (run + h.runUp > y.aisle) fail(`yard.aisle must hold the tallest stack's ${run} m of steps and the run-up`);
  for (const id of h.warehouses.pieces) {
    if (ctx.pieces[id]?.kind !== 'building') fail(`warehouses.pieces: ${String(id)} is not a building piece`);
  }
  return h;
}

/** Which way a lot is used. */
type LotUse = 'warehouses' | 'yard';
/** An axis-aligned frame: `u` runs along `axis`, `v` across it. */
type Axis = 'x' | 'z';
const world = (axis: Axis, u: number, v: number): { x: number; z: number } => (axis === 'x' ? { x: u, z: v } : { x: v, z: u });
const rectUV = (axis: Axis, r: Rect): { u0: number; u1: number; v0: number; v1: number } =>
  axis === 'x' ? { u0: r.minX, u1: r.maxX, v0: r.minZ, v1: r.maxZ } : { u0: r.minZ, u1: r.maxZ, v0: r.minX, v1: r.maxX };
const rectOf = (axis: Axis, u0: number, u1: number, v0: number, v1: number): Rect =>
  axis === 'x' ? { minX: u0, maxX: u1, minZ: v0, maxZ: v1 } : { minX: v0, maxX: v1, minZ: u0, maxZ: u1 };
/** The yaw that faces +v (`sign` 1) or −v along the v axis of `axis`. */
const faceV = (axis: Axis, sign: 1 | -1): RotY => (axis === 'x' ? (sign > 0 ? 0 : 180) : sign > 0 ? 90 : 270);

/** A tower crane as planned: its mast on quay `quay`, the jib running inland along `inward`. */
interface CranePlan { id: string; quay: QuayEdge; lot: GridLot; mast: { x: number; z: number }; inward: { x: number; z: number }; height: number }

/** Where everything stands so far, while the district is being built. */
interface Build {
  ctx: DistrictContext;
  p: HarborParams;
  out: DistrictOutput;
  report: Pick<DistrictReport, 'padTargets' | 'zipLines' | 'containerStacks' | 'cranes' | 'quay'>;
  obstacles: GridIndex<Obstacle>;
  /** Street corridors crossing each quay (along-quay centre lines and half-widths). */
  corridors: Map<QuayEdge, { at: number; halfWidth: number }[]>;
  /** Zip line ends taken so far ("x,z"): a candidate end serves one zip only. */
  zipEnds: Set<string>;
  /** Warehouses placed so far (for their ids). */
  warehouses: number;
}

/**
 * Harbor Docks: a 100 m street grid between the quays on the east and south water edges. The lots along the quays are
 * container terminals: an open apron along the water (with a respawn checkpoint every ≤ 150 m), tower cranes 30–40 m
 * tall a little inland, and container yards behind. Lots further in are container yards or blocks of warehouses.
 * Containers stand in stacks of 1–3, each climbed by its mantle steps. Pads beside each crane mast launch onto the jib;
 * long zip lines run from the jib ends down to a yard stack and to the apron.
 */
export function buildHarbor(ctx: DistrictContext): DistrictOutput {
  const p = harborParams(ctx);
  const quays = districtQuays(ctx);
  if (quays.length === 0) throw new Error(`district ${ctx.district}: the harbor needs a water edge`);
  const grid = districtGrid(ctx, { pitch: p.pitch, halfWidth: p.streetHalfWidth, edgeMargin: p.edgeMargin });
  const b: Build = {
    ctx,
    p,
    out: emptyOutput(grid.streets),
    report: { padTargets: [], zipLines: [], containerStacks: [], cranes: [], quay: { quays, checkpoints: [] } },
    obstacles: new GridIndex<Obstacle>(ctx.city.chunkSize / 2),
    corridors: new Map(quays.map((q) => [q, streetCorridors(grid, q)])),
    zipEnds: new Set(),
    warehouses: 0,
  };

  const { uses, terminals } = planLots(b, grid, quays);
  const cranes = planCranes(b, terminals);
  for (const lot of grid.lots) {
    if (uses.get(lot) === 'warehouses') buildWarehouses(b, lot);
    else buildYard(b, lot, terminals.get(lot) ?? [], cranes.filter((c) => c.lot === lot));
  }
  for (const c of cranes) buildCrane(b, c);
  addQuayCheckpoints(b);
  for (const c of cranes) addCranePads(b, c);
  for (const c of cranes) addCraneZips(b, c);
  b.out.report = b.report;
  return b.out;
}

/** The street corridors crossing quay `q`: the grid lines along it that carry a street. */
function streetCorridors(grid: DistrictGrid, q: QuayEdge): { at: number; halfWidth: number }[] {
  const lines = q.across === 'z' ? grid.xs : grid.zs;
  return lines.filter((l) => l.kind !== 'edge').map((l) => ({ at: l.at, halfWidth: l.inset }));
}

/** How far lot `lot` is from quay `q`'s line on its seaward side (0 when it reaches the quay). */
function lotToQuay(lot: GridLot, q: QuayEdge): number {
  const r = lot.rect;
  const outer = q.across === 'z' ? (q.out > 0 ? r.maxZ : r.minZ) : q.out > 0 ? r.maxX : r.minX;
  return Math.abs(q.line - outer);
}

/**
 * Lot uses: lots reaching a quay are terminals (yards behind the apron); a lot near the plaza is warehouses (the filler
 * keeps them out of its circle); the rest are yards with chance yardChance, else warehouses.
 */
function planLots(b: Build, grid: DistrictGrid, quays: QuayEdge[]): { uses: Map<GridLot, LotUse>; terminals: Map<GridLot, QuayEdge[]> } {
  const { p, ctx } = b;
  const { plaza } = ctx.city;
  const uses = new Map<GridLot, LotUse>();
  const terminals = new Map<GridLot, QuayEdge[]>();
  for (const lot of grid.lots) {
    const on = quays.filter((q) => lotToQuay(lot, q) <= p.edgeMargin + 0.01);
    if (on.length > 0) terminals.set(lot, on);
    const nearPlaza = distToRect(plaza.center, lot.rect) <= plaza.clearRadius;
    uses.set(lot, on.length > 0 || (!nearPlaza && ctx.rng() < p.yardChance) ? 'yard' : 'warehouses');
  }
  return { uses, terminals };
}

/**
 * Crane sites: crane.count terminal lots spread evenly along the quays (each quay's own terminals in order along it,
 * the lots on two quays left out), the mast in the middle of the lot `setback` m inland of the quay line.
 */
function planCranes(b: Build, terminals: Map<GridLot, QuayEdge[]>): CranePlan[] {
  const { p, ctx } = b;
  const sites: { lot: GridLot; quay: QuayEdge }[] = [];
  for (const q of b.report.quay.quays) {
    const mid = (l: GridLot): number => (q.across === 'z' ? (l.rect.minX + l.rect.maxX) / 2 : (l.rect.minZ + l.rect.maxZ) / 2);
    const lots = [...terminals].filter(([, qs]) => qs.length === 1 && qs[0] === q).map(([l]) => l);
    for (const lot of lots.sort((a, c) => mid(a) - mid(c))) sites.push({ lot, quay: q });
  }
  if (sites.length < p.crane.count) throw new Error(`district ${ctx.district}: only ${sites.length} terminal lots for ${p.crane.count} cranes`);
  return Array.from({ length: p.crane.count }, (_, k) => {
    const { lot, quay } = sites[Math.floor(((k + 0.5) * sites.length) / p.crane.count)]!;
    const along = quay.across === 'z' ? (lot.rect.minX + lot.rect.maxX) / 2 : (lot.rect.minZ + lot.rect.maxZ) / 2;
    const m = quayPoint(quay, r2(along), p.crane.setback, 0);
    const inward = quay.across === 'x' ? { x: -quay.out, z: 0 } : { x: 0, z: -quay.out };
    const height = r2(p.crane.heightMin + ctx.rng() * (p.crane.heightMax - p.crane.heightMin));
    return { id: `${ctx.district}-crane-${k}`, quay, lot, mast: { x: m.x, z: m.z }, inward, height };
  });
}

/** Adds solids to the output and the obstacle index. */
function addSolids(b: Build, solids: Solid[]): void {
  for (const s of solids) {
    b.out.solids.push(s);
    b.obstacles.add(obstacleOf(s));
  }
}

/** A block of warehouses: filler rows of wide pieces along each street, with door slots and roof slots. */
function buildWarehouses(b: Build, lot: GridLot): void {
  const { p, ctx } = b;
  const w = p.warehouses;
  const params: FillerParams = { ...w, pitch: p.pitch, streetHalfWidth: p.streetHalfWidth, edgeMargin: p.edgeMargin };
  const pieces: PieceEntry[] = w.pieces.map((id) => ctx.pieces[id]!);
  const { plaza, palettes } = ctx.city;
  const newId = (): string => `${ctx.district}-w${b.warehouses++}`;
  const placed = fillLot(lot, ctx.rng, { params, pieces, palettes, plaza: { center: plaza.center, radius: plaza.clearRadius }, newId });
  for (const wh of placed) {
    b.out.props.push(wh.prop);
    addSolids(b, wh.solids);
    b.out.poiSlots.push({ position: wh.door, kind: 'door', elevated: false, district: ctx.district, access: 'street' });
    const roof = wh.solids.reduce((a, c) => (top(c) > top(a) ? c : a));
    if (!roof.rotationDeg) b.out.poiSlots.push(roofSlot(ctx.district, roof, 'kit'));
  }
}

/**
 * A container yard on a lot: rows of stacks along the lot (along the quay on a terminal), each stack with its mantle
 * steps in the aisle on the rows' step side. A terminal keeps its yard off the apron and `crane.clear` m inland of a
 * crane mast on it.
 */
function buildYard(b: Build, lot: GridLot, quays: QuayEdge[], cranes: CranePlan[]): void {
  const { p, ctx } = b;
  const y = p.yard;
  let r: Rect = { minX: lot.rect.minX + y.margin, minZ: lot.rect.minZ + y.margin, maxX: lot.rect.maxX - y.margin, maxZ: lot.rect.maxZ - y.margin };
  const cut = (q: QuayEdge, inset: number): void => {
    const limit = q.line - q.out * inset;
    if (q.across === 'x') r = q.out > 0 ? { ...r, maxX: Math.min(r.maxX, limit) } : { ...r, minX: Math.max(r.minX, limit) };
    else r = q.out > 0 ? { ...r, maxZ: Math.min(r.maxZ, limit) } : { ...r, minZ: Math.max(r.minZ, limit) };
  };
  for (const q of quays) cut(q, p.apronWidth);
  for (const c of cranes) cut(c.quay, p.crane.setback + p.crane.clear);
  const axis: Axis = quays.length > 0 ? (quays[0]!.across === 'z' ? 'x' : 'z') : ctx.rng() < y.rowsAlongXChance ? 'x' : 'z';
  const side: 1 | -1 = ctx.rng() < y.stepsForwardChance ? 1 : -1; // the aisle holding each row's steps is on this side (in v)
  const { u0, u1, v0, v1 } = rectUV(axis, r);
  const { length: L, width: W } = p.container;
  const pick = (lo: number, hi: number): number => lo + Math.floor(ctx.rng() * (hi - lo + 1));
  for (let row = 0; ; row++) {
    // Block across [vb, vb + L], its aisle on `side`
    const vb = side > 0 ? v0 + row * (L + y.aisle) : v0 + y.aisle + row * (L + y.aisle);
    if ((side > 0 ? vb + L + y.aisle : vb + L) > v1 + 1e-9) break;
    for (let u = u0; ; ) {
      let cols = pick(y.colsMin, y.colsMax);
      cols = Math.min(cols, Math.floor((u1 - u + 1e-9) / W));
      if (cols < y.colsMin) break;
      if (ctx.rng() < y.fillChance) addStack(b, axis, side, u, cols, vb, pick(y.tiersMin, y.tiersMax));
      u += cols * W + y.gapMin + ctx.rng() * (y.gapMax - y.gapMin);
    }
  }
}

/** A stack of `cols` × `tiers` containers in yard frame `axis` at u…, vb…, with its mantle steps on `side`. */
function addStack(b: Build, axis: Axis, side: 1 | -1, u: number, cols: number, vb: number, tiers: number): void {
  const { p, ctx, out, report } = b;
  const { length: L, width: W, height: H } = p.container;
  const id = `${ctx.district}-stack-${report.containerStacks.length}`;
  const boxes: Solid[] = [];
  for (let c = 0; c < cols; c++) {
    for (let t = 0; t < tiers; t++) {
      boxes.push(box(`${id}-c${c}-${t}`, 'container', rectOf(axis, r2(u + c * W), r2(u + (c + 1) * W), r2(vb), r2(vb + L)), t * H, (t + 1) * H));
    }
  }
  const rect = rectOf(axis, r2(u), r2(u + cols * W), r2(vb), r2(vb + L));
  const topY = r2(tiers * H);
  // Steps against the face on `side`, centred on the middle box (not on a seam between two boxes, where the mantle's
  // probes would run along the boxes' faces), climbing toward −side
  const face = side > 0 ? vb + L : vb;
  const mid = u + (Math.floor(cols / 2) + 0.5) * W;
  const dir = faceV(axis, side > 0 ? -1 : 1);
  const base = world(axis, mid, face);
  const steps = mantleSteps({ x: base.x, y: 0, z: base.z }, { x: base.x, y: topY, z: base.z }, dir, p.stepRise, `${id}-step`);
  addSolids(b, [...boxes, ...steps]);
  // The climb starts 1 m out from the lowest crate's outer face and ends 1 m onto the top
  const lowest = steps[0]!;
  const [lowV, lowDepth] = axis === 'x' ? [lowest.center.z, lowest.size.z] : [lowest.center.x, lowest.size.x];
  const reach = world(axis, mid, face + side * (Math.abs(lowV - face) + lowDepth / 2 + 1));
  const onTop = world(axis, mid, face - side * 1);
  out.navLinks.push(navLinkFor({ kind: 'mantle', id: `${id}-climb`, from: v2({ ...reach, y: 0 }), to: v2({ ...onTop, y: topY }) }));
  out.poiSlots.push({ position: v2({ x: (rect.minX + rect.maxX) / 2, y: topY, z: (rect.minZ + rect.maxZ) / 2 }), kind: 'door', elevated: true, district: ctx.district, access: 'route' });
  report.containerStacks.push({ id, rect, top: topY, tiers, steps: steps.map((s) => s.id), dir });
}

/** A footprint `length` along the jib from `from` m inland of the mast (negative: seaward), as wide as the jib. */
function alongJib(p: HarborParams, c: CranePlan, from: number, length: number, width = p.crane.jibWidth): Rect {
  const { inward: d, mast: m } = c;
  const a = { x: m.x + d.x * from, z: m.z + d.z * from };
  const e = { x: m.x + d.x * (from + length), z: m.z + d.z * (from + length) };
  const half = width / 2;
  return {
    minX: r2(Math.min(a.x, e.x) - (d.x === 0 ? half : 0)),
    maxX: r2(Math.max(a.x, e.x) + (d.x === 0 ? half : 0)),
    minZ: r2(Math.min(a.z, e.z) - (d.z === 0 ? half : 0)),
    maxZ: r2(Math.max(a.z, e.z) + (d.z === 0 ? half : 0)),
  };
}

/** A tower crane: mast, jib (its top the walkway at `height`), a cab under the jib and a counterweight. */
function buildCrane(b: Build, c: CranePlan): void {
  const { p } = b;
  const k = p.crane;
  const under = c.height - k.jibThickness;
  const half = k.mastSize / 2;
  const mast = { minX: c.mast.x - half, maxX: c.mast.x + half, minZ: c.mast.z - half, maxZ: c.mast.z + half };
  const jib = alongJib(p, c, -k.counterJibLength, k.counterJibLength + k.jibLength);
  addSolids(b, [
    box(`${c.id}-mast`, 'crane', mast, 0, under),
    box(`${c.id}-jib`, 'crane', jib, under, c.height),
    box(`${c.id}-cab`, 'crane', alongJib(p, c, half, k.cab.length, k.mastSize), under - k.cab.height, under),
    box(`${c.id}-counterweight`, 'crane', alongJib(p, c, -k.counterJibLength, k.counterweight.length), under - k.counterweight.height, under),
  ]);
  b.report.cranes.push({ id: c.id, height: c.height, jib, pads: [], zips: [] });
}

/** Checkpoints along each quay, on the apron, off the streets that reach the water. */
function addQuayCheckpoints(b: Build): void {
  const { p, ctx } = b;
  for (const q of b.report.quay.quays) {
    const cps = quayCheckpoints(q, b.corridors.get(q)!, {
      spacing: ctx.city.checkpointSpacing,
      inset: p.checkpoint.inset,
      clearance: p.checkpoint.streetClearance,
      prefix: `${ctx.district}-cp-${q.edge}-`,
    });
    b.out.checkpoints.push(...cps);
    b.report.quay.checkpoints.push(...cps.map((c) => c.id));
  }
}

/**
 * Pads up to the jib: one on each side of the mast along the quay, at the first of pad.offsets from the jib's line
 * whose flight onto the jib (targetAlong inland of the mast) is clear.
 */
function addCranePads(b: Build, c: CranePlan): void {
  const { p, ctx, out, report } = b;
  const g = ctx.move.gravity;
  const crane = report.cranes.find((x) => x.id === c.id)!;
  const target = v2({ x: c.mast.x + c.inward.x * p.pad.targetAlong, y: c.height, z: c.mast.z + c.inward.z * p.pad.targetAlong });
  const across = { x: c.inward.z, z: c.inward.x }; // along the quay
  for (const sideSign of [1, -1]) {
    for (const offset of p.pad.offsets) {
      const position = v2({ x: c.mast.x + across.x * sideSign * offset, y: 0, z: c.mast.z + across.z * sideSign * offset });
      const launch = padLaunchFor(position, target, p.pad.apexAbove, g);
      const near = b.obstacles.near({ minX: Math.min(position.x, target.x), maxX: Math.max(position.x, target.x), minZ: Math.min(position.z, target.z), maxZ: Math.max(position.z, target.z) }, 2);
      if (!padFlightClear(position, launch, target, g, ctx.move.capsule.radius, p.pad.clearance, near)) continue;
      const pad = { id: `${c.id}-pad-${crane.pads.length}`, position, radius: p.pad.radius, launch };
      out.jumpPads.push(pad);
      out.navLinks.push(navLinkFor({ ...pad, target }));
      report.padTargets.push({ pad: pad.id, target, landing: crane.jib });
      crane.pads.push(pad.id);
      break;
    }
  }
  if (crane.pads.length === 0) throw new Error(`district ${ctx.district}: no clear pad flight onto ${c.id}`);
}

/**
 * Zip lines off the jib: from its inland end down to a yard stack, and from its seaward end down to the apron. Each
 * end is the first (in a seeded shuffle) of the candidates `minLength`–`maxLength` away, no steeper than maxSlope,
 * with the cable clear below by the hang drop; a candidate end serves one zip only.
 */
function addCraneZips(b: Build, c: CranePlan): void {
  const { p, ctx, out, report } = b;
  const crane = report.cranes.find((x) => x.id === c.id)!;
  const z = p.zip;
  const endY = c.height + z.endHeight;
  const jibEnd = (along: number): Vec3 => v2({ x: c.mast.x + c.inward.x * along, y: endY, z: c.mast.z + c.inward.z * along });
  const stackEnds = report.containerStacks.map((s) => v2({ x: (s.rect.minX + s.rect.maxX) / 2, y: s.top + z.endHeight, z: (s.rect.minZ + s.rect.maxZ) / 2 }));
  const apronEnds: Vec3[] = [];
  const corridors = b.corridors.get(c.quay)!;
  for (let a = c.quay.from + z.apronStep / 2; a < c.quay.to; a += z.apronStep) {
    if (corridors.some((s) => Math.abs(a - s.at) < s.halfWidth + p.checkpoint.streetClearance)) continue;
    apronEnds.push(quayPoint(c.quay, a, p.apronWidth / 2, z.endHeight));
  }
  for (const [from, ends, label] of [
    [jibEnd(p.crane.jibLength - z.endInset), stackEnds, 'a yard stack'],
    [jibEnd(-(p.crane.counterJibLength - z.endInset)), apronEnds, 'the apron'],
  ] as const) {
    const to = pickZipEnd(b, from, ends);
    if (!to) throw new Error(`district ${ctx.district}: no clear zip line from ${c.id} down to ${label}`);
    const zip = zipBetween(from, to, `${c.id}-zip-${crane.zips.length}`);
    out.zipLines.push(zip);
    out.navLinks.push(navLinkFor(zip));
    report.zipLines.push(zip.id);
    crane.zips.push(zip.id);
  }
}

/** The first candidate end (in a seeded shuffle) that makes a clear zip line from `from`, or null. */
function pickZipEnd(b: Build, from: Vec3, ends: readonly Vec3[]): Vec3 | null {
  const { p, ctx } = b;
  const z = p.zip;
  const used = b.zipEnds;
  const cands = ends.filter((e) => {
    const run = Math.hypot(e.x - from.x, e.z - from.z);
    const len = Math.hypot(run, e.y - from.y);
    return len >= z.minLength && len <= z.maxLength && Math.abs(from.y - e.y) / run <= z.maxSlope && !used.has(`${e.x},${e.z}`);
  });
  // Seeded Fisher–Yates
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1));
    [cands[i], cands[j]] = [cands[j]!, cands[i]!];
  }
  for (const e of cands) {
    const span = { minX: Math.min(from.x, e.x), maxX: Math.max(from.x, e.x), minZ: Math.min(from.z, e.z), maxZ: Math.max(from.z, e.z) };
    if (!cableClear(from, e, ctx.move.zipLine.hangDrop, ctx.move.capsule.radius, b.obstacles.near(span, 1))) continue;
    used.add(`${e.x},${e.z}`);
    return e;
  }
  return null;
}
