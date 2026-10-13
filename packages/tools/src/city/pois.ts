import {
  bandFor,
  type Band,
  type CityMap,
  type District,
  type JumpPad,
  type MovementConfig,
  type NavLink,
  type OrdersConfig,
  type PieceCatalog,
  type Poi,
  type PoiKind,
  type Rect,
  type Rng,
  type Solid,
  type SolidKind,
  type Vec3,
  type ZipLine,
} from '@dm/shared';
import { namedChecks, type DistrictOutput, type PoiKit, type PoiSlot } from './district';
import {
  cableClear,
  GridIndex,
  MANTLE_STEP_MIN_RISE,
  mantleStepRises,
  mantleSteps,
  navLinkFor,
  obstacleOf,
  padFlightClear,
  padLaunchFor,
  zipBetween,
  type Obstacle,
} from './kits';
import { box, distToRect, union, v2 } from './layout';
import type { PoiSource } from './source';

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

/** Solid kinds a courier stands on at street level: crates, pads, zip ends and drop landings stand on these. */
const STREET: ReadonlySet<SolidKind> = new Set<SolidKind>(['ground', 'road', 'sidewalk']);
/** Open ground off the streets (yards, lots): kit crates and stalls stand only on this, never on a road or sidewalk. */
const YARD: ReadonlySet<SolidKind> = new Set<SolidKind>(['ground']);
/** A mailbox stands on the sidewalk. */
const SIDEWALK: ReadonlySet<SolidKind> = new Set<SolidKind>(['sidewalk']);
/** Solid kinds that are street-level surfaces for navigation (everything else is elevated). */
const GROUNDS: ReadonlySet<SolidKind> = new Set<SolidKind>(['ground', 'road', 'sidewalk', 'hub', 'stairs', 'ramp', 'chute', 'cliff']);
/** Boxes closer than this (city.json rounds to 0.01 m, half-sizes to 0.005) touch rather than overlap, m. */
const TOUCH = 0.02;
/** A surface counts as level when within this of the level asked for, m. */
const LEVEL_TOL = 0.02;
/** Width of a mantle-step crate across the climb (kits.ts mantleSteps), m. */
const CRATE_WIDTH = 2;
/** A zip line's low end needs this much level, open street around it to dismount on, m (half-side). */
const DISMOUNT = 1.5;
/** A drop's landing lane is this wide either side of its line, m. */
const DROP_HALF_WIDTH = 0.7;
/** Feature lines are marked at points this far apart, m. */
const MARK_STEP = 1;
/** The order of the band checks. */
const BANDS: readonly Band[] = ['short', 'medium', 'long'];
const KINDS: readonly PoiKind[] = ['door', 'mailbox', 'counter', 'balcony'];

const sq = (c: { x: number; z: number }, h: number): Rect => ({ minX: c.x - h, maxX: c.x + h, minZ: c.z - h, maxZ: c.z + h });
const grow = (r: Rect, d: number): Rect => ({ minX: r.minX - d, maxX: r.maxX + d, minZ: r.minZ - d, maxZ: r.maxZ + d });
const overlaps = (a: Rect, b: Rect, slack = TOUCH): boolean =>
  a.minX < b.maxX - slack && a.maxX > b.minX + slack && a.minZ < b.maxZ - slack && a.maxZ > b.minZ + slack;
const contains = (r: Rect, x: number, z: number): boolean => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const flat = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);
const isTilted = (s: Solid): boolean => !!s.rotationDeg && (s.rotationDeg.x !== 0 || s.rotationDeg.y !== 0 || s.rotationDeg.z !== 0);

// ---- Params ---------------------------------------------------------------------------------------------------

