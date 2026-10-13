import { movementConfig, type ThievesConfig } from '../config';
import { vec3, type Vec3 } from '../math/vec3';
import type { Rng } from '../util/rng';
import type { CityMap } from '../world/cityTypes';
import { StreetGraph } from '../world/streets';
import type { CourierInfo, LineOfSight, ThiefEvent, ThiefState } from './types';

/** Accumulated timers within this of a limit count as reaching it (30 ticks of 1/30 s sum to 0.9999…). */
const TIME_EPS = 1e-9;
/** Height slack when keeping a thief on its street level, m (city.json heights are rounded to 0.01). */
const LEVEL_EPS = 0.01;
/** Most nodes a thief may pass in one tick (a guard against zero-length hops). */
const MAX_HOPS = 8;
/**
 * A chase step that gets the thief less than this share of the way it tried (it is held at the side of its street, the
 * courier being on another street it cannot reach in a straight line) sends it round by the streets instead.
 */
const PINNED_SHARE = 0.5;
/** The line-of-sight target on the courier: the middle of the standing capsule above the feet. */
const CHEST_HEIGHT = movementConfig.capsule.height / 2;

type ChaseEnd = Extract<ThiefEvent, { kind: 'chaseEnded' }>['reason'];
type ChaseOutcome = ChaseEnd | 'caught' | null;

/** Shared by the step functions: the streets, tuning and random stream. */
interface Ctx { graph: StreetGraph; cfg: ThievesConfig; rng: Rng }

const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** The facing() yaw of a horizontal direction (yaw 0 faces −z). */
const yawOf = (dx: number, dz: number, fallback: number): number => (dx === 0 && dz === 0 ? fallback : Math.atan2(-dx, -dz));

/**
 * Street thieves (spec §7.3), deterministic for a given Rng: they patrol the street graph, chase a carrying courier
 * they see within the trigger radius, catch on touch, and give up on timeout, distance, height or the HUB plaza.
 * The SP4 server runs this for a room; robbery itself (failed orders, the penalty) is the caller's.
 */
export class ThiefSystem {
  readonly thieves: ThiefState[];
  /** Sim time until which the courier is ignored (robbed cooldown). */
  ignoreUntil = 0;
  private readonly ctx: Ctx;

  constructor(city: CityMap, cfg: ThievesConfig, rng: Rng) {
    const graph = new StreetGraph(city.streets, city.hub, cfg.plazaMargin);
    this.ctx = { graph, cfg, rng };
    this.thieves = city.thiefSpawns.map((s) => ({
      id: s.id,
      position: graph.position(s.node),
      heading: 0,
      speed: cfg.patrolSpeed,
      mode: 'patrol',
      chaseTime: 0,
      aboveTime: 0,
      route: [graph.nextNode(s.node, null, rng)],
      prevNode: s.node,
    }));
  }

  step(dt: number, now: number, courier: CourierInfo, lineOfSight: LineOfSight): ThiefEvent[] {
    const events: ThiefEvent[] = [];
    for (const t of this.thieves) {
      if (t.mode !== 'chase') {
        walkRoute(this.ctx, t, dt);
        continue;
      }
      const outcome = chaseStep(this.ctx, t, dt, courier);
      if (outcome === null) continue;
      if (outcome === 'caught') {
        events.push({ kind: 'caught', thiefId: t.id });
        this.ignoreUntil = now + this.ctx.cfg.robbedCooldownSeconds;
      } else events.push({ kind: 'chaseEnded', thiefId: t.id, reason: outcome });
      enterReturn(this.ctx, t);
    }
    if (!this.thieves.some((t) => t.mode === 'chase') && now >= this.ignoreUntil) {
      const chaser = triggerChase(this.ctx, this.thieves, courier, lineOfSight);
      if (chaser) events.push({ kind: 'chaseStarted', thiefId: chaser.id });
    }
    return events;
  }
}

/**
 * The nearest patrolling thief within the trigger radius (3D) that sees the courier (eye to chest) starts a chase,
 * if the courier carries a package, is not in the plaza, and is not above street level relative to that thief (more
 * than catchHeight up, ruling R26: a courier on a ledge or roof is left alone rather than chased and given up on).
 */
function triggerChase({ cfg }: Ctx, thieves: ThiefState[], courier: CourierInfo, lineOfSight: LineOfSight): ThiefState | null {
  if (courier.carrying < 1 || courier.inPlaza) return null;
  const c = courier.position;
  const chest = vec3(c.x, c.y + CHEST_HEIGHT, c.z);
  const near = thieves
    .map((t) => ({ t, d: dist3(t.position, c) }))
    .filter(({ t, d }) => t.mode === 'patrol' && d <= cfg.triggerRadius && c.y - t.position.y <= cfg.catchHeight)
    .sort((a, b) => a.d - b.d);
  for (const { t } of near) {
    const p = t.position;
    if (!lineOfSight(vec3(p.x, p.y + cfg.eyeHeight, p.z), chest)) continue;
    Object.assign(t, { mode: 'chase', chaseTime: 0, aboveTime: 0, route: [], speed: cfg.chaseSpeed });
    return t;
  }
  return null;
}

/**
 * One chase tick: toward the courier at chase speed, kept on the streets (see stepToward, or round by the streets while
 * `route` holds a detour); then catch and give-up checks. A courier in the plaza or carrying nothing (R25) ends the
 * chase before the thief moves, so an empty courier is never caught.
 */
