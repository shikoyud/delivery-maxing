import {
  MANTLE_WALL_PROBE_HEIGHT,
  rotatedHalfExtents,
  solidRect,
  type JumpPad,
  type NavLink,
  type Rect,
  type RotY,
  type Solid,
  type Vec3,
  type ZipLine,
} from '@dm/shared';
import { top, v2 } from './layout';
import { yawPoint } from './lots';

/** Depth of one crate step along the climb, m. */
const STEP_DEPTH = 1.5;
/** Width of a crate step across the climb, m. */
const STEP_WIDTH = 2;
/** city.json coordinate precision, m. */
const SNAP = 0.01;

/**
 * The launch velocity that carries a body from `start` to `target` under `gravity` with no air control: it peaks at
 * max(start.y, target.y) + apexAbove and comes down through `target` (so a pad flight's fall onto a higher target is
 * apexAbove). Rounded to 0.01 m/s like every value in city.json.
 */
export function padLaunchFor(start: Vec3, target: Vec3, apexAbove: number, gravity: number): Vec3 {
  const peak = Math.max(start.y, target.y) + apexAbove;
  const vy = Math.sqrt(2 * gravity * (peak - start.y));
  const t = vy / gravity + Math.sqrt((2 * (peak - target.y)) / gravity);
  return v2({ x: (target.x - start.x) / t, y: vy, z: (target.z - start.z) / t });
}

/**
 * Crate steps up to a ledge: equal rises of at most `rise` from `base.y`, so the last crate stands at most `rise`
 * below `top.y`. `base` is the foot of the ledge face (ground height, centre of the stack's width) and `dir` the way
 * the climber faces (the yaw that turns +z toward the ledge). The tallest crate stands against the face at `base`,
 * each lower one 1.5 m further back. Ids are `<id>-<k>`, lowest (farthest) first. Empty when the ledge is within one
 * rise of the base.
 */
export function mantleSteps(base: Vec3, top: Vec3, dir: RotY, rise: number, id = 'steps'): Solid[] {
  const climb = top.y - base.y;
  // Heights snap to 0.02 m (so each centre lands on the 0.01 grid); the steps leave room for that snap under `rise`.
  const n = Math.ceil(climb / (rise - 2 * SNAP) - 1e-9) - 1;
  if (n <= 0) return [];
  const each = climb / (n + 1);
  const quarter = dir === 90 || dir === 270;
  const out: Solid[] = [];
  for (let k = 1; k <= n; k++) {
    // Crate k (1 = lowest) stands (n − k + 0.5) depths back from the face, against the climb direction.
    const back = yawPoint({ x: 0, y: 0, z: -(n - k + 0.5) * STEP_DEPTH }, dir);
    const h = Math.round((each * k) / (2 * SNAP)) * 2 * SNAP;
    out.push({
      id: `${id}-${k - 1}`,
      kind: 'prop',
      center: v2({ x: base.x + back.x, y: base.y + h / 2, z: base.z + back.z }),
      size: v2(quarter ? { x: STEP_DEPTH, y: h, z: STEP_WIDTH } : { x: STEP_WIDTH, y: h, z: STEP_DEPTH }),
    });
  }
  return out;
}

/**
 * The least rise of a mantle step a running courier can climb (Ruling R17): the mantle's wall probe sits this high
 * above the feet, so a lower face is never seen as a ledge. Kit rises lie in [this, mantle.maxHeight].
 */
export const MANTLE_STEP_MIN_RISE = MANTLE_WALL_PROBE_HEIGHT;

/** The rises (lowest first, the last one onto the ledge) of the mantleSteps kit climbing `climb` with `rise`. */
export function mantleStepRises(climb: number, rise: number): number[] {
  const tops = [0, ...mantleSteps({ x: 0, y: 0, z: 0 }, { x: 0, y: climb, z: 0 }, 0, rise).map(top), climb];
  return tops.slice(1).map((t, k) => t - tops[k]!);
}