function poiParams(p: PoiSource, ctx: PoiContext): PoiSource {
  const { fail, obj, nums, positive } = namedChecks('city source: pois');
  const { move } = ctx;
  const maxFall = ctx.orders.fragile.maxFallMeters;
  const raw = p as unknown as Record<string, unknown>;
  positive(raw, ['total', 'minSpacing', 'perBandMin', 'bandEstimateFactor', 'elevatedMin', 'featureClearance'], '');
  nums(raw, ['elevatedTarget'], '');
  positive(obj(p.pickWeights, 'pickWeights'), ['street', 'route', 'mantle', 'padZip'], 'pickWeights.');
  if (p.elevatedTarget > 1) fail('elevatedTarget must be at most 1');
  const per = obj(p.perDistrict, 'perDistrict');
  for (const [d, n] of Object.entries(per)) {
    if (!ctx.city.districts.some((x) => x.district === d)) fail(`perDistrict.${d} names no district of the city`);
    if (!Number.isInteger(n) || (n as number) < 0) fail(`perDistrict.${d} must be a whole number`);
  }
  if (Object.values(per).reduce((s: number, n) => s + (n as number), 0) !== p.total) fail('perDistrict must add up to total');
  for (const [k, n] of Object.entries(obj(p.kindMin, 'kindMin'))) {
    if (!KINDS.includes(k as PoiKind)) fail(`kindMin.${k} is not a POI kind`);
    if (!Number.isInteger(n) || (n as number) < 0) fail(`kindMin.${k} must be a whole number`);
  }
  const kits = obj(p.kits, 'kits');
  positive(kits, ['stepRise', 'runUp', 'alongStep', 'standOff'], 'kits.');
  nums(kits, ['dropMargin'], 'kits.');
  const pad = obj(kits.pad, 'kits.pad');
  positive(pad, ['radius'], 'kits.pad.');
  nums(pad, ['apexAbove', 'clearance'], 'kits.pad.');
  if (!Array.isArray(pad.distances) || pad.distances.length === 0 || !pad.distances.every((d) => typeof d === 'number' && d > 0)) {
    fail('kits.pad.distances must list positive numbers');
  }
  const zip = obj(kits.zip, 'kits.zip');
  positive(zip, ['endHeight', 'maxSlope', 'directions', 'runStep', 'runSteps'], 'kits.zip.');
  nums(zip, ['endInset'], 'kits.zip.');
  positive(obj(p.balcony, 'balcony'), ['width', 'depth', 'thickness', 'floorHeight', 'headroom'], 'balcony.');
  const furniture = obj(p.furniture, 'furniture');
  positive(furniture, ['step', 'endClearance'], 'furniture.');
  const mailbox = obj(furniture.mailbox, 'furniture.mailbox');
  positive(mailbox, ['width', 'depth', 'height'], 'furniture.mailbox.');
  nums(mailbox, ['inset'], 'furniture.mailbox.');
  const stall = obj(furniture.stall, 'furniture.stall');
  positive(stall, ['width', 'depth', 'height'], 'furniture.stall.');
  nums(stall, ['gap'], 'furniture.stall.');

  const k = p.kits;
  // Ruling R17: a kit step rises at least the mantle's wall-probe height and at most mantle.maxHeight
  if (k.stepRise < MANTLE_STEP_MIN_RISE || k.stepRise > move.mantle.maxHeight) {
    fail(`kits.stepRise must be within [${MANTLE_STEP_MIN_RISE}, mantle.maxHeight ${move.mantle.maxHeight}] (R17)`);
  }
  if (k.runUp < k.standOff + move.capsule.radius) fail('kits.runUp must hold the climb start (standOff) and the courier');
  if (k.pad.apexAbove > maxFall) fail('kits.pad.apexAbove must keep the fall onto the roof Fragile-safe');
  for (const key of ['directions', 'runSteps'] as const) if (!Number.isInteger(k.zip[key])) fail(`kits.zip.${key} must be a whole number`);
  if (k.zip.endHeight < move.zipLine.hangDrop) fail('kits.zip.endHeight must leave the hang drop under the cable');
  const b = p.balcony;
  if (b.floorHeight < p.elevatedMin || b.floorHeight > maxFall) fail('balcony.floorHeight must be elevated and within a Fragile-safe drop');
  // A courier mantling off side crate steps (CRATE_WIDTH wide against the facade) lands within the slab's depth
  if (b.depth < CRATE_WIDTH / 2 + move.capsule.radius + 0.1 || b.width < CRATE_WIDTH) fail('a balcony must hold a courier off its crate steps');
  const sw = ctx.streets.sidewalkWidth;
  if (p.furniture.mailbox.inset + p.furniture.mailbox.depth > sw / 2 - move.capsule.radius) fail('a mailbox must leave the sidewalk centre free');
  return p;
}

