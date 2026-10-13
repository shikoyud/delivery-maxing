import { describe, expect, it } from 'vitest';
import { movementConfig, thievesConfig } from '../../src/config';
import { closestOnSegment, vec3, type Vec3 } from '../../src/math/vec3';
import { ThiefSystem } from '../../src/thieves/ThiefSystem';
import type { CourierInfo, ThiefEvent, ThiefState } from '../../src/thieves/types';
import { mulberry32 } from '../../src/util/rng';
import { thiefCity } from '../world/fixtures';

const DT = 1 / movementConfig.tickRate;
const cfg = thievesConfig;
const ROAD = 0.02;
const always = (): boolean => true;
const never = (): boolean => false;

/** One thief spawned at `node` of the fixture city (main street nodes: n0 x 60 … n6 x 420, z 0). */
const systemAt = (node: string, seed = 1): ThiefSystem =>
  new ThiefSystem(thiefCity([{ id: 'th-0', node, district: 'downtown' }]), cfg, mulberry32(seed));

const courierAt = (p: Vec3, carrying = 1): CourierInfo => ({
  position: p,
  carrying,
  inPlaza: Math.hypot(p.x, p.z) < thiefCity().hub.plazaRadius,
});

/** Steps the system with a courier moved by `move` each tick (from its start); stops after `seconds` or on `until`. */
function run(
  sys: ThiefSystem,
  start: Vec3,
  move: (p: Vec3, t: number) => Vec3,
  seconds: number,
  opts: { until?: (e: ThiefEvent) => boolean; t0?: number; los?: () => boolean } = {},
): { events: { t: number; e: ThiefEvent }[]; courier: Vec3; t: number } {
  const events: { t: number; e: ThiefEvent }[] = [];
  let p = start;
  let t = opts.t0 ?? 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    t += DT;
    p = move(p, t);
    const out = sys.step(DT, t, courierAt(p), opts.los ?? always);
    for (const e of out) events.push({ t, e });
    if (out.some((e) => opts.until?.(e))) break;
  }
  return { events, courier: p, t };
}

const still = (p: Vec3): Vec3 => p;
const alongX = (speed: number) => (p: Vec3): Vec3 => vec3(p.x + speed * DT, p.y, p.z);
const kinds = (events: { e: ThiefEvent }[]): string[] => events.map(({ e }) => (e.kind === 'chaseEnded' ? `ended:${e.reason}` : e.kind));
const thief = (sys: ThiefSystem): ThiefState => sys.thieves[0]!;
const hDist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

