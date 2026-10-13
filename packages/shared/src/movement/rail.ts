import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { add, closestOnSegment, dot, length, normalize, scale, sub, vec3, type Vec3 } from '../math/vec3';
import type { Rail } from '../world/mapTypes';
import { jumpVelocity } from './jump';
import { enterAir } from './triggers';
import type { PlayerState, StatModifiers } from './types';

/** Feet sit this far (m) above the rail point while grinding. Structural, like the capsule skin: not a tuning value. */
const FEET_LIFT = 0.05;
/** The feet may be at most this far (m) below the rail point and still snap on. */
const SNAP_BELOW = 0.1;
/** Tolerance (m) for "the closest point is a rail end". */
const END_EPS = 1e-6;

const segmentStart = (rail: Rail, i: number): Vec3 => rail.points[i] as Vec3;
const segmentEnd = (rail: Rail, i: number): Vec3 => rail.points[i + 1] as Vec3;
const segmentCount = (rail: Rail): number => rail.points.length - 1;
const segmentLength = (rail: Rail, i: number): number => length(sub(segmentEnd(rail, i), segmentStart(rail, i)));
const segmentDir = (rail: Rail, i: number): Vec3 => normalize(sub(segmentEnd(rail, i), segmentStart(rail, i)));

/** Unit grind direction (3D) on segment i travelling in direction `dir` (+1 toward the last point). */
const grindDirection = (rail: Rail, i: number, dir: 1 | -1): Vec3 => scale(segmentDir(rail, i), dir);

const pointOn = (rail: Rail, i: number, s: number): Vec3 => add(segmentStart(rail, i), scale(segmentDir(rail, i), s));
const feetOn = (rail: Rail, i: number, s: number): Vec3 => {
  const p = pointOn(rail, i, s);
  return vec3(p.x, p.y + FEET_LIFT, p.z);
};

/** Minimum grind speed (m/s): board.railMinSpeed on the board, rail.minSpeedFoot on foot. */
export function railMinSpeed(state: PlayerState, cfg: MovementConfig): number {
  return state.onBoard ? cfg.board.railMinSpeed : cfg.rail.minSpeedFoot;
}

/** Distance from `p` to the nearest point of `rail`. */
const distanceToRail = (p: Vec3, rail: Rail): number => {
  let best = Infinity;
  for (let i = 0; i < segmentCount(rail); i++) best = Math.min(best, closestOnSegment(p, segmentStart(rail, i), segmentEnd(rail, i)).dist);
  return best;
};

/**
 * Snaps onto the nearest rail when the player is airborne and not rising, the feet are within rail.snapDistance of
 * a segment's closest point and no lower than SNAP_BELOW under it. The direction is the sign of velocity · segment
 * direction; the speed is max(|horizontal velocity along it|, railMinSpeed). A rail's two end points never snap,
 * and the rail just left at an end (state.railRelease) does not snap until the feet are more than snapDistance from
 * it: the feet ride lifted above the rail, so off a sloped end segment their closest point lies just short of the
 * end and would catch them again every tick (Ruling R19). Returns whether the player started grinding.
 */
export function tryStartGrind(state: PlayerState, rails: Rail[], cfg: MovementConfig): boolean {
  const feet = state.position;
  if (state.railRelease !== null) {
    const left = rails.find((r) => r.id === state.railRelease);
    if (!left || distanceToRail(feet, left) > cfg.rail.snapDistance) state.railRelease = null;
  }
  if (state.mode !== 'air' || state.grounded || state.velocity.y > 0) return false;

  let best: { rail: Rail; segment: number; s: number; dist: number } | null = null;
  for (const rail of rails) {
    if (rail.id === state.railRelease) continue;
    const n = segmentCount(rail);
    for (let i = 0; i < n; i++) {
      const hit = closestOnSegment(feet, segmentStart(rail, i), segmentEnd(rail, i));
      if (hit.dist > cfg.rail.snapDistance || feet.y < hit.point.y - SNAP_BELOW) continue;
      const atRailEnd = (i === 0 && hit.s <= END_EPS) || (i === n - 1 && hit.s >= segmentLength(rail, i) - END_EPS);
      if (atRailEnd) continue;
      if (!best || hit.dist < best.dist) best = { rail, segment: i, s: hit.s, dist: hit.dist };
    }
  }
  if (!best) return false;

  const { rail, segment } = best;
  const along = segmentDir(rail, segment);
  const dir: 1 | -1 = dot(state.velocity, along) >= 0 ? 1 : -1;
  const horizontalAlong = state.velocity.x * along.x * dir + state.velocity.z * along.z * dir;
  const speed = Math.min(Math.max(horizontalAlong, railMinSpeed(state, cfg)), cfg.speedCap);

  state.grind = { id: rail.id, segment, s: best.s, dir, speed };
  state.mode = 'grind';
  state.grounded = false;
  state.groundNormal = vec3(0, 1, 0);
  state.mantle = null;
  state.wallRun = { time: 0, normal: null, lastNormal: null };
  state.jumpPressAge = null;
  return true;
}

/**
 * Advances a grind by dt and sets state.position and state.velocity (the caller moves the body there, ignoring
 * collisions). Speed changes by (g·downhill − friction)·dt and stays within [railMinSpeed, speedCap]. The grind
 * crosses segment joints, and ends at the rail's end (launching along the last segment) or when jump is pressed
 * (which also adds jumpVelocity); the player is then airborne with a fresh fall-height apex and no coyote jump.
 */
export function updateGrind(
  state: PlayerState,
  rail: Rail,
  input: InputFrame,
  cfg: MovementConfig,
  mods: StatModifiers,
  dt: number,
): 'grinding' | 'detached' {
  const g = state.grind;
  if (!g) return 'detached';

  const downhill = -grindDirection(rail, g.segment, g.dir).y;
  g.speed += (cfg.gravity * downhill - cfg.rail.friction) * dt;
  g.speed = Math.min(Math.max(g.speed, railMinSpeed(state, cfg)), cfg.speedCap);

  let remaining = g.speed * dt;
  let atEnd = false;
  for (;;) {
    const room = g.dir === 1 ? segmentLength(rail, g.segment) - g.s : g.s;
    if (remaining <= room) {
      g.s += g.dir * remaining;
      break;
    }
    remaining -= room;
    const next = g.segment + g.dir;
    if (next < 0 || next >= segmentCount(rail)) {
      g.s = g.dir === 1 ? segmentLength(rail, g.segment) : 0;
      atEnd = true;
      break;
    }
    g.segment = next;
    g.s = g.dir === 1 ? 0 : segmentLength(rail, next);
  }

  state.position = feetOn(rail, g.segment, g.s);
  state.velocity = scale(grindDirection(rail, g.segment, g.dir), g.speed);

  const jump = !atEnd && input.jump.pressed;
  if (!atEnd && !jump) return 'grinding';
  if (jump) state.velocity = vec3(state.velocity.x, state.velocity.y + jumpVelocity(cfg, mods), state.velocity.z);
  const left = state.grind!.id;
  enterAir(state, cfg); // clears grind, mode air, closes the coyote window, sets airApexY to the feet y
  state.jumpPressAge = null;
  if (atEnd) state.railRelease = left;
  return 'detached';
}