// ---- Space: what stands where ---------------------------------------------------------------------------------

/** A solid as the POI pass sees it: its footprint and vertical extent (of its turned box). */
interface Entry { rect: Rect; top: number; bottom: number; solid: Solid; tilted: boolean }

/** The city's solids and the spots its movement features need clear, for site searches. */
class Space {
  private readonly solids: GridIndex<Entry>;
  private readonly marks: GridIndex<{ rect: Rect }>;

  constructor(cell: number) {
    this.solids = new GridIndex<Entry>(cell);
    this.marks = new GridIndex<{ rect: Rect }>(cell);
  }

  addSolid(s: Solid): void {
    const o = obstacleOf(s);
    this.solids.add({ rect: o.rect, top: o.top, bottom: 2 * s.center.y - o.top, solid: s, tilted: isTilted(s) });
  }

  /** Marks a spot movement features need clear. */
  mark(p: { x: number; z: number }): void {
    this.marks.add({ rect: { minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z } });
  }

  /** Marks a line (its horizontal trace) every MARK_STEP. */
  markLine(a: Vec3, b: Vec3): void {
    const n = Math.max(1, Math.ceil(flat(a, b) / MARK_STEP));
    for (let k = 0; k <= n; k++) this.mark({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }

  /**
   * What a body dropped at (x, z) from height y stands on: the highest flat top there at most y (+ slack). Null when
   * nothing is there, when y is inside a solid, or when a tilted solid (a ramp, a chute, a roof slope) is in the way.
   */
  surface(x: number, z: number, y: number): Entry | null {
    let best: Entry | null = null;
    for (const e of this.solids.near({ minX: x, maxX: x, minZ: z, maxZ: z }, 0)) {
      if (!contains(e.rect, x, z) || e.bottom > y + 0.05) continue;
      if (e.tilted || e.top > y + 0.05) return null;
      if (!best || e.top > best.top) best = e;
    }
    return best;
  }

  /** Whether no solid's box overlaps `r` between heights y0 and y1 (touching boxes do not count). */
  free(r: Rect, y0: number, y1: number): boolean {
    return !this.solids.near(r, 0).some((e) => overlaps(e.rect, r) && e.bottom < y1 - 1e-6 && e.top > y0 + 1e-6);
  }

  /** Whether everywhere over `r` (sampled every 0.5 m) the surface is of `kinds`, its top within [lo, hi]. */
  levelIn(r: Rect, lo: number, hi: number, kinds: ReadonlySet<SolidKind>): boolean {
    const nx = Math.max(1, Math.ceil((r.maxX - r.minX) / 0.5));
    const nz = Math.max(1, Math.ceil((r.maxZ - r.minZ) / 0.5));
    const inset = 0.01;
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const x = r.minX + inset + ((r.maxX - r.minX - 2 * inset) * i) / nx;
        const z = r.minZ + inset + ((r.maxZ - r.minZ - 2 * inset) * j) / nz;
        const e = this.surface(x, z, hi + 0.3);
        if (!e || !kinds.has(e.solid.kind) || e.top < lo - 1e-6 || e.top > hi + 1e-6) return false;
      }
    }
    return true;
  }

  /** Whether no marked spot lies within `pad` of `r`. */
  clear(r: Rect, pad: number): boolean {
    return !this.marks.near(r, pad).some((m) => distToRect({ x: m.rect.minX, z: m.rect.minZ }, r) < pad);
  }

  /** The obstacles near `r` (for cable and pad-flight clearance), leaving out street surfaces no higher than `under`. */
  obstacles(r: Rect, pad: number, under = -Infinity): Obstacle[] {
    return this.solids
      .near(r, pad)
      .filter((e) => !(STREET.has(e.solid.kind) && e.top <= under))
      .map((e) => ({ rect: e.rect, top: e.top }));
  }

