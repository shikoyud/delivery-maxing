import type { CityMap, JumpPad, MovementConfig, NavLink, OrdersConfig, PieceCatalog, Rect, Rng, Solid, SolidKind, Vec3, ZipLine } from '@dm/shared';
import type { PoiKit, PoiSlot } from './district';
import { cableClear, MANTLE_STEP_MIN_RISE, mantleStepRises, mantleSteps, navLinkFor, obstacleOf, padFlightClear, padLaunchFor, zipBetween } from './kits';
import { box, distToRect, flatDistance, grow, overlaps, sq, union, v2 } from './layout';
import { GROUNDS, LEVEL_TOL, STREET, TOUCH, YARD, type Reach, type Space } from './poiSpace';
import type { PoiSource } from './source';

// The POI pass's access kits (mantle steps and drops, pads and zip lines, balconies) and street furniture.

/** What the POI pass needs besides the slots. */
export interface PoiContext {
  /** The city the districts built (no POIs yet): kits and street furniture go on it. */
  city: CityMap;
  pieces: PieceCatalog;
  params: PoiSource;
  rng: Rng;
  move: MovementConfig;
  orders: OrdersConfig;
  /** The sidewalk's top above its street level and its width. */
  streets: { sidewalkTop: number; sidewalkWidth: number };
  /** POIs and kits keep out of this circle around the plaza centre. */
  plaza: { center: Vec3; clearRadius: number };
  /**
   * What the districts' features need clear besides the city's own features (run-up spots, stair ends, landings, rail
   * approaches), and areas kits and furniture keep out of (the skatepark, wall-run alleys).
   */
  keepClear: { points: Vec3[]; segments: [Vec3, Vec3][]; areas: Rect[] };
}

/** Width of a mantle-step crate across the climb (kits.ts mantleSteps), m. */
export const CRATE_WIDTH = 2;
/** A zip line's low end needs this much level, open street around it to dismount on, m (half-side). */
const DISMOUNT = 1.5;
/** A drop's landing lane is this wide either side of its line, m. */
const DROP_HALF_WIDTH = 0.7;

// ---- Faces and ledges -----------------------------------------------------------------------------------------

/** A side of a rect: it faces `out` (an axis unit vector); `at` is its line, `from`…`to` its extent along it. */
interface Face { out: { x: number; z: number }; at: number; from: number; to: number }

function facesOf(r: Rect): Face[] {
  return [
    { out: { x: 0, z: 1 }, at: r.maxZ, from: r.minX, to: r.maxX },
    { out: { x: 0, z: -1 }, at: r.minZ, from: r.minX, to: r.maxX },
    { out: { x: 1, z: 0 }, at: r.maxX, from: r.minZ, to: r.maxZ },
    { out: { x: -1, z: 0 }, at: r.minX, from: r.minZ, to: r.maxZ },
  ];
}

/** The point `along` the face and `out` m out from it (negative: inside). */
const facePoint = (f: Face, along: number, out: number): { x: number; z: number } =>
  f.out.x !== 0 ? { x: f.at + f.out.x * out, z: along } : { x: along, z: f.at + f.out.z * out };

