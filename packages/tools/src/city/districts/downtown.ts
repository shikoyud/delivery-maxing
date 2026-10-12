import { solidRect, type PieceEntry, type Prop, type Rect, type RotY, type Solid, type Vec3 } from '@dm/shared';
import {
  districtGrid,
  emptyOutput,
  type DistrictContext,
  type DistrictOutput,
  type DistrictReport,
  type GridLot,
  type PoiSlot,
} from '../district';
import { cableClear, navLinkFor, padFlightClear, padLaunchFor, zipBetween, type Obstacle } from '../kits';
import { r2, v2, type GridLine } from '../layout';
import { propSolids } from '../lots';

/** Downtown Rooftops parameters (`params` of the downtown district in city.source.json). */
interface DowntownParams {
  /** Local street pitch (about), m; local street half-width (road + sidewalks); gap kept from a land edge. */
  pitch: number;
  streetHalfWidth: number;
  edgeMargin: number;
  /** Building fronts stand this far back from the lot edge; rows end rowEndMargin further in from a side street. */
  setback: number;
  rowEndMargin: number;
  doorOffset: number;
  /** Buildings are placed at artScaleMin–artScaleMax of the source art; the catalog pieces are baked at bakeScale. */
  bakeScale: number;
  artScaleMin: number;
  artScaleMax: number;
  /** Roof gaps along a row; a step up is only taken across a gap of at most roofGapMaxUp. */
  roofGapMin: number;
  roofGapMax: number;
  roofGapMaxUp: number;
  /** Height steps along a marked route: at most stepUpMax up, and down at most stepDownMax counting the jump's rise. */
  stepUpMax: number;
  stepDownMax: number;
  /** Every route roof is at least this long along the route, and long enough to land a sprint jump on with this margin. */
  minRoofLength: number;
  landingMargin: number;
  /** Building piece ids with pick weights, for every row. */
  rowPieces: Record<string, number>;
  /** Chance that each slot of a row off the marked routes gets a building. */
  fillChance: number;
  alley: { width: number; pieces: string[]; artScale: number; minLength: number; minHeight: number; chance: number; min: number };
  pad: { radius: number; apexAbove: number; inset: number; clearance: number };
  zip: { endHeight: number; endInset: number; maxSlope: number; minInto: number };
  /** Boost orb height above a roof (the courier's centre is 1 m above the feet), and inset from the roof's back edge. */
  orbHeight: number;
  orbBackInset: number;
}