/** A zip line between two cable points (rounded to 0.01 m). */
export function zipBetween(a: Vec3, b: Vec3, id: string): ZipLine {
  return { id, a: v2(a), b: v2(b) };
}

/** A pad together with the point its flight lands on. */
export type PadLink = JumpPad & { target: Vec3 };
/** A mantle stack (climbed both ways) or a drop (down only), between two standing points. */
export interface StepLink { kind: 'mantle' | 'drop'; id: string; from: Vec3; to: Vec3 }

/**
 * The navigation link for a feature: a zip line rides both ways between its cable ends (`<id>-nav`); a pad goes one
 * way from the pad to its landing point (`<id>-nav`); a mantle stack is climbed up and stepped down (both ways); a
 * drop goes down only.
 */
export function navLinkFor(feature: ZipLine | PadLink | StepLink): NavLink {
  if ('a' in feature) return { id: `${feature.id}-nav`, kind: 'zip', from: feature.a, to: feature.b, bidirectional: true };
  if ('launch' in feature) {
    return { id: `${feature.id}-nav`, kind: 'pad', from: feature.position, to: v2(feature.target), bidirectional: false };
  }
  return { id: feature.id, kind: feature.kind, from: feature.from, to: feature.to, bidirectional: feature.kind === 'mantle' };
}

/** A box to keep features clear of: a solid's footprint and top. */
export interface Obstacle { rect: Rect; top: number }

/** The obstacle a solid makes: its footprint and the top of its (rotated) box. */
export function obstacleOf(s: Solid): Obstacle {
  const h = rotatedHalfExtents({ x: s.size.x / 2, y: s.size.y / 2, z: s.size.z / 2 }, s.rotationDeg);
  return { rect: solidRect(s), top: s.center.y + h.y };
}

const inRect = (x: number, z: number, r: Rect, pad: number): boolean =>
  x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;

/**
 * Whether a rider hanging `hang` m below the cable from `a` to `b` (a capsule of `radius`) clears every obstacle:
 * at each 0.5 m along the cable, every obstacle whose footprint (grown by `radius`) is under the cable tops out at
 * least `hang` m below it.
 */
export function cableClear(a: Vec3, b: Vec3, hang: number, radius: number, obstacles: readonly Obstacle[]): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / 0.5));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    for (const o of obstacles) if (inRect(x, z, o.rect, radius) && o.top > y - hang + 1e-6) return false;
  }
  return true;
}

/**
 * Whether a pad flight from `start` at `launch` (no air control) reaches `target` clear of every obstacle: wherever
 * the feet pass over an obstacle's footprint (grown by `radius`) they are at least `clearance` m above its top; over
 * the landing obstacle (the one `target` stands on) that holds where the feet first come over it.
 */
export function padFlightClear(
  start: Vec3,
  launch: Vec3,
  target: Vec3,
  gravity: number,
  radius: number,
  clearance: number,
  obstacles: readonly Obstacle[],
): boolean {
  const vy = launch.y;
  const peak = start.y + (vy * vy) / (2 * gravity);
  if (peak < target.y) return false;
  const total = vy / gravity + Math.sqrt((2 * (peak - target.y)) / gravity);
  const landing = obstacles.filter((o) => inRect(target.x, target.z, o.rect, 0) && Math.abs(o.top - target.y) < 0.05);
  const entered = new Set<Obstacle>();
  const steps = Math.ceil(total * 60);
  for (let k = 0; k < steps; k++) {
    const t = (k / steps) * total;
    const x = start.x + launch.x * t;
    const y = start.y + vy * t - (gravity * t * t) / 2;
    const z = start.z + launch.z * t;
    for (const o of obstacles) {
      if (!inRect(x, z, o.rect, radius)) continue;
      if (landing.includes(o) && entered.has(o)) continue;
      entered.add(o);
      if (y < o.top + clearance) return false;
    }
  }
  return true;
}