/** The rect from `o0` to `o1` m out from the face, `half` either side of `along`. */
function laneRect(f: Face, along: number, o0: number, o1: number, half: number): Rect {
  const a = facePoint(f, along - half, o0);
  const b = facePoint(f, along + half, o1);
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

/** Spots along a face, middle first, then `step` apart either way, keeping `margin` from its ends. */
function alongs(f: Face, step: number, margin: number): number[] {
  const mid = (f.from + f.to) / 2;
  const out = [mid];
  for (let d = step; mid + d <= f.to - margin + 1e-9; d += step) out.push(mid - d, mid + d);
  return out;
}

/** The yaw that turns +z toward −out (a climber facing the face). */
const yawToFace = (out: { x: number; z: number }): 0 | 90 | 180 | 270 => (out.z < 0 ? 0 : out.z > 0 ? 180 : out.x < 0 ? 90 : 270);

/**
 * A ledge an access kit reaches: its footprint, top and bottom (a balcony slab is thin), and the face spots its crate
 * steps may stand at (`climbs`) and its drop may leave from (`drops`), in order of preference.
 */
interface Ledge { rect: Rect; top: number; bottom: number; climbs: { face: Face; along: number }[]; drops: { face: Face; along: number }[] }

/** What the POI pass adds for one POI. */
export interface Built {
  solids: Solid[];
  jumpPads: JumpPad[];
  zipLines: ZipLine[];
  navLinks: NavLink[];
  kit?: PoiKit;
  /** Spots and lines later kits keep clear of. */
  marks: { x: number; z: number }[];
  lines: [Vec3, Vec3][];
}
export const nothing = (): Built => ({ solids: [], jumpPads: [], zipLines: [], navLinks: [], marks: [], lines: [] });

/** The POI pass while it runs. */
export interface Pass {
  ctx: PoiContext;
  p: PoiSource;
  space: Space;
  reach: Reach;
  maxFall: number;
}

/** Whether `r` keeps out of the plaza's clear circle and the keep-out areas. */
export function allowed(w: Pass, r: Rect): boolean {
  const { center, clearRadius } = w.ctx.plaza;
  return distToRect(center, r) >= clearRadius && !w.ctx.keepClear.areas.some((a) => overlaps(a, r, 0));
}

/** Whether a courier can stand at `p`: on a flat top there, with room for the capsule above. */
export function standing(w: Pass, p: Vec3): boolean {
  const { radius, height } = w.ctx.move.capsule;
  const e = w.space.surface(p.x, p.z, p.y + 0.3);
  return !!e && Math.abs(e.top - p.y) <= 0.05 && w.space.free(sq(p, radius + 0.1), p.y + 0.05, p.y + height);
}

/** The street-level ground just outside a roof: the highest street surface outside its faces' middles, or null. */
function groundAround(w: Pass, r: Rect, below: number): number | null {
  let best: number | null = null;
  for (const f of facesOf(r)) {
    const at = facePoint(f, (f.from + f.to) / 2, 1);
    const e = w.space.surface(at.x, at.z, below);
    if (e && STREET.has(e.solid.kind)) best = Math.max(best ?? -Infinity, e.top);
  }
  return best;
}

// ---- Mantle kits (ledges up to 7 m) ---------------------------------------------------------------------------

/**
 * The rise of crate steps up `climb` whose every rise lies in the R17 window, the last one seen by the mantle's wall
 * probe on a ledge face `face` m tall: kits.stepRise, or mantle.maxHeight (fewer steps) when that one fails; or null.
 */
function stepRiseFor(w: Pass, climb: number, face: number): number | null {
  const max = w.ctx.move.mantle.maxHeight;
  for (const rise of [w.p.kits.stepRise, max]) {
    const rises = mantleStepRises(climb, rise);
    const inWindow = rises.every((r) => r >= MANTLE_STEP_MIN_RISE - 1e-6 && r <= max + 1e-6);
    if (inWindow && rises[rises.length - 1]! - MANTLE_STEP_MIN_RISE < face - 0.05) return rise;
  }
  return null;
}

/**
 * A drop link off a ledge: from 0.5 m inside one of its drop spots straight out to a street-level landing `standOff`
 * out, at most a Fragile-safe fall below, the lane a courier walking off at run speed lands in level and open. Avoids
 * `avoid` (the kit's crates). Null when no spot has one.
 */
function dropFor(w: Pass, ledge: Ledge, avoid: Rect): { from: Vec3; to: Vec3 } | null {
  const { move } = w.ctx;
  for (const { face, along } of ledge.drops) {
    const at = facePoint(face, along, w.p.kits.standOff);
    const g = w.space.surface(at.x, at.z, ledge.top - w.p.elevatedMin);
    if (!g || !STREET.has(g.solid.kind)) continue;
    const fall = ledge.top - g.top;
    if (fall > w.maxFall) continue;
    const run = move.run.runSpeed * Math.sqrt((2 * fall) / move.gravity) + w.p.kits.dropMargin;
    const lane = laneRect(face, along, 0, run, DROP_HALF_WIDTH);
    // The lane (holding the landing) keeps clear of movement features like every other kit part
    if (overlaps(lane, avoid, 0) || !allowed(w, lane) || !w.space.clear(lane, w.p.featureClearance)) continue;
    // A curb at most under the lane, and nothing in the way down to it
    if (!w.space.levelIn(lane, g.top - 0.05, g.top + 0.2, STREET)) continue;
    if (!w.space.free(lane, g.top + 0.25, ledge.top + move.capsule.height)) continue;
    return { from: v2({ ...facePoint(face, along, -0.5), y: ledge.top }), to: v2({ ...at, y: g.top }) };
  }
  return null;
}

/**
 * Mantle steps up to a ledge (≤ 7 m above the ground at its foot) and a drop link down: crates against the first climb
 * spot whose ground is level yard ground (no road or sidewalk) with room for the crates and the run-up behind them
 * (clear of everything and of marked features), with a drop spot. Null when no spot works.
 */
export function mantleKit(w: Pass, ledge: Ledge, id: string): Built | null {
  const { move } = w.ctx;
  const k = w.p.kits;
  for (const { face, along } of ledge.climbs) {
    const foot = facePoint(face, along, 0);
    const first = facePoint(face, along, 0.75);
    const g = w.space.surface(first.x, first.z, ledge.top - w.p.elevatedMin);
    if (!g || !YARD.has(g.solid.kind)) continue;
    const level = g.top;
    const climb = ledge.top - level;
    if (climb < w.p.elevatedMin - 1e-9 || climb > w.maxFall) continue;
    const rise = stepRiseFor(w, climb, ledge.top - Math.max(level, ledge.bottom));
    if (rise === null) continue;
    const steps = mantleSteps({ x: foot.x, y: level, z: foot.z }, { x: foot.x, y: ledge.top, z: foot.z }, yawToFace(face.out), rise, `${id}-step`);
    if (steps.length === 0) continue;
    // How far the crates reach out from the face
    const reach = Math.max(...steps.map((s) => {
      const r = obstacleOf(s).rect;
      return face.out.x > 0 ? r.maxX - face.at : face.out.x < 0 ? face.at - r.minX : face.out.z > 0 ? r.maxZ - face.at : face.at - r.minZ;
    }));
    const area = laneRect(face, along, 0, reach + k.runUp, CRATE_WIDTH / 2);
    if (!allowed(w, area) || !w.space.clear(area, w.p.featureClearance)) continue;
    if (!w.space.levelIn(area, level - LEVEL_TOL, level + LEVEL_TOL, YARD)) continue;
    if (!w.space.free(area, level + 0.05, ledge.top + move.capsule.height)) continue;
    const drop = dropFor(w, ledge, area);
    if (!drop) continue;
    const approach = v2({ ...facePoint(face, along, reach + k.standOff), y: level });
    const climbLink = navLinkFor({ kind: 'mantle', id: `${id}-climb`, from: approach, to: v2({ ...facePoint(face, along, -1), y: ledge.top }) });
    const dropLink = navLinkFor({ kind: 'drop', id: `${id}-drop`, ...drop });
    return {
      ...nothing(),
      solids: steps,
      navLinks: [climbLink, dropLink],
      kit: {
        poi: id, kind: 'mantle', ledge: ledge.rect, top: ledge.top, steps: steps.map((s) => s.id), approach,
        facing: { x: -face.out.x + 0, z: -face.out.z + 0 }, climb: climbLink.id, drop: dropLink.id,
      },
      marks: [approach, facePoint(face, along, reach + k.runUp), drop.to],
      lines: [],
    };
  }
  return null;
}

// ---- Pad and zip kits (roofs over 7 m) ------------------------------------------------------------------------

/**
 * A pad on level street ground `kits.pad.distances` m out from the middle of a roof face, launching onto `target` (the
 * POI) with a clear flight. Null when no spot works.
 */
function padFor(w: Pass, ledge: Ledge, target: Vec3, id: string): JumpPad | null {
  const { move } = w.ctx;
  const pd = w.p.kits.pad;
  for (const face of facesOf(ledge.rect)) {
    for (const d of pd.distances) {
      const c = facePoint(face, (face.from + face.to) / 2, d);
      const g = w.space.surface(c.x, c.z, ledge.top - w.p.elevatedMin);
      if (!g || !STREET.has(g.solid.kind)) continue;
      const area = sq(c, pd.radius + 0.3);
      if (!allowed(w, area) || !w.space.clear(area, w.p.featureClearance)) continue;
      if (!w.space.levelIn(area, g.top - LEVEL_TOL, g.top + LEVEL_TOL, STREET)) continue;
      if (!w.space.free(area, g.top + 0.05, g.top + move.capsule.height + 1)) continue;
      const position = v2({ ...c, y: g.top });
      const launch = padLaunchFor(position, target, pd.apexAbove, move.gravity);
      const span = union([sq(position, 0), sq(target, 0)]);
      const obstacles = w.space.obstacles(span, 2, g.top + 0.5);
      if (!padFlightClear(position, launch, target, move.gravity, move.capsule.radius, pd.clearance, obstacles)) continue;
      return { id: `${id}-pad`, position, radius: pd.radius, launch };
    }
  }
  return null;
}

/** How far a ray from `c` (inside `r`) along the unit `u` runs before leaving `r`. */
function exitDistance(c: { x: number; z: number }, u: { x: number; z: number }, r: Rect): number {
  const tx = u.x > 1e-9 ? (r.maxX - c.x) / u.x : u.x < -1e-9 ? (r.minX - c.x) / u.x : Infinity;
  const tz = u.z > 1e-9 ? (r.maxZ - c.z) / u.z : u.z < -1e-9 ? (r.minZ - c.z) / u.z : Infinity;
  return Math.min(tx, tz);
}

/**
 * A zip line down from the roof to street level: from `endInset` inside the roof edge toward its low end, which is the
 * first candidate (`directions` ways round, `runSteps` runs `runStep` apart from the shortest the slope allows) on
 * level, open street, clear of marked features and of the pad, with the cable clear below by the hang drop.
 */
function zipFor(w: Pass, ledge: Ledge, target: Vec3, pad: JumpPad, id: string): ZipLine | null {
  const { move } = w.ctx;
  const z = w.p.kits.zip;
  for (let k = 0; k < z.directions; k++) {
    const angle = (2 * Math.PI * k) / z.directions;
    const u = { x: Math.cos(angle), z: Math.sin(angle) };
    const exit = exitDistance(target, u, ledge.rect);
    if (exit <= z.endInset) continue;
    const a = v2({ x: target.x + u.x * (exit - z.endInset), y: ledge.top + z.endHeight, z: target.z + u.z * (exit - z.endInset) });
    const shortest = exit + (ledge.top - pad.position.y) / z.maxSlope;
    for (let j = 0; j < z.runSteps; j++) {
      const r = shortest + j * z.runStep;
      const c = { x: target.x + u.x * r, z: target.z + u.z * r };
      const g = w.space.surface(c.x, c.z, ledge.top - w.p.elevatedMin);
      if (!g || !STREET.has(g.solid.kind)) continue;
      const b = v2({ ...c, y: g.top + z.endHeight });
      if ((a.y - b.y) / flatDistance(a, b) > z.maxSlope + 1e-9) continue;
      const area = sq(b, DISMOUNT);
      if (!allowed(w, area) || !w.space.clear(area, w.p.featureClearance)) continue;
      if (flatDistance(b, pad.position) < w.p.featureClearance + pad.radius + DISMOUNT) continue;
      // One level all round: a standing capsule beside a curb does not fit, and the rider would let go in the air
      if (!w.space.levelIn(area, g.top - LEVEL_TOL, g.top + LEVEL_TOL, STREET)) continue;
      if (!w.space.free(area, g.top + 0.2, b.y + 0.5)) continue;
      const span = union([sq(a, 0), sq(b, 0)]);
      if (!cableClear(a, b, move.zipLine.hangDrop, move.capsule.radius, w.space.obstacles(span, 1))) continue;
      return zipBetween(a, b, `${id}-zip`);
    }
  }
  return null;
}

/** A pad up onto a roof over 7 m (landing on the POI) and a zip line down from it to street level. */
export function padZipKit(w: Pass, ledge: Ledge, poi: Vec3, id: string): Built | null {
  const pad = padFor(w, ledge, poi, id);
  if (!pad) return null;
  const zip = zipFor(w, ledge, poi, pad, id);
  if (!zip) return null;
  return {
    ...nothing(),
    jumpPads: [pad],
    zipLines: [zip],
    navLinks: [navLinkFor({ ...pad, target: poi }), navLinkFor(zip)],
    kit: { poi: id, kind: 'pad-zip', ledge: ledge.rect, top: ledge.top, pad: pad.id, target: poi, zip: zip.id },
    marks: [pad.position, zip.b],
    lines: [[pad.position, poi], [zip.a, zip.b]],
  };
}

/**
 * The roof under an elevated kit slot as a ledge, and the kit it needs: mantle steps when it is at most 7 m above the
 * ground beside it, else a pad and a zip line. Null when the slot is not on a roof elevated above street-level ground.
 */
export function roofLedge(w: Pass, slot: PoiSlot): { ledge: Ledge; kit: 'mantle' | 'padZip' } | null {
  const p = slot.position;
  const roof = w.space.surface(p.x, p.z, p.y);
  if (!roof || GROUNDS.has(roof.solid.kind) || Math.abs(roof.top - p.y) > 0.01) return null;
  const level = groundAround(w, roof.rect, roof.top - w.p.elevatedMin);
  if (level === null || roof.top - level < w.p.elevatedMin) return null;
  const spots = facesOf(roof.rect).flatMap((face) => alongs(face, w.p.kits.alongStep, CRATE_WIDTH / 2).map((along) => ({ face, along })));
  const ledge: Ledge = { rect: roof.rect, top: roof.top, bottom: roof.bottom, climbs: spots, drops: spots };
  return { ledge, kit: roof.top - level <= w.maxFall ? 'mantle' : 'padZip' };
}

// ---- Balconies ------------------------------------------------------------------------------------------------

/** A balcony as planned: its slab on a facade facing `out`, its top a floor up. */
export interface BalconyPlan { rect: Rect; top: number; bottom: number; out: { x: number; z: number } }

/**
 * A balcony ledge on the facade of `bodies` facing `out`: the slab balcony.depth out from the face, centred along it,
 * its top `floor`. Null when the facade is narrower than the balcony.
 */
export function balconyOn(bodies: Rect[], out: { x: number; z: number }, floor: number, w: Pass): BalconyPlan | null {
  const b = w.p.balcony;
  const alongX = out.x === 0;
  const face = (r: Rect): number => (out.x > 0 ? r.maxX : out.x < 0 ? r.minX : out.z > 0 ? r.maxZ : r.minZ);
  const sign = out.x + out.z;
  const at = sign > 0 ? Math.max(...bodies.map(face)) : Math.min(...bodies.map(face));
  const flush = bodies.filter((r) => Math.abs(face(r) - at) <= TOUCH);
  const lo = Math.min(...flush.map((r) => (alongX ? r.minX : r.minZ)));
  const hi = Math.max(...flush.map((r) => (alongX ? r.maxX : r.maxZ)));
  if (hi - lo < b.width) return null;
  const mid = (lo + hi) / 2;
  const [o0, o1] = sign > 0 ? [at, at + b.depth] : [at - b.depth, at];
  const rect = alongX
    ? { minX: mid - b.width / 2, maxX: mid + b.width / 2, minZ: o0, maxZ: o1 }
    : { minX: o0, maxX: o1, minZ: mid - b.width / 2, maxZ: mid + b.width / 2 };
  return { rect: v2Rect(rect), top: floor, bottom: floor - b.thickness, out };
}

const v2Rect = (r: Rect): Rect => {
  const a = v2({ x: r.minX, y: 0, z: r.minZ });
  const b = v2({ x: r.maxX, y: 0, z: r.maxZ });
  return { minX: a.x, minZ: a.z, maxX: b.x, maxZ: b.z };
};

/**
 * A balcony and its kit: the slab (with room above it), crate steps up one of its sides (against the facade) or its
 * front, and a drop off its front or a side.
 */
export function balconyKit(w: Pass, plan: BalconyPlan, id: string): Built | null {
  const { move } = w.ctx;
  const { rect, top, bottom, out } = plan;
  if (!allowed(w, rect) || !w.space.free(rect, bottom, top + move.capsule.height + 0.1)) return null;
  const faces = facesOf(rect);
  const front = faces.find((f) => f.out.x === out.x && f.out.z === out.z)!;
  const sides = faces.filter((f) => f.out.x !== 0 ? out.x === 0 : out.z === 0);
  // Along a side face the crates stand against the facade (from it out to CRATE_WIDTH), the climber 1 m off it
  const back = out.x !== 0 ? (out.x > 0 ? rect.minX : rect.maxX) : out.z > 0 ? rect.minZ : rect.maxZ;
  const sideAlong = back + (out.x + out.z) * (CRATE_WIDTH / 2);
  const mid = (front.from + front.to) / 2;
  const ledge: Ledge = {
    rect, top, bottom,
    climbs: [...sides.map((face) => ({ face, along: sideAlong })), { face: front, along: mid }],
    drops: [{ face: front, along: mid }, ...sides.map((face) => ({ face, along: sideAlong }))],
  };
  const kit = mantleKit(w, ledge, id);
  if (!kit) return null;
  return { ...kit, solids: [box(`${id}-balcony`, 'prop', rect, bottom, top), ...kit.solids] };
}

/** Outward facade directions of a building turned `rotY`: its front (+z turned), back, then its sides. */
export function facadeDirs(rotY: number): { x: number; z: number }[] {
  const front = { 0: { x: 0, z: 1 }, 90: { x: 1, z: 0 }, 180: { x: 0, z: -1 }, 270: { x: -1, z: 0 } }[rotY as 0 | 90 | 180 | 270];
  return [front, { x: -front.x + 0, z: -front.z + 0 }, { x: front.z, z: front.x }, { x: -front.z + 0, z: -front.x + 0 }];
}

/**
 * A piece of street furniture: a box over `rect` from `level` up `height`, on level `kinds` ground, clear around and
 * above, away from marked features, the POI at `poi` standing free.
 */
export function furniture(w: Pass, id: string, rect: Rect, poi: Vec3, level: number, height: number, kinds: ReadonlySet<SolidKind>): Built | null {
  const around = grow(rect, 0.3);
  if (!allowed(w, around) || !w.space.clear(around, w.p.featureClearance)) return null;
  if (!w.space.levelIn(rect, level - LEVEL_TOL, level + LEVEL_TOL, kinds)) return null;
  if (!w.space.free(around, level + 0.05, level + w.ctx.move.capsule.height + 0.5) || !standing(w, poi)) return null;
  return { ...nothing(), solids: [box(id, 'prop', rect, level, level + height)] };
}