function downtownParams(ctx: DistrictContext): DowntownParams {
  const fail = (why: string): never => {
    throw new Error(`district ${ctx.district}: downtown params: ${why}`);
  };
  const obj = (v: unknown, name: string): Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${name} must be an object`);
  const nums = (o: Record<string, unknown>, keys: string[], name: string): void => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail(`${name}${k} must be a non-negative number`);
    }
  };
  const p = ctx.params;
  nums(p, [
    'pitch', 'streetHalfWidth', 'edgeMargin', 'setback', 'rowEndMargin', 'doorOffset', 'bakeScale', 'artScaleMin', 'artScaleMax',
    'roofGapMin', 'roofGapMax', 'roofGapMaxUp', 'stepUpMax', 'stepDownMax', 'minRoofLength', 'landingMargin', 'fillChance', 'orbHeight',
    'orbBackInset',
  ], '');
  nums(obj(p.alley, 'alley'), ['width', 'artScale', 'minLength', 'minHeight', 'chance', 'min'], 'alley.');
  nums(obj(p.pad, 'pad'), ['radius', 'apexAbove', 'inset', 'clearance'], 'pad.');
  nums(obj(p.zip, 'zip'), ['endHeight', 'endInset', 'maxSlope', 'minInto'], 'zip.');
  const d = p as unknown as DowntownParams;
  if (d.bakeScale <= 0 || d.artScaleMin <= 0 || d.artScaleMax < d.artScaleMin) fail('need bakeScale > 0 and 0 < artScaleMin ≤ artScaleMax');
  if (d.roofGapMax < d.roofGapMin || d.roofGapMaxUp < d.roofGapMin) fail('need roofGapMin ≤ roofGapMaxUp, roofGapMax');
  if (d.stepDownMax <= ctx.move.jump.height) fail('stepDownMax must exceed the jump height');
  const building = (id: string): PieceEntry => {
    const e = ctx.pieces[id];
    if (e?.kind !== 'building' || e.roofY === null) fail(`${id} is not a flat-roofed building piece`);
    return e!;
  };
  for (const [id, w] of Object.entries(obj(p.rowPieces, 'rowPieces'))) {
    building(id);
    if (typeof w !== 'number' || !(w > 0)) fail(`rowPieces.${id} must be a positive weight`);
  }
  if (!Array.isArray(d.alley.pieces) || d.alley.pieces.length === 0) fail('alley.pieces must list building piece ids');
  d.alley.pieces.forEach(building);
  return d;
}

type Side = 'n' | 's';
/** Facing each street side: the door (+z) turned toward it. */
const FACING: Record<Side, RotY> = { n: 180, s: 0 };

/** A building as placed: its prop, collider solids, footprint (art ∪ colliders), roof (top collider) and door slot. */
interface Building {
  prop: Prop;
  solids: Solid[];
  footprint: Rect;
  roof: { rect: Rect; top: number; solid: Solid };
  door: Vec3;
}

/** A row of buildings along a lot's north or south street, listed in route order (`dir` along x). */
interface Row { lot: GridLot; side: Side; dir: 1 | -1; buildings: Building[] }

/** The pieces of an alley's north and south walls (west to east), and the longer wall's length. */
interface AlleyPlan { walls: [PieceEntry[], PieceEntry[]]; length: number }

/** For each span between consecutive lines: the cell (span between non-local lines) it lies in and its index there. */
function spanCells(lines: GridLine[]): { cell: number; local: number; count: number }[] {
  const out: { cell: number; local: number; count: number }[] = [];
  let cell = 0;
  let start = 0;
  for (let i = 0; i + 1 < lines.length; i++) {
    if (i > 0 && lines[i]!.kind !== 'local') {
      cell++;
      start = i;
    }
    out.push({ cell, local: i - start, count: 0 });
  }
  for (const o of out) o.count = out.filter((q) => q.cell === o.cell).length;
  return out;
}

const union = (rs: Rect[]): Rect => ({
  minX: Math.min(...rs.map((r) => r.minX)),
  minZ: Math.min(...rs.map((r) => r.minZ)),
  maxX: Math.max(...rs.map((r) => r.maxX)),
  maxZ: Math.max(...rs.map((r) => r.maxZ)),
});
const distToRect = (p: Vec3, r: Rect): number =>
  Math.hypot(Math.max(0, r.minX - p.x, p.x - r.maxX), Math.max(0, r.minZ - p.z, p.z - r.maxZ));
const top = (s: Solid): number => s.center.y + s.size.y / 2;
const midX = (r: Rect): number => (r.minX + r.maxX) / 2;
const midZ = (r: Rect): number => (r.minZ + r.maxZ) / 2;

/**
 * Downtown Rooftops: tall blocks on a 60 m street grid. Each arterial cell keeps its centre lot open as a plaza. Rows
 * of buildings stand along the north and south streets of every other lot, with 2.5–4.5 m roof gaps. On the two
 * street sides facing each plaza the rows form marked rooftop routes: a jump pad in the plaza launches onto the first
 * roof, the route runs across the roof gaps (steps ≤ 1.2 m up or ≤ 7 m down, jump included), zip lines cross the side
 * streets to the next lots' rows, and the last row, facing the next cell's plaza, zips down into it. Lots beside a
 * plaza may instead be wall-run alleys: two building walls back to back across a 4 m alley, with a pad onto one
 * roof, the alley as a roof gap, and a zip down into the plaza. Boost orbs sit along the routes.
 */
export function buildDowntown(ctx: DistrictContext): DistrictOutput {
  const p = downtownParams(ctx);
  const { rng, move } = ctx;
  const { plaza, palettes } = ctx.city;
  const grid = districtGrid(ctx, { pitch: p.pitch, halfWidth: p.streetHalfWidth, edgeMargin: p.edgeMargin });
  const out = emptyOutput(grid.streets);
  const report: DistrictReport = { rooftopGaps: [], alleys: [], padTargets: [], zipLines: [] };
  const name = ctx.district;
  const counters = { b: 0, pad: 0, zip: 0, orb: 0, alley: 0 };
  const scaleMin = p.artScaleMin / p.bakeScale;
  const scaleMax = p.artScaleMax / p.bakeScale;
  const reserve = p.setback + p.rowEndMargin;
  const { radius } = move.capsule;
  const g = move.gravity;
  const maxDrop = p.stepDownMax - move.jump.height;

  // ---- Grid cells and lot kinds -------------------------------------------------------------------------------
  const cx = spanCells(grid.xs);
  const cz = spanCells(grid.zs);
  const lotAt = new Map(grid.lots.map((l) => [`${l.i},${l.j}`, l]));
  const kind = new Map<GridLot, 'open' | 'alley' | 'rows'>();
  const plazaOf = new Map<string, GridLot>(); // per cell "cx,cz"
  const mid = (c: { count: number }): number => Math.floor(c.count / 2);
  for (const lot of grid.lots) {
    const [ci, cj] = [cx[lot.i]!, cz[lot.j]!];
    const isPlaza = ci.local === mid(ci) && cj.local === mid(cj);
    if (isPlaza) plazaOf.set(`${ci.cell},${cj.cell}`, lot);
    kind.set(lot, isPlaza || distToRect(plaza.center, lot.rect) <= plaza.clearRadius ? 'open' : 'rows');
  }

  const allBuildings: Building[] = [];
  const addBuilding = (piece: PieceEntry, scale: number, rotY: RotY, position: Vec3): Building => {
    const prop: Prop = { id: `${name}-b${counters.b++}`, piece: piece.id, position: v2(position), rotY, scale, palette: palettes[Math.floor(rng() * palettes.length)]! };
    const b = shapeAt(piece, prop, p.doorOffset);
    allBuildings.push(b);
    return b;
  };

  // ---- Alley lots: beside a plaza, with room for two walls back to back across the alley -----------------------
  const alleyScale = r2(p.alley.artScale / p.bakeScale);
  /** A wall piece at the alley scale facing `side`, placed at the origin. */
  const alleyPiece = (piece: PieceEntry, side: Side): Building =>
    shapeAt(piece, { id: '', piece: piece.id, position: { x: 0, y: 0, z: 0 }, rotY: FACING[side], scale: alleyScale, palette: null }, 0);
  /**
   * Two walls of flush pieces, each at least alley.minLength long, back to back across an alley through the middle of
   * the lot, centred along x; null when they don't fit. Every building must face its nearest street, so the side
   * streets may come no nearer than the front one (the forecourt between the street and the wall's front).
   */
  const planAlley = (lot: GridLot): AlleyPlan | null => {
    const walls: [PieceEntry[], PieceEntry[]] = [[], []];
    const lengths = [0, 0];
    const depths = [0, 0];
    for (const w of [0, 1] as const) {
      while (lengths[w]! < p.alley.minLength) {
        const piece = ctx.pieces[p.alley.pieces[Math.floor(rng() * p.alley.pieces.length)]!]!;
        const fp = alleyPiece(piece, w === 0 ? 'n' : 's').footprint;
        walls[w].push(piece);
        lengths[w]! += fp.maxX - fp.minX;
        depths[w] = Math.max(depths[w]!, fp.maxZ - fp.minZ);
      }
    }
    const length = Math.max(...lengths);
    const middle = midZ(lot.rect);
    const forecourts = [middle - p.alley.width / 2 - depths[0]! - lot.rect.minZ, lot.rect.maxZ - (middle + p.alley.width / 2 + depths[1]!)];
    const side = (lot.rect.maxX - lot.rect.minX - length) / 2;
    if (Math.min(...forecourts) < p.setback || Math.max(...forecourts) > side) return null;
    return { walls, length };
  };
  const alleyCandidates = grid.lots.filter((lot) => {
    const [ci, cj] = [cx[lot.i]!, cz[lot.j]!];
    return kind.get(lot) === 'rows' && cj.local === mid(cj) && Math.abs(ci.local - mid(ci)) === 1 && lot.streets.n && lot.streets.s;
  });
  const alleyPlans = new Map<GridLot, AlleyPlan>();
  for (const lot of alleyCandidates) {
    if (rng() >= p.alley.chance) continue;
    const plan = planAlley(lot);
    if (plan) alleyPlans.set(lot, plan);
  }
  for (const lot of alleyCandidates) {
    if (alleyPlans.size >= p.alley.min) break;
    if (alleyPlans.has(lot)) continue;
    const plan = planAlley(lot);
    if (plan) alleyPlans.set(lot, plan);
  }
  if (alleyPlans.size < p.alley.min) throw new Error(`district ${name}: only ${alleyPlans.size} lots fit a wall-run alley (need ${p.alley.min})`);
  for (const lot of alleyPlans.keys()) kind.set(lot, 'alley');

  // ---- Rows ---------------------------------------------------------------------------------------------------
  const weighted = Object.entries(p.rowPieces).map(([id, w]) => ({ piece: ctx.pieces[id]!, w }));
  /** Sprint-jump reach past the take-off edge when landing `drop` m lower (holding sprint the whole flight). */
  const reach = (drop: number): number =>
    move.run.sprintSpeed * (Math.sqrt((2 * move.jump.height) / g) + Math.sqrt((2 * (move.jump.height + drop)) / g));

  /**
   * Fills a row along a lot side, in direction `dir`. Route rows chain heights (each roof within stepUpMax up or
   * maxDrop down of the last, a step up only across a gap ≤ roofGapMaxUp, and long enough to land on); `start`
   * bounds the first roof (the zip from the previous row). Other rows skip slots with chance 1 − fillChance.
   */
  function buildRow(lot: GridLot, side: Side, dir: 1 | -1, route: boolean, start?: { top: number; slack: number }): Row {
    const row: Row = { lot, side, dir, buildings: [] };
    const rotY = FACING[side];
    const front = side === 'n' ? lot.rect.minZ + p.setback : lot.rect.maxZ - p.setback;
    const [x0, x1] = [lot.rect.minX + reserve, lot.rect.maxX - reserve];
    let edge = dir > 0 ? x0 : x1; // far roof edge of the last building, or the row start
    let last: Building | null = null;
    for (;;) {
      const gap = last ? p.roofGapMin + rng() * (p.roofGapMax - p.roofGapMin) : 0;
      if (!route && rng() >= p.fillChance) {
        // An empty slot: skip about one building's width
        edge += dir * (gap + 6 + rng() * 6);
        last = null;
        if ((edge - x0) * (x1 - edge) < 0) break;
        continue;
      }
      let lo = 0;
      let hi = Infinity;
      if (route && last) {
        lo = last.roof.top - maxDrop;
        hi = last.roof.top + (gap <= p.roofGapMaxUp ? p.stepUpMax : 0);
      } else if (route && start) {
        lo = start.top - start.slack;
        hi = start.top + start.slack;
      }
      let placed: Building | null = null;
      for (let attempt = 0; attempt < 8 && !placed; attempt++) {
        const cands = weighted.filter(({ piece }) => piece.roofY! * scaleMax >= lo && piece.roofY! * scaleMin <= hi);
        if (cands.length === 0) break;
        let pick = rng() * cands.reduce((s, c) => s + c.w, 0);
        const { piece } = cands.find((c) => (pick -= c.w) < 0) ?? cands[cands.length - 1]!;
        const sLo = Math.max(scaleMin, lo / piece.roofY!);
        const sHi = Math.min(scaleMax, hi / piece.roofY!);
        const scale = r2(sLo + rng() * (sHi - sLo));
        const trial = shapeAt(piece, { id: '', piece: piece.id, position: { x: 0, y: 0, z: 0 }, rotY, scale, palette: null }, 0);
        const roofLen = trial.roof.rect.maxX - trial.roof.rect.minX;
        const t = trial.roof.top;
        if (t < lo - 1e-9 || t > hi + 1e-9 || (route && roofLen < p.minRoofLength)) continue;
        if (route && last && roofLen < reach(Math.max(0, last.roof.top - t)) - gap + p.landingMargin) continue;
        // Along x: the first building's footprint starts at the row start; later ones keep `gap` between roofs
        const near = dir > 0 ? trial.footprint.minX : trial.footprint.maxX;
        const nearRoof = dir > 0 ? trial.roof.rect.minX : trial.roof.rect.maxX;
        const x = last ? edge + dir * gap - nearRoof : edge - near;
        const z = side === 'n' ? front - trial.footprint.minZ : front - trial.footprint.maxZ;
        const fp = { ...trial.footprint, minX: trial.footprint.minX + x, maxX: trial.footprint.maxX + x };
        if (fp.minX < x0 - 1e-6 || fp.maxX > x1 + 1e-6) continue;
        if (distToRect(plaza.center, { ...fp, minZ: trial.footprint.minZ + z, maxZ: trial.footprint.maxZ + z }) <= plaza.clearRadius) continue;
        const b = addBuilding(piece, scale, rotY, { x, y: 0, z });
        // Rounding moved it by up to 5 mm: re-check the route rules on the final roofs
        if (route && last) {
          const realGap = dir > 0 ? b.roof.rect.minX - last.roof.rect.maxX : last.roof.rect.minX - b.roof.rect.maxX;
          const step = b.roof.top - last.roof.top;
          if (realGap < p.roofGapMin || realGap > p.roofGapMax || step > (realGap <= p.roofGapMaxUp ? p.stepUpMax : 0) || -step > maxDrop) {
            allBuildings.pop();
            counters.b--;
            continue;
          }
        }
        placed = b;
      }
      if (!placed) break;
      row.buildings.push(placed);
      last = placed;
      edge = dir > 0 ? placed.roof.rect.maxX : placed.roof.rect.minX;
    }
    return row;
  }

  // Route bands: along each cell row, the south side of the lots north of the plazas runs east (north routes) and
  // the north side of the lots south of them runs west (south routes).
  const routeRows = new Map<string, Row>(); // "i,j,side"
  const zipSlack = (a: Building, nextLot: GridLot, dir: 1 | -1): number => {
    const edgeA = dir > 0 ? a.roof.rect.maxX : a.roof.rect.minX;
    const edgeB = dir > 0 ? nextLot.rect.minX + reserve : nextLot.rect.maxX - reserve;
    return p.zip.maxSlope * (Math.abs(edgeB - edgeA) + 2 * p.zip.endInset) * 0.95;
  };
  const czCells = [...new Set(cz.map((c) => c.cell))];
  const cxCells = [...new Set(cx.map((c) => c.cell))];
  const plazaCols = (cellZ: number): number[] => cxCells.map((c) => plazaOf.get(`${c},${cellZ}`)!.i);
  const bandJ = (cellZ: number, offset: number): number => cz.findIndex((c) => c.cell === cellZ && c.local === mid(c) + offset);
  for (const cellZ of czCells) {
    const cols = plazaCols(cellZ);
    for (const [offset, side, dir] of [[-1, 's', 1], [1, 'n', -1]] as const) {
      const j = bandJ(cellZ, offset);
      if (j < 0) continue;
      const first = dir > 0 ? cols[0]! : cols[cols.length - 1]!;
      const order = grid.lots.filter((l) => l.j === j && (dir > 0 ? l.i >= first : l.i <= first)).sort((a, b) => dir * (a.i - b.i));
      let prev: Row | null = null;
      for (const lot of order) {
        if (kind.get(lot) !== 'rows' || !lot.streets[side]) {
          prev = null;
          continue;
        }
        const lastB = prev && prev.lot.i === lot.i - dir ? prev.buildings[prev.buildings.length - 1] : undefined;
        const row = buildRow(lot, side, dir, true, lastB ? { top: lastB.roof.top, slack: zipSlack(lastB, lot, dir) } : undefined);
        routeRows.set(`${lot.i},${lot.j},${side}`, row);
        prev = row.buildings.length > 0 ? row : null;
      }
    }
  }
  for (const lot of grid.lots) {
    if (kind.get(lot) !== 'rows') continue;
    for (const side of ['n', 's'] as const) {
      if (!lot.streets[side] || routeRows.has(`${lot.i},${lot.j},${side}`)) continue;
      buildRow(lot, side, rng() < 0.5 ? 1 : -1, false);
    }
  }

  // Alley walls: north wall facing north, south wall facing south, their backs on the alley's sides
  const alleyBuildings = new Map<GridLot, [Building[], Building[]]>();
  for (const [lot, plan] of alleyPlans) {
    const walls: [Building[], Building[]] = [[], []];
    for (const w of [0, 1] as const) {
      const side: Side = w === 0 ? 'n' : 's';
      const back = midZ(lot.rect) + (w === 0 ? -1 : 1) * (p.alley.width / 2);
      let x = midX(lot.rect) - plan.length / 2;
      for (const piece of plan.walls[w]) {
        const fp = alleyPiece(piece, side).footprint;
        const z = w === 0 ? back - fp.maxZ : back - fp.minZ;
        walls[w].push(addBuilding(piece, alleyScale, FACING[side], { x: x - fp.minX, y: 0, z }));
        x += fp.maxX - fp.minX;
      }
    }
    alleyBuildings.set(lot, walls);
  }

  // ---- Features -----------------------------------------------------------------------------------------------
  const obstacles: Obstacle[] = allBuildings.flatMap((b) => b.solids.map((s) => ({ rect: solidRect(s), top: top(s) })));
  const roofSlots = new Set<Building>();
  const markedRows = new Set<Row>();
  const rowsWithZipDown = new Set<Row>();

  const addPad = (at: Vec3, onto: Building, label: string): void => {
    const target = v2({ x: midX(onto.roof.rect), y: onto.roof.top, z: midZ(onto.roof.rect) });
    for (const extraInset of [0, 3, 6, 9]) {
      for (const extraApex of [0, 1, 2]) {
        const apex = p.pad.apexAbove + extraApex;
        if (apex > p.stepDownMax) continue;
        const toward = Math.sign(target.z - at.z) || 1;
        const position = v2({ x: at.x, y: at.y, z: at.z - toward * extraInset });
        const launch = padLaunchFor(position, target, apex, g);
        if (!padFlightClear(position, launch, target, g, radius, p.pad.clearance, obstacles)) continue;
        const pad = { id: `${name}-pad-${counters.pad++}`, position, radius: p.pad.radius, launch };
        out.jumpPads.push(pad);
        out.navLinks.push(navLinkFor({ ...pad, target }));
        report.padTargets.push({ pad: pad.id, target, landing: onto.roof.rect });
        roofSlots.add(onto);
        return;
      }
    }
    throw new Error(`district ${name}: no clear pad flight for ${label}`);
  };

  const addZip = (a: Vec3, b: Vec3, label: string): void => {
    const slope = Math.abs(a.y - b.y) / Math.hypot(a.x - b.x, a.z - b.z);
    if (slope > p.zip.maxSlope + 1e-6) throw new Error(`district ${name}: zip ${label} is too steep (${slope.toFixed(2)})`);
    if (!cableClear(a, b, move.zipLine.hangDrop, radius, obstacles)) throw new Error(`district ${name}: zip ${label} is not clear below`);
    const zip = zipBetween(a, b, `${name}-zip-${counters.zip++}`);
    out.zipLines.push(zip);
    out.navLinks.push(navLinkFor(zip));
    report.zipLines.push(zip.id);
  };

  /** The z band two roofs of one row share (route line). */
  const sharedZ = (a: Building, b: Building): number =>
    r2((Math.max(a.roof.rect.minZ, b.roof.rect.minZ) + Math.min(a.roof.rect.maxZ, b.roof.rect.maxZ)) / 2);

  const markRow = (row: Row): void => {
    if (markedRows.has(row)) return;
    markedRows.add(row);
    row.buildings.forEach((b, k) => {
      roofSlots.add(b);
      const next = row.buildings[k + 1];
      if (!next) return;
      const z = sharedZ(b, next);
      const from = v2({ x: row.dir > 0 ? b.roof.rect.maxX : b.roof.rect.minX, y: b.roof.top, z });
      const nearEdge = row.dir > 0 ? next.roof.rect.minX : next.roof.rect.maxX;
      report.rooftopGaps.push({ from, to: v2({ x: nearEdge + row.dir * 2, y: next.roof.top, z }), landing: next.roof.rect });
    });
  };

  /** A zip from a row's roof (near its front) straight across its street into the plaza it faces. */
  const zipDownInto = (from: Building, side: Side, into: GridLot, label: string): void => {
    const toward = side === 'n' ? -1 : 1; // the row's street lies this way in z
    const frontEdge = side === 'n' ? from.roof.rect.minZ : from.roof.rect.maxZ;
    const a = v2({ x: midX(from.roof.rect), y: from.roof.top + p.zip.endHeight, z: frontEdge - toward * p.zip.endInset });
    const plazaNear = toward > 0 ? into.rect.minZ : into.rect.maxZ;
    const run = Math.max(Math.abs(plazaNear - a.z) + p.zip.minInto, from.roof.top / p.zip.maxSlope + 0.05);
    const b = v2({ x: a.x, y: p.zip.endHeight, z: a.z + toward * run });
    if (toward * (b.z - (toward > 0 ? into.rect.maxZ : into.rect.minZ)) > -2) throw new Error(`district ${name}: zip ${label} runs past the plaza`);
    addZip(a, b, label);
  };

  const routeRow = (i: number, j: number, side: Side): Row | undefined => {
    const row = routeRows.get(`${i},${j},${side}`);
    return row && row.buildings.length > 0 ? row : undefined;
  };
  for (const cellZ of czCells) {
    const cols = plazaCols(cellZ);
    for (const [offset, side, dir] of [[-1, 's', 1], [1, 'n', -1]] as const) {
      const j = bandJ(cellZ, offset);
      const plazaJ = bandJ(cellZ, 0);
      if (j < 0) continue;
      cols.forEach((col, k) => {
        const r1 = routeRow(col, j, side);
        if (!r1) return;
        const here = lotAt.get(`${col},${plazaJ}`)!;
        const label = `${side === 's' ? 'north' : 'south'} route from plaza ${col},${plazaJ}`;
        const chain: Row[] = [r1];
        const nextCol = cols[k + dir];
        if (nextCol !== undefined) {
          for (let c = col + dir; ; c += dir) {
            const row = routeRow(c, j, side);
            if (!row) break;
            chain.push(row);
            if (c === nextCol) break;
          }
          if (chain[chain.length - 1]!.lot.i !== nextCol) chain.splice(1);
        }
        // Pad from the plaza onto the first roof
        const first = r1.buildings[0]!;
        const padZ = side === 's' ? here.rect.minZ + p.pad.inset : here.rect.maxZ - p.pad.inset;
        addPad({ x: r2(midX(first.roof.rect)), y: 0, z: padZ }, first, label);
        chain.forEach(markRow);
        // Zips across the side streets between rows
        for (let r = 0; r + 1 < chain.length; r++) {
          const a = chain[r]!.buildings[chain[r]!.buildings.length - 1]!;
          const b = chain[r + 1]!.buildings[0]!;
          const z = sharedZ(a, b);
          const ea = dir > 0 ? a.roof.rect.maxX : a.roof.rect.minX;
          const eb = dir > 0 ? b.roof.rect.minX : b.roof.rect.maxX;
          addZip(
            v2({ x: ea - dir * p.zip.endInset, y: a.roof.top + p.zip.endHeight, z }),
            v2({ x: eb + dir * p.zip.endInset, y: b.roof.top + p.zip.endHeight, z }),
            `${label}, row ${r}`,
          );
        }
        // Down from the last roof into the plaza the last row faces (the next one, or this one for a single row)
        // (A row ending one route and starting the next has one way down.)
        const lastRow = chain[chain.length - 1]!;
        const intoLot = chain.length > 1 ? lotAt.get(`${nextCol},${plazaJ}`)! : here;
        if (!rowsWithZipDown.has(lastRow)) zipDownInto(lastRow.buildings[lastRow.buildings.length - 1]!, side, intoLot, `${label}, down`);
        rowsWithZipDown.add(lastRow);
        // A boost orb on the middle row's longest roof, toward its back: off the route line, for those who go for it
        const midRow = chain[Math.floor(chain.length / 2)]!;
        const longest = midRow.buildings.reduce((x, y) =>
          y.roof.rect.maxX - y.roof.rect.minX > x.roof.rect.maxX - x.roof.rect.minX ? y : x,
        );
        const back = side === 's' ? longest.roof.rect.minZ + p.orbBackInset : longest.roof.rect.maxZ - p.orbBackInset;
        out.boostOrbs.push({
          id: `${name}-orb-${counters.orb++}`,
          position: v2({ x: midX(longest.roof.rect), y: longest.roof.top + p.orbHeight, z: back }),
        });
      });
    }
  }

  // Alley features: pad onto the first north roof, the alley as a roof gap, a zip from the south wall into the plaza
  for (const lot of alleyPlans.keys()) {
    const id = `${name}-alley-${counters.alley++}`;
    const walls = alleyBuildings.get(lot)!;
    const [north, south] = walls;
    const floor: Rect = {
      minX: Math.max(north[0]!.roof.rect.minX, south[0]!.roof.rect.minX),
      maxX: Math.min(north[north.length - 1]!.roof.rect.maxX, south[south.length - 1]!.roof.rect.maxX),
      minZ: Math.max(...north.map((b) => b.roof.rect.maxZ)),
      maxZ: Math.min(...south.map((b) => b.roof.rect.minZ)),
    };
    report.alleys.push({ id, floor, axis: 'x', walls: [north.map((b) => b.roof.solid.id), south.map((b) => b.roof.solid.id)] });
    const n0 = north[0]!;
    addPad({ x: r2(midX(n0.roof.rect)), y: 0, z: r2(lot.rect.minZ + p.pad.inset) }, n0, id);
    const s0 = south.find((b) => b.roof.rect.minX <= midX(n0.roof.rect) && b.roof.rect.maxX >= midX(n0.roof.rect)) ?? south[0]!;
    const gx = r2((Math.max(n0.roof.rect.minX, s0.roof.rect.minX) + Math.min(n0.roof.rect.maxX, s0.roof.rect.maxX)) / 2);
    report.rooftopGaps.push({
      from: v2({ x: gx, y: n0.roof.top, z: n0.roof.rect.maxZ }),
      to: v2({ x: gx, y: s0.roof.top, z: s0.roof.rect.minZ + 2 }),
      landing: s0.roof.rect,
    });
    for (const b of [...north, ...south]) roofSlots.add(b);
    // Down from the south wall's end nearest the plaza, along x into it
    const plazaLot = plazaOf.get(`${cx[lot.i]!.cell},${cz[lot.j]!.cell}`)!;
    const dir = plazaLot.i > lot.i ? 1 : -1;
    const end = dir > 0 ? south[south.length - 1]! : south[0]!;
    const a = v2({
      x: (dir > 0 ? end.roof.rect.maxX : end.roof.rect.minX) - dir * p.zip.endInset,
      y: end.roof.top + p.zip.endHeight,
      z: midZ(end.roof.rect),
    });
    const plazaNear = dir > 0 ? plazaLot.rect.minX : plazaLot.rect.maxX;
    const run = Math.max(Math.abs(plazaNear - a.x) + p.zip.minInto, end.roof.top / p.zip.maxSlope + 0.05);
    addZip(a, v2({ x: a.x + dir * run, y: p.zip.endHeight, z: a.z }), `${id}, down`);
  }

  // ---- Output -------------------------------------------------------------------------------------------------
  const slots: PoiSlot[] = [];
  for (const b of allBuildings) {
    out.props.push(b.prop);
    out.solids.push(...b.solids);
    slots.push({ position: b.door, kind: 'door', elevated: false, district: name, access: 'street' });
    slots.push({
      position: v2({ x: midX(b.roof.rect), y: b.roof.top, z: midZ(b.roof.rect) }),
      kind: 'door',
      elevated: true,
      district: name,
      access: roofSlots.has(b) ? 'route' : 'kit',
    });
  }
  out.poiSlots = slots;
  out.report = report;
  return out;

}

/**
 * A prop's colliders, footprint (its art box ∪ colliders), roof (the top collider) and door slot (`doorOffset` in
 * front of the art box's +z face, turned by rotY).
 */
function shapeAt(piece: PieceEntry, prop: Prop, doorOffset: number): Building {
  const solids = propSolids(prop, piece);
  const quarter = prop.rotY === 90 || prop.rotY === 270;
  const [hx, hz] = quarter ? [(piece.size.z * prop.scale) / 2, (piece.size.x * prop.scale) / 2] : [(piece.size.x * prop.scale) / 2, (piece.size.z * prop.scale) / 2];
  const { x, z } = prop.position;
  const art = { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
  const footprint = union([art, ...solids.map(solidRect)]);
  const roofSolid = solids.reduce((a, b) => (top(b) > top(a) ? b : a));
  const d = doorOffset;
  const doorAt =
    prop.rotY === 0 ? { x, z: art.maxZ + d }
    : prop.rotY === 180 ? { x, z: art.minZ - d }
    : prop.rotY === 90 ? { x: art.maxX + d, z }
    : { x: art.minX - d, z };
  return {
    prop,
    solids,
    footprint,
    roof: { rect: solidRect(roofSolid), top: top(roofSolid), solid: roofSolid },
    door: v2({ x: doorAt.x, y: 0, z: doorAt.z }),
  };
}