  /** The non-street solids of the same top touching `e` (one walkable surface across them). */
  touching(e: Entry): Entry[] {
    return this.solids
      .near(e.rect, TOUCH)
      .filter((o) => o !== e && !o.tilted && !GROUNDS.has(o.solid.kind) && Math.abs(o.top - e.top) <= 0.05 && overlaps(o.rect, grow(e.rect, TOUCH), 0));
  }
}

// ---- Reach: which elevated surfaces the navigation links join to the street -----------------------------------

/**
 * The surfaces the navigation links join: the street level is one node, every elevated surface (touching solids of one
 * top) another. A POI on an elevated surface is reachable when links lead there from the street and back.
 */
class Reach {
  private readonly ids = new Map<Entry, string>();
  private readonly up = new Set<string>(['ground']);
  private readonly down = new Set<string>(['ground']);

  constructor(private readonly space: Space, links: readonly NavLink[]) {
    const fwd = new Map<string, string[]>();
    const back = new Map<string, string[]>();
    const add = (m: Map<string, string[]>, a: string, b: string): void => {
      const l = m.get(a);
      if (l) l.push(b);
      else m.set(a, [b]);
    };
    for (const l of links) {
      const a = this.key(l.from);
      const b = this.key(l.to);
      if (a === null || b === null) continue;
      add(fwd, a, b);
      add(back, b, a);
      if (l.bidirectional) {
        add(fwd, b, a);
        add(back, a, b);
      }
    }
    for (const [graph, seen] of [[fwd, this.up], [back, this.down]] as const) {
      const queue = ['ground'];
      while (queue.length > 0) {
        for (const n of graph.get(queue.shift()!) ?? []) {
          if (seen.has(n)) continue;
          seen.add(n);
          queue.push(n);
        }
      }
    }
  }

  /** Whether links lead from the street to the surface at `p` and back (always true on the street). */
  both(p: Vec3): boolean {
    const k = this.key(p);
    return k !== null && this.up.has(k) && this.down.has(k);
  }

  private key(p: Vec3): string | null {
    const e = this.space.surface(p.x, p.z, p.y);
    if (!e) return null;
    if (GROUNDS.has(e.solid.kind)) return 'ground';
    const known = this.ids.get(e);
    if (known) return known;
    // Flood the touching solids of the same top: one surface, named after its first solid
    const id = e.solid.id;
    const queue = [e];
    this.ids.set(e, id);
    while (queue.length > 0) {
      for (const o of this.space.touching(queue.shift()!)) {
        if (this.ids.has(o)) continue;
        this.ids.set(o, id);
        queue.push(o);
      }
    }
    return id;
  }
}

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
interface Built {
  solids: Solid[];
  jumpPads: JumpPad[];
  zipLines: ZipLine[];
  navLinks: NavLink[];
  kit?: PoiKit;
  /** Spots and lines later kits keep clear of. */
  marks: { x: number; z: number }[];
  lines: [Vec3, Vec3][];
}
const nothing = (): Built => ({ solids: [], jumpPads: [], zipLines: [], navLinks: [], marks: [], lines: [] });

/** The POI pass while it runs. */
interface Pass {
  ctx: PoiContext;
  p: PoiSource;
  space: Space;
  reach: Reach;
  maxFall: number;
}

/** Whether `r` keeps out of the plaza's clear circle and the keep-out areas. */
function allowed(w: Pass, r: Rect): boolean {
  const { center, clearRadius } = w.ctx.plaza;
  return distToRect(center, r) >= clearRadius && !w.ctx.keepClear.areas.some((a) => overlaps(a, r, 0));
}