describe('ThiefSystem', () => {
  it('spawns one patrolling thief per spawn on its node', () => {
    const sys = systemAt('n2');
    expect(sys.thieves).toHaveLength(1);
    expect(thief(sys)).toMatchObject({ id: 'th-0', mode: 'patrol', position: { x: 180, y: 0, z: 0 } });
  });

  it('no chase when the courier carries 0', () => {
    const sys = systemAt('n2');
    for (let i = 1; i <= 60; i++) {
      const p = thief(sys).position;
      expect(sys.step(DT, i * DT, courierAt(vec3(p.x + 5, ROAD, p.z), 0), always)).toEqual([]);
    }
    expect(thief(sys).mode).toBe('patrol');
  });

  it('chase starts within 15 m with line of sight, not at 16 m, not without LOS', () => {
    const near = (sys: ThiefSystem, d: number, los: () => boolean, from?: Vec3[], to?: Vec3[]): ThiefEvent[] => {
      const p = thief(sys).position;
      return sys.step(DT, DT, courierAt(vec3(p.x + d, ROAD, p.z)), (a, b) => {
        from?.push(a);
        to?.push(b);
        return los();
      });
    };
    expect(near(systemAt('n2'), 16, always)).toEqual([]);
    expect(near(systemAt('n2'), 14.5, never)).toEqual([]);
    const from: Vec3[] = [];
    const to: Vec3[] = [];
    const sys = systemAt('n2');
    expect(near(sys, 14.5, always, from, to)).toEqual([{ kind: 'chaseStarted', thiefId: 'th-0' }]);
    expect(thief(sys).mode).toBe('chase');
    // Line of sight runs from the thief's eye to the courier's chest
    expect(from[0]!.y).toBeCloseTo(thief(sys).position.y + cfg.eyeHeight, 9);
    expect(to[0]!.y).toBeCloseTo(ROAD + movementConfig.capsule.height / 2, 9);
  });

  it('chase speed: 7 m in 1 s (±0.1)', () => {
    const sys = systemAt('n2');
    const start = vec3(180 + 14, ROAD, 0);
    run(sys, start, still, 1, { until: (e) => e.kind === 'chaseStarted' });
    const from = { ...thief(sys).position };
    run(sys, start, still, 1);
    expect(thief(sys).mode).toBe('chase');
    expect(hDist(thief(sys).position, from)).toBeGreaterThan(cfg.chaseSpeed - 0.1);
    expect(hDist(thief(sys).position, from)).toBeLessThan(cfg.chaseSpeed + 0.1);
  });

  it('a courier running away at 5.5 m/s is caught', () => {
    const sys = systemAt('n2');
    const { events } = run(sys, vec3(192, ROAD, 0), alongX(movementConfig.run.runSpeed), 12, { until: (e) => e.kind === 'caught' });
    expect(kinds(events)).toEqual(['chaseStarted', 'caught']);
    expect(thief(sys).mode).toBe('return');
  });

  it('a courier sprinting away at 8 m/s escapes (ends with distance or timeout, never caught)', () => {
    const sys = systemAt('n2');
    const { events } = run(sys, vec3(192, ROAD, 0), alongX(movementConfig.run.sprintSpeed), 12);
    expect(kinds(events)[0]).toBe('chaseStarted');
    expect(['ended:distance', 'ended:timeout']).toContain(kinds(events)[1]);
    expect(kinds(events)).not.toContain('caught');
  });

  it('gives up after 10 s', () => {
    const sys = systemAt('n2');
    const { events } = run(sys, vec3(192, ROAD, 0), alongX(cfg.chaseSpeed), 15, { until: (e) => e.kind === 'chaseEnded' });
    expect(kinds(events)).toEqual(['chaseStarted', 'ended:timeout']);
    const [started, ended] = events;
    expect(ended!.t - started!.t).toBeCloseTo(cfg.maxChaseSeconds, 1);
    expect(thief(sys).mode).toBe('return');
  });

  it("a courier 3 m above the street can't be caught and the thief gives up after 1 s", () => {
    const sys = systemAt('n2');
    const { events } = run(sys, vec3(186, 3, 0), still, 5, { until: (e) => e.kind === 'chaseEnded' });
    expect(kinds(events)).toEqual(['chaseStarted', 'ended:above']);
    const [started, ended] = events;
    expect(ended!.t - started!.t).toBeCloseTo(cfg.aboveGiveUpSeconds, 1);
    // It got right under the courier and still did not catch
    expect(hDist(thief(sys).position, vec3(186, 0, 0))).toBeLessThan(cfg.catchRadius);
  });

  it('entering the plaza ends the chase (reason plaza)', () => {
    const sys = systemAt('n0');
    const { events } = run(sys, vec3(50, ROAD, 0), alongX(-6), 10, { until: (e) => e.kind === 'chaseEnded' });
    expect(kinds(events)).toEqual(['chaseStarted', 'ended:plaza']);
    const exclusion = thiefCity().hub.plazaRadius + cfg.plazaMargin;
    expect(Math.hypot(thief(sys).position.x, thief(sys).position.z)).toBeGreaterThanOrEqual(exclusion - 1e-6);
  });

  it('after a catch the courier is ignored for 20 s', () => {
    const sys = systemAt('n2');
    const { t } = run(sys, vec3(185, ROAD, 0), still, 5, { until: (e) => e.kind === 'caught' });
    expect(sys.ignoreUntil).toBeCloseTo(t + cfg.robbedCooldownSeconds, 9);
    // Keep a carrying courier 10 m from the thief: ignored until the cooldown is over, chased right after
    let now = t;
    let started: number | null = null;
    while (started === null && now < t + 30) {
      now += DT;
      const p = thief(sys).position;
      if (sys.step(DT, now, courierAt(vec3(p.x + 10, ROAD, p.z)), always).some((e) => e.kind === 'chaseStarted')) started = now;
    }
    expect(started).not.toBeNull();
    expect(started!).toBeGreaterThanOrEqual(sys.ignoreUntil);
    expect(started! - sys.ignoreUntil).toBeLessThan(2 * DT);
  });

  it('property: over 5 simulated minutes of random patrol and chases (seeded), every thief position stays on the street strips and outside the plaza', () => {
    const city = thiefCity(['n0', 'n2', 'n4', 'c1', 'c2', 'r3'].map((node, i) => ({ id: `th-${i}`, node, district: 'downtown' as const })));
    const sys = new ThiefSystem(city, cfg, mulberry32(42));
    const rng = mulberry32(7);
    const pos = new Map(city.streets.nodes.map((n) => [n.id, n.p]));
    const strips = city.streets.edges.map((e) => ({ a: pos.get(e.a)!, b: pos.get(e.b)!, hw: e.halfWidth }));
    const flat = (v: Vec3): Vec3 => vec3(v.x, 0, v.z);
    const onStreets = (p: Vec3): boolean => strips.some((s) => closestOnSegment(flat(p), flat(s.a), flat(s.b)).dist <= s.hw + 1e-6);
    const exclusion = city.hub.plazaRadius + cfg.plazaMargin;

    // The courier runs short legs, on and off the streets, sometimes up on a roof; half of the legs start next to a
    // thief (the courier appears there), so chases and their every ending keep happening
    let courier = vec3(100, ROAD, 0);
    let target = courier;
    let speed = 6;
    const counts: Record<string, number> = {};
    const bad: string[] = [];
    const around = (c: Vec3, r: number, y: number): Vec3 => vec3(c.x - r + rng() * 2 * r, y, c.z - r + rng() * 2 * r);
    for (let i = 1; i <= 5 * 60 * movementConfig.tickRate; i++) {
      if (hDist(courier, target) < 1) {
        const y = rng() < 0.2 ? 4 : ROAD;
        if (rng() < 0.5) courier = around(sys.thieves[Math.floor(rng() * sys.thieves.length)]!.position, 16, y);
        target = around(courier, 40, y);
        speed = 4 + rng() * 5;
      }
      const d = hDist(courier, target);
      const k = Math.min(1, (speed * DT) / d);
      courier = vec3(courier.x + (target.x - courier.x) * k, target.y, courier.z + (target.z - courier.z) * k);
      const events = sys.step(DT, i * DT, courierAt(courier, rng() < 0.9 ? 1 : 0), () => rng() < 0.8);
      for (const e of events) {
        const key = e.kind === 'chaseEnded' ? `ended:${e.reason}` : e.kind;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      for (const th of sys.thieves) {
        if (!onStreets(th.position)) bad.push(`${th.id} off the streets at tick ${i}: ${JSON.stringify(th.position)}`);
        if (Math.hypot(th.position.x, th.position.z) < exclusion - 1e-6) bad.push(`${th.id} in the plaza at tick ${i}`);
      }
      if (sys.thieves.filter((th) => th.mode === 'chase').length > 1) bad.push(`two chasers at tick ${i}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(counts.chaseStarted ?? 0).toBeGreaterThanOrEqual(15);
    expect(counts.caught ?? 0).toBeGreaterThan(0);
    expect(Object.keys(counts).filter((k) => k.startsWith('ended:')).length).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic for a seed', () => {
    const trace = (): string => {
      const sys = new ThiefSystem(thiefCity([{ id: 'a', node: 'n3', district: 'downtown' }]), cfg, mulberry32(9));
      for (let i = 1; i <= 900; i++) sys.step(DT, i * DT, courierAt(vec3(0, 0, 0), 0), always);
      return JSON.stringify(sys.thieves);
    };
    expect(trace()).toBe(trace());
  });
});