function chaseStep(ctx: Ctx, t: ThiefState, dt: number, courier: CourierInfo): ChaseOutcome {
  const { cfg } = ctx;
  if (courier.inPlaza) return 'plaza';
  if (courier.carrying < 1) return 'empty';
  const c = courier.position;
  if (t.route.length > 0) followRoute(ctx.graph, t, cfg.chaseSpeed * dt);
  else stepToward(ctx, t, c, dt);

  const dy = c.y - t.position.y;
  if (Math.hypot(c.x - t.position.x, c.z - t.position.z) <= cfg.catchRadius && Math.abs(dy) <= cfg.catchHeight) return 'caught';
  t.aboveTime = dy > cfg.catchHeight ? t.aboveTime + dt : 0;
  if (t.aboveTime >= cfg.aboveGiveUpSeconds - TIME_EPS) return 'above';
  t.chaseTime += dt;
  if (t.chaseTime >= cfg.maxChaseSeconds - TIME_EPS) return 'timeout';
  if (dist3(t.position, c) > cfg.loseDistance) return 'distance';
  return null;
}

/**
 * A straight chase step toward the courier, projected onto the thief's own street level: the step moves it at most
 * twice its length along a street (the projection can add up to one step), so its height changes by at most maxSlope
 * times that, and streets beside, over or under its own are out. Where the strips meet, the courier's street is
 * preferred. Held at the side of its street (the courier on another street it cannot reach straight), the thief
 * takes the streets round to the courier's instead, from the next tick.
 */
function stepToward({ graph, cfg }: Ctx, t: ThiefState, c: Vec3, dt: number): void {
  const dx = c.x - t.position.x;
  const dz = c.z - t.position.z;
  const h = Math.hypot(dx, dz);
  const step = Math.min(h, cfg.chaseSpeed * dt);
  const k = h > 0 ? step / h : 0;
  t.heading = yawOf(dx, dz, t.heading);
  const there = graph.project(c).edge;
  const maxDy = 2 * graph.maxSlope * cfg.chaseSpeed * dt + LEVEL_EPS;
  const next = graph.projectOnLevel(vec3(t.position.x + dx * k, t.position.y, t.position.z + dz * k), t.position.y, maxDy, there);
  const moved = next ? Math.hypot(next.p.x - t.position.x, next.p.z - t.position.z) : 0;
  if (moved < PINNED_SHARE * step) {
    const here = graph.projectOnLevel(t.position, t.position.y, LEVEL_EPS)?.edge;
    if (here !== undefined && here !== there) t.route = graph.routeToward(t.position, here, c, there);
  }
  if (next) t.position = next.p;
}

/** Chase detour: straight on along the route's nodes by `dist`, dropping each node reached. */
function followRoute(graph: StreetGraph, t: ThiefState, dist: number): void {
  let left = dist;
  for (let hop = 0; hop < MAX_HOPS && left >= 0 && t.route.length > 0; hop++) {
    left = moveToward(t, graph.position(t.route[0]!), left);
    if (left >= 0) t.route.shift();
  }
}

/** Moves the thief straight toward p by at most `dist`; the distance left over once there, or −1 if not there yet. */
function moveToward(t: ThiefState, p: Vec3, dist: number): number {
  const d = dist3(t.position, p);
  if (d > dist) {
    const k = dist / d;
    t.heading = yawOf(p.x - t.position.x, p.z - t.position.z, t.heading);
    t.position = vec3(t.position.x + (p.x - t.position.x) * k, t.position.y + (p.y - t.position.y) * k, t.position.z + (p.z - t.position.z) * k);
    return -1;
  }
  t.position = p;
  return dist - d;
}

/**
 * After a chase: back onto the graph at the nearer usable end of the edge the thief stands on (on its own level), in a
 * straight line inside that edge's strip at return speed; from that node it patrols on. (Not on to the nearest node by
 * distance: on the hillside that can be a street on another level, a long detour.)
 */
function enterReturn({ graph, cfg }: Ctx, t: ThiefState): void {
  const { edge } = graph.projectOnLevel(t.position, t.position.y, LEVEL_EPS) ?? graph.project(t.position);
  const ends = graph.edgeEnds(edge).filter((n) => graph.isThiefNode(n));
  const entry = ends.reduce((a, b) => (dist3(graph.position(b), t.position) < dist3(graph.position(a), t.position) ? b : a));
  Object.assign(t, {
    mode: 'return',
    route: [entry],
    prevNode: null,
    chaseTime: 0,
    aboveTime: 0,
    speed: cfg.returnSpeed,
  });
}

/**
 * Patrol and return: walks the route at the mode's speed. At each node reached the thief remembers it; when the route
 * runs out it patrols on to a random next node (not back the way it came, unless at a dead end).
 */
function walkRoute({ graph, cfg, rng }: Ctx, t: ThiefState, dt: number): void {
  let time = dt;
  for (let hop = 0; hop < MAX_HOPS && time > 0; hop++) {
    const target = t.route[0];
    if (target === undefined || t.speed <= 0) return;
    const left = moveToward(t, graph.position(target), t.speed * time);
    if (left < 0) return;
    time = left / t.speed;
    t.route.shift();
    const before = t.prevNode;
    t.prevNode = target;
    if (t.route.length === 0) {
      t.route = [graph.nextNode(target, before, rng)];
      t.mode = 'patrol';
      t.speed = cfg.patrolSpeed;
    }
  }
}