/** Whether a courier can stand at `p`: on a flat top there, with room for the capsule above. */
function standing(w: Pass, p: Vec3): boolean {
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
    if (overlaps(lane, avoid, 0) || !allowed(w, lane)) continue;
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
function mantleKit(w: Pass, ledge: Ledge, id: string): Built | null {
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
      if ((a.y - b.y) / flat(a, b) > z.maxSlope + 1e-9) continue;
      const area = sq(b, DISMOUNT);
      if (!allowed(w, area) || !w.space.clear(area, w.p.featureClearance)) continue;
      if (flat(b, pad.position) < w.p.featureClearance + pad.radius + DISMOUNT) continue;
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
function padZipKit(w: Pass, ledge: Ledge, poi: Vec3, id: string): Built | null {
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
function roofLedge(w: Pass, slot: PoiSlot): { ledge: Ledge; kit: 'mantle' | 'padZip' } | null {
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
interface BalconyPlan { rect: Rect; top: number; bottom: number; out: { x: number; z: number } }

/**
 * A balcony ledge on the facade of `bodies` facing `out`: the slab balcony.depth out from the face, centred along it,
 * its top `floor`. Null when the facade is narrower than the balcony.
 */
function balconyOn(bodies: Rect[], out: { x: number; z: number }, floor: number, w: Pass): BalconyPlan | null {
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
function balconyKit(w: Pass, plan: BalconyPlan, id: string): Built | null {
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
function facadeDirs(rotY: number): { x: number; z: number }[] {
  const front = { 0: { x: 0, z: 1 }, 90: { x: 1, z: 0 }, 180: { x: 0, z: -1 }, 270: { x: -1, z: 0 } }[rotY as 0 | 90 | 180 | 270];
  return [front, { x: -front.x + 0, z: -front.z + 0 }, { x: front.z, z: front.x }, { x: -front.z + 0, z: -front.x + 0 }];
}

// ---- Candidates -----------------------------------------------------------------------------------------------

/** What a candidate costs to build: nothing (street, route), crate steps (mantle) or a pad and a zip line (padZip). */
type Cost = keyof PoiSource['pickWeights'];

/** A POI candidate: its slot, estimated band, cost, and how to build what it needs (null when it cannot be built). */
interface Candidate { slot: PoiSlot; band: Band; cost: Cost; build: (id: string) => Built | null }

function candidate(w: Pass, slot: PoiSlot, cost: Cost, build: (id: string) => Built | null): Candidate {
  const { center } = w.ctx.plaza;
  const band = bandFor(flat(slot.position, center) * w.p.bandEstimateFactor, w.ctx.orders.bands.city);
  return { slot, band, cost, build };
}

/** The district holding `p` (the first listed whose rect does), or null. */
function districtAt(w: Pass, p: { x: number; z: number }): District | null {
  return w.ctx.city.districts.find((d) => contains(d.rect, p.x, p.z))?.district ?? null;
}

const inPlaza = (w: Pass, p: { x: number; z: number }): boolean => flat(p, w.ctx.plaza.center) < w.ctx.plaza.clearRadius;

/**
 * The districts' slots: street doors (a courier stands there), route slots the navigation links already reach both
 * ways, and kit slots (roofs) that get an access kit.
 */
function slotCandidates(w: Pass, slots: readonly PoiSlot[]): Candidate[] {
  const out: Candidate[] = [];
  for (const slot of slots) {
    if (inPlaza(w, slot.position)) continue;
    if (slot.access === 'kit') {
      const roof = roofLedge(w, slot);
      if (!roof) continue;
      const { ledge, kit } = roof;
      const build = kit === 'mantle' ? (id: string) => mantleKit(w, ledge, id) : (id: string) => padZipKit(w, ledge, slot.position, id);
      out.push(candidate(w, slot, kit, (id) => (standing(w, slot.position) ? build(id) : null)));
    } else if (slot.access === 'street' || w.reach.both(slot.position)) {
      out.push(candidate(w, slot, slot.access, () => (standing(w, slot.position) ? nothing() : null)));
    }
  }
  return out;
}

/**
 * Balcony slots: one per building tall enough for a balcony a floor up with headroom above it, on its first facade
 * (front, back, then the sides) whose body colliders (upright, standing on the ground) are at least the balcony's width
 * across, with room for the slab.
 */
function balconyCandidates(w: Pass): Candidate[] {
  const { city, pieces } = w.ctx;
  const b = w.p.balcony;
  const byProp = new Map<string, Solid[]>();
  for (const s of city.solids) {
    if (!s.hidden || s.kind !== 'building') continue;
    const prop = s.id.replace(/-c\d+$/, '');
    const list = byProp.get(prop);
    if (list) list.push(s);
    else byProp.set(prop, [s]);
  }
  const out: Candidate[] = [];
  for (const prop of city.props) {
    if (pieces[prop.piece]?.kind !== 'building') continue;
    const base = prop.position.y;
    const floor = base + b.floorHeight;
    const bodies = (byProp.get(prop.id) ?? [])
      .filter((s) => !isTilted(s) && s.center.y - s.size.y / 2 <= base + 0.1 && s.center.y + s.size.y / 2 >= floor + b.headroom)
      .map((s) => obstacleOf(s).rect);
    if (bodies.length === 0) continue;
    // One balcony per building: on the first facade (front, back, then the sides) with room for it
    const plan = facadeDirs(prop.rotY)
      .map((dir) => balconyOn(bodies, dir, floor, w))
      .find((x): x is BalconyPlan => !!x && allowed(w, x.rect) && w.space.free(x.rect, x.bottom, x.top + w.ctx.move.capsule.height + 0.1));
    if (!plan) continue;
    const position = v2({ x: (plan.rect.minX + plan.rect.maxX) / 2, y: floor, z: (plan.rect.minZ + plan.rect.maxZ) / 2 });
    const district = districtAt(w, position);
    if (!district || inPlaza(w, position)) continue;
    out.push(candidate(w, { position, kind: 'balcony', elevated: true, district, access: 'kit' }, 'mantle', (id) => balconyKit(w, plan, id)));
  }
  return out;
}

/**
 * Street furniture slots every furniture.step m along each flat, axis-aligned street edge (none near its ends), on
 * both sides, mailboxes and stalls in turn. The POI stands in the middle of the sidewalk: beside a mailbox at its outer
 * edge, or in front of a stall (a counter) just beyond it.
 */
function furnitureCandidates(w: Pass): Candidate[] {
  const { city, streets } = w.ctx;
  const f = w.p.furniture;
  const nodes = new Map(city.streets.nodes.map((n) => [n.id, n]));
  const out: Candidate[] = [];
  let turn = 0;
  for (const e of city.streets.edges) {
    const a = nodes.get(e.a)!.p;
    const b = nodes.get(e.b)!.p;
    if (nodes.get(e.a)!.plaza || nodes.get(e.b)!.plaza || a.y !== b.y || (a.x !== b.x && a.z !== b.z)) continue;
    const len = Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
    const u = { x: Math.sign(b.x - a.x), z: Math.sign(b.z - a.z) };
    const c = { x: Math.abs(u.z), z: Math.abs(u.x) };
    const hw = e.halfWidth;
    const at = (s: number, across: number): { x: number; z: number } => ({ x: a.x + u.x * s + c.x * across, z: a.z + u.z * s + c.z * across });
    /** The rect `s0`…`s1` along the edge and `c0`…`c1` across it. */
    const rectAt = (s0: number, s1: number, c0: number, c1: number): Rect => {
      const p = at(s0, c0);
      const q = at(s1, c1);
      return { minX: Math.min(p.x, q.x), maxX: Math.max(p.x, q.x), minZ: Math.min(p.z, q.z), maxZ: Math.max(p.z, q.z) };
    };
    for (let s = f.endClearance; s <= len - f.endClearance + 1e-9; s += f.step) {
      for (const side of [1, -1]) {
        const kind: PoiKind = turn++ % 2 === 0 ? 'mailbox' : 'counter';
        const position = v2({ ...at(s, side * (hw - streets.sidewalkWidth / 2)), y: a.y + streets.sidewalkTop });
        const district = districtAt(w, position);
        if (!district || inPlaza(w, position)) continue;
        const outer = side * hw;
        const build =
          kind === 'mailbox'
            ? (id: string): Built | null => {
              const m = f.mailbox;
              const edge = outer - side * m.inset;
              const rect = rectAt(s - m.width / 2, s + m.width / 2, edge, edge - side * m.depth);
              return furniture(w, `${id}-mailbox`, rect, position, position.y, m.height, SIDEWALK);
            }
            : (id: string): Built | null => {
              const st = f.stall;
              const rect = rectAt(s - st.width / 2, s + st.width / 2, outer + side * st.gap, outer + side * (st.gap + st.depth));
              return furniture(w, `${id}-stall`, rect, position, a.y, st.height, YARD);
            };
        out.push(candidate(w, { position, kind, elevated: false, district, access: 'street' }, 'street', build));
      }
    }
  }
  return out;
}

/**
 * A piece of street furniture: a box over `rect` from `level` up `height`, on level `kinds` ground, clear around and
 * above, away from marked features, the POI at `poi` standing free.
 */
function furniture(w: Pass, id: string, rect: Rect, poi: Vec3, level: number, height: number, kinds: ReadonlySet<SolidKind>): Built | null {
  const around = grow(rect, 0.3);
  if (!allowed(w, around) || !w.space.clear(around, w.p.featureClearance)) return null;
  if (!w.space.levelIn(rect, level - LEVEL_TOL, level + LEVEL_TOL, kinds)) return null;
  if (!w.space.free(around, level + 0.05, level + w.ctx.move.capsule.height + 0.5) || !standing(w, poi)) return null;
  return { ...nothing(), solids: [box(id, 'prop', rect, level, level + height)] };
}

// ---- Selection ------------------------------------------------------------------------------------------------

/**
 * A seeded weighted shuffle (Efraimidis–Spirakis): each candidate draws the key u^(1 / weight) and they are taken by
 * descending key, so a candidate of weight w comes up about w times as early as one of weight 1.
 */
function weightedOrder(cands: Candidate[], weight: (c: Candidate) => number, rng: Rng): Candidate[] {
  const keyed = cands.map((c) => ({ c, key: rng() ** (1 / weight(c)) }));
  return keyed.sort((a, b) => b.key - a.key).map((k) => k.c);
}

/**
 * Picks the POIs: per district, ceil(quota × elevatedTarget) elevated and the rest at street level, minSpacing apart.
 * Candidates are taken in a seeded order: first enough of each kindMin kind, then enough in each estimated band, then
 * the rest. A candidate is taken only when what it needs can be built; that is built at once (so later sites see it).
 */
function select(w: Pass, cands: Candidate[]): { pois: Poi[]; built: Built[] } {
  const p = w.p;
  const left = new Map<District, { elevated: number; street: number }>();
  for (const [d, n] of Object.entries(p.perDistrict) as [District, number][]) {
    const elevated = Math.ceil(n * p.elevatedTarget - 1e-9);
    left.set(d, { elevated, street: n - elevated });
  }
  const count = new Map<District, number>();
  const taken = new GridIndex<{ rect: Rect }>(p.minSpacing);
  const dead = new Set<Candidate>();
  const pois: Poi[] = [];
  const built: Built[] = [];
  const kinds = new Map<PoiKind, number>();
  const bands = new Map<Band, number>();

  const take = (c: Candidate): void => {
    if (dead.has(c)) return;
    const { slot } = c;
    const q = left.get(slot.district);
    const type = slot.elevated ? 'elevated' : 'street';
    if (!q || q[type] === 0) return;
    const spot = sq(slot.position, 0);
    if (taken.near(spot, p.minSpacing).some((t) => flat({ x: t.rect.minX, z: t.rect.minZ }, slot.position) < p.minSpacing)) return;
    const n = count.get(slot.district) ?? 0;
    const id = `poi-${slot.district}-${String(n).padStart(2, '0')}`;
    const b = c.build(id);
    dead.add(c);
    if (!b) return;
    for (const s of b.solids) w.space.addSolid(s);
    for (const m of b.marks) w.space.mark(m);
    for (const [x, y] of b.lines) w.space.markLine(x, y);
    // Later kits keep clear of this POI too
    w.space.mark(slot.position);
    built.push(b);
    pois.push({ id, position: slot.position, district: slot.district, kind: slot.kind, elevated: slot.elevated });
    taken.add({ rect: spot });
    q[type]--;
    count.set(slot.district, n + 1);
    kinds.set(slot.kind, (kinds.get(slot.kind) ?? 0) + 1);
    bands.set(c.band, (bands.get(c.band) ?? 0) + 1);
  };

  for (const [kind, min] of Object.entries(p.kindMin) as [PoiKind, number][]) {
    for (const c of cands) if (c.slot.kind === kind && (kinds.get(kind) ?? 0) < min) take(c);
  }
  for (const band of BANDS) for (const c of cands) if (c.band === band && (bands.get(band) ?? 0) < p.perBandMin) take(c);
  for (const c of cands) take(c);

  for (const [d, q] of left) {
    if (q.elevated > 0 || q.street > 0) throw new Error(`POI pass: district ${d} is short of ${q.elevated} elevated and ${q.street} street POIs`);
  }
  for (const [kind, min] of Object.entries(p.kindMin) as [PoiKind, number][]) {
    if ((kinds.get(kind) ?? 0) < min) throw new Error(`POI pass: only ${kinds.get(kind) ?? 0} ${kind} POIs (need ${min})`);
  }
  for (const band of BANDS) {
    if ((bands.get(band) ?? 0) < p.perBandMin) throw new Error(`POI pass: only ${bands.get(band) ?? 0} POIs in the ${band} band (need ${p.perBandMin})`);
  }
  return { pois, built };
}

/** Marks the city's movement features (and what the districts report) for the site searches to keep clear of. */
function markFeatures(space: Space, ctx: PoiContext): void {
  const { city, keepClear } = ctx;
  for (const pad of city.jumpPads) space.mark(pad.position);
  for (const z of city.zipLines) space.markLine(z.a, z.b);
  for (const r of city.rails) for (let k = 1; k < r.points.length; k++) space.markLine(r.points[k - 1]!, r.points[k]!);
  for (const c of city.checkpoints) space.mark(c.position);
  for (const l of city.navLinks) {
    if (l.kind === 'pad') space.markLine(l.from, l.to);
    space.mark(l.from);
    space.mark(l.to);
  }
  for (const p of keepClear.points) space.mark(p);
  for (const [a, b] of keepClear.segments) space.markLine(a, b);
}

/**
 * The POI pass (Task 13): picks `pois.total` POIs from the districts' slots, balconies on building facades and street
 * furniture spots (see `select`), and builds what each needs: an access kit for an elevated POI the districts do not
 * already reach both ways (a balcony; a roof ≤ 7 m above the ground beside it gets mantle steps up and a drop link down,
 * a higher one a pad up and a zip line down to street level), a mailbox or a stall. Ids are `poi-<district>-<nn>` in
 * pick order. `extras` holds the kits' solids, pads, zip lines and navigation links, and `report.poiKits` the kits.
 * Throws when a quota cannot be met or an elevated POI is not reached both ways by the navigation links.
 */
export function placePois(slots: readonly PoiSlot[], ctx: PoiContext): { pois: Poi[]; extras: Partial<DistrictOutput> } {
  const p = poiParams(ctx.params, ctx);
  const space = new Space(ctx.city.chunkSize / 4);
  for (const s of ctx.city.solids) space.addSolid(s);
  markFeatures(space, ctx);
  const w: Pass = { ctx, p, space, reach: new Reach(space, ctx.city.navLinks), maxFall: ctx.orders.fragile.maxFallMeters };

  const all = [...slotCandidates(w, slots), ...balconyCandidates(w), ...furnitureCandidates(w)];
  const cands = weightedOrder(all, (c) => p.pickWeights[c.cost], ctx.rng);
  const { pois, built } = select(w, cands);

  const navLinks = built.flatMap((b) => b.navLinks);
  const reach = new Reach(space, [...ctx.city.navLinks, ...navLinks]);
  for (const poi of pois) {
    if (poi.elevated && !reach.both(poi.position)) throw new Error(`POI pass: ${poi.id} is not reached both ways by the navigation links`);
  }
  pois.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    pois,
    extras: {
      solids: built.flatMap((b) => b.solids),
      jumpPads: built.flatMap((b) => b.jumpPads),
      zipLines: built.flatMap((b) => b.zipLines),
      navLinks,
      report: { poiKits: built.flatMap((b) => (b.kit ? [b.kit] : [])) },
    },
  };
}
