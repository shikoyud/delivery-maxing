import { movementConfig, type ThievesConfig } from '../config';
import { vec3, type Vec3 } from '../math/vec3';
import type { Rng } from '../util/rng';
import type { CityMap } from '../world/cityTypes';
import { StreetGraph } from '../world/streets';
import type { CourierInfo, LineOfSight, ThiefEvent, ThiefState } from './types';

/** Accumulated timers within this of a limit count as reaching it (30 ticks of 1/30 s sum to 0.9999…). */
const TIME_EPS = 1e-9;
/** Most nodes a thief may pass in one tick (a guard against zero-length hops). */
const MAX_HOPS = 8;
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
 * if the courier carries a package and is not in the plaza.
 */
function triggerChase({ cfg }: Ctx, thieves: ThiefState[], courier: CourierInfo, lineOfSight: LineOfSight): ThiefState | null {
  if (courier.carrying < 1 || courier.inPlaza) return null;
  const c = courier.position;
  const chest = vec3(c.x, c.y + CHEST_HEIGHT, c.z);
  const near = thieves
    .map((t) => ({ t, d: dist3(t.position, c) }))
    .filter(({ t, d }) => t.mode === 'patrol' && d <= cfg.triggerRadius)
    .sort((a, b) => a.d - b.d);
  for (const { t } of near) {
    const p = t.position;
    if (!lineOfSight(vec3(p.x, p.y + cfg.eyeHeight, p.z), chest)) continue;
    Object.assign(t, { mode: 'chase', chaseTime: 0, aboveTime: 0, route: [], speed: cfg.chaseSpeed });
    return t;
  }
  return null;
}

/** One chase tick: toward the courier at chase speed, kept on the streets; then catch and give-up checks. */
function chaseStep({ graph, cfg }: Ctx, t: ThiefState, dt: number, courier: CourierInfo): ChaseOutcome {
  if (courier.inPlaza) return 'plaza';
  const c = courier.position;
  const dx = c.x - t.position.x;
  const dz = c.z - t.position.z;
  const h = Math.hypot(dx, dz);
  const k = h > 0 ? Math.min(1, (cfg.chaseSpeed * dt) / h) : 0;
  t.position = graph.project(vec3(t.position.x + dx * k, t.position.y, t.position.z + dz * k)).p;
  t.heading = yawOf(dx, dz, t.heading);

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
 * After a chase: back onto the graph at the nearer usable end of the edge the thief stands on (a straight line inside
 * that edge's strip), then the A* route to the node nearest to it, at return speed.
 */
function enterReturn({ graph, cfg }: Ctx, t: ThiefState): void {
  const { edge } = graph.project(t.position);
  const ends = graph.edgeEnds(edge).filter((n) => graph.isThiefNode(n));
  const entry = ends.reduce((a, b) => (dist3(graph.position(b), t.position) < dist3(graph.position(a), t.position) ? b : a));
  const path = graph.route(entry, graph.nearestNode(t.position));
  Object.assign(t, {
    mode: 'return',
    route: path.length > 0 ? path : [entry],
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
    const p = graph.position(target);
    const d = dist3(t.position, p);
    const left = t.speed * time;
    if (d > left) {
      const k = left / d;
      t.heading = yawOf(p.x - t.position.x, p.z - t.position.z, t.heading);
      t.position = vec3(t.position.x + (p.x - t.position.x) * k, t.position.y + (p.y - t.position.y) * k, t.position.z + (p.z - t.position.z) * k);
      return;
    }
    time -= d / t.speed;
    t.position = p;
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
