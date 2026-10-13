import { describe, expect, it } from 'vitest';
import { movementConfig, thievesConfig } from '../../src/config';
import { closestOnSegment, vec3, type Vec3 } from '../../src/math/vec3';
import { ThiefSystem } from '../../src/thieves/ThiefSystem';
import type { CourierInfo, ThiefEvent, ThiefState } from '../../src/thieves/types';
import { mulberry32 } from '../../src/util/rng';
import { StreetGraph } from '../../src/world/streets';
import { levelsCity, slopesCity, thiefCity } from '../world/fixtures';

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
  opts: { until?: (e: ThiefEvent) => boolean; t0?: number; los?: () => boolean; carrying?: (t: number) => number } = {},
): { events: { t: number; e: ThiefEvent }[]; courier: Vec3; t: number } {
  const events: { t: number; e: ThiefEvent }[] = [];
  let p = start;
  let t = opts.t0 ?? 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    t += DT;
    p = move(p, t);
    const out = sys.step(DT, t, courierAt(p, opts.carrying?.(t) ?? 1), opts.los ?? always);
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

  it("a courier who climbs 3 m above the street during a chase can't be caught and the thief gives up after 1 s", () => {
    const sys = systemAt('n2');
    // Seen on the street on the first tick, up on a ledge from the second
    const climb = (p: Vec3, t: number): Vec3 => (t > 1.5 * DT ? vec3(186, 3, 0) : p);
    const { events } = run(sys, vec3(186, ROAD, 0), climb, 5, { until: (e) => e.kind === 'chaseEnded' });
    expect(kinds(events)).toEqual(['chaseStarted', 'ended:above']);
    const [started, ended] = events;
    expect(ended!.t - started!.t).toBeCloseTo(cfg.aboveGiveUpSeconds, 1);
    // It got right under the courier and still did not catch
    expect(hDist(thief(sys).position, vec3(186, 0, 0))).toBeLessThan(cfg.catchRadius);
  });

  it('a courier standing 3 m above the street within 15 m in sight is not chased (no chaseStarted over 5 s)', () => {
    const sys = systemAt('n2');
    // Follows the patrolling thief 6 m ahead, on a ledge 3 m up (R26)
    const ahead = (): Vec3 => vec3(thief(sys).position.x + 6, 3, thief(sys).position.z);
    const { events } = run(sys, ahead(), ahead, 5);
    expect(events).toEqual([]);
    expect(thief(sys).mode).toBe('patrol');
  });

  it('a courier who delivers mid-chase (carrying → 0) ends the chase with reason empty and is never caught', () => {
    const sys = systemAt('n2');
    // Caught within about a second if still carrying; delivers at 0.5 s
    const { events } = run(sys, vec3(186, ROAD, 0), still, 5, { carrying: (t) => (t < 0.5 ? 1 : 0) });
    expect(kinds(events)).toEqual(['chaseStarted', 'ended:empty']);
    expect(events[1]!.t).toBeCloseTo(0.5, 1);
    expect(thief(sys).mode).not.toBe('chase');
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
    // A thief's height changes only along its street: per tick at most the steepest slope times the fastest step
    const maxDy = new StreetGraph(city.streets, city.hub, cfg.plazaMargin).maxSlope * cfg.chaseSpeed * DT + 1e-6;
    let lastY = sys.thieves.map((th) => th.position.y);

    // The courier runs short legs, on and off the streets, sometimes up on a roof, sometimes with nothing to carry; half
    // of the legs start next to a thief (the courier appears there), so chases and their endings keep happening
    let courier = vec3(100, ROAD, 0);
    let target = courier;
    let speed = 6;
    let carrying = 1;
    const counts: Record<string, number> = {};
    const bad: string[] = [];
    const around = (c: Vec3, r: number, y: number): Vec3 => vec3(c.x - r + rng() * 2 * r, y, c.z - r + rng() * 2 * r);
    for (let i = 1; i <= 5 * 60 * movementConfig.tickRate; i++) {
      if (hDist(courier, target) < 1) {
        const y = rng() < 0.2 ? 4 : ROAD;
        if (rng() < 0.5) courier = around(sys.thieves[Math.floor(rng() * sys.thieves.length)]!.position, 16, y);
        target = around(courier, 25, y);
        speed = 4 + rng() * 5;
        carrying = rng() < 0.9 ? 1 : 0;
      }
      const d = hDist(courier, target);
      const k = Math.min(1, (speed * DT) / d);
      courier = vec3(courier.x + (target.x - courier.x) * k, target.y, courier.z + (target.z - courier.z) * k);
      const events = sys.step(DT, i * DT, courierAt(courier, carrying), () => rng() < 0.8);
      for (const e of events) {
        const key = e.kind === 'chaseEnded' ? `ended:${e.reason}` : e.kind;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      for (const th of sys.thieves) {
        if (!onStreets(th.position)) bad.push(`${th.id} off the streets at tick ${i}: ${JSON.stringify(th.position)}`);
        if (Math.hypot(th.position.x, th.position.z) < exclusion - 1e-6) bad.push(`${th.id} in the plaza at tick ${i}`);
      }
      sys.thieves.forEach((th, k) => {
        if (Math.abs(th.position.y - lastY[k]!) > maxDy) bad.push(`${th.id} changed height by ${th.position.y - lastY[k]!} at tick ${i}`);
      });
      lastY = sys.thieves.map((th) => th.position.y);
      if (sys.thieves.filter((th) => th.mode === 'chase').length > 1) bad.push(`two chasers at tick ${i}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(counts.chaseStarted ?? 0).toBeGreaterThanOrEqual(20);
    expect(counts.caught ?? 0).toBeGreaterThan(0);
    expect(Object.keys(counts).filter((k) => k.startsWith('ended:')).length).toBeGreaterThanOrEqual(4);
  });

  it('a thief chasing a courier who steps up onto a street beside it (not joined to its own) stays on its own level', () => {
    const sys = new ThiefSystem(levelsCity([{ id: 'low', node: 'L0', district: 'downtown' }]), cfg, mulberry32(1));
    // Seen on the lower street, then up on the upper street beside it (z 12.1, y 6), walking along it: at street level
    // there (R27), so the chase goes on, but no street joins the two, so the thief keeps to its own until the timeout
    const step = (p: Vec3, t: number): Vec3 => (t > 1.5 * DT ? vec3(p.x + 3 * DT, 6, 12.1) : p);
    const ys = new Set<number>();
    const events: ThiefEvent[] = [];
    let p = vec3(104, ROAD, 5);
    for (let i = 1; i <= 12 * 30; i++) {
      p = step(p, i * DT);
      events.push(...sys.step(DT, i * DT, courierAt(p), always));
      ys.add(thief(sys).position.y);
    }
    expect(kinds(events.map((e) => ({ e })))).toEqual(['chaseStarted', 'ended:timeout']);
    expect([...ys]).toEqual([0]);
  });

  it('a thief on an upper street chasing a courier below never drops off it, and never catches', () => {
    const sys = new ThiefSystem(levelsCity([{ id: 'high', node: 'U0', district: 'downtown' }]), cfg, mulberry32(1));
    const ys = new Set<number>();
    const events: ThiefEvent[] = [];
    for (let i = 1; i <= 15 * 30; i++) {
      // On the lower street, 2 m to the side of and below the thief
      const th = thief(sys).position;
      events.push(...sys.step(DT, i * DT, courierAt(vec3(Math.min(th.x + 2, 170), ROAD, 0)), always));
      ys.add(thief(sys).position.y);
    }
    expect(kinds(events.map((e) => ({ e })))).toEqual(['chaseStarted', 'ended:timeout']);
    expect([...ys]).toEqual([6]);
  });

  it('a thief running along the lower street under a bridge stays under it', () => {
    const sys = new ThiefSystem(levelsCity([{ id: 'low', node: 'L1', district: 'downtown' }]), cfg, mulberry32(1));
    const ys = new Set<number>();
    const xs: number[] = [];
    // The courier runs beside the street (z 8), so the thief keeps to the strip's side (z 6) right under the bridge
    let p = vec3(186, ROAD, 8);
    for (let i = 1; i <= 6 * 30; i++) {
      p = vec3(p.x + 7.5 * DT, ROAD, 8);
      sys.step(DT, i * DT, courierAt(p), always);
      ys.add(thief(sys).position.y);
      xs.push(thief(sys).position.x);
    }
    expect(Math.min(...xs)).toBeLessThan(199);
    expect(Math.max(...xs)).toBeGreaterThan(210);
    expect([...ys]).toEqual([0]);
  });

  it('after a catch the thief returns at returnSpeed to the near end of its street, then patrols at patrolSpeed', () => {
    const sys = systemAt('n2');
    run(sys, vec3(185, ROAD, 0), still, 5, { until: (e) => e.kind === 'caught' });
    expect(thief(sys)).toMatchObject({ mode: 'return', route: ['n2'], speed: cfg.returnSpeed });
    const steps: { mode: string; d: number }[] = [];
    for (let i = 0; i < 90; i++) {
      const before = { ...thief(sys).position };
      sys.step(DT, 100 + i * DT, courierAt(vec3(0, 0, 0), 0), always);
      steps.push({ mode: thief(sys).mode, d: Math.hypot(thief(sys).position.x - before.x, thief(sys).position.z - before.z) });
    }
    const back = steps.filter((s) => s.mode === 'return');
    const patrol = steps.slice(back.length + 1);
    expect(back.length).toBeGreaterThan(20);
    for (const s of back) expect(s.d).toBeCloseTo(cfg.returnSpeed * DT, 6);
    expect(patrol.length).toBeGreaterThan(20);
    for (const s of patrol) expect(s.d).toBeCloseTo(cfg.patrolSpeed * DT, 6);
  });

  describe('follows sloped streets across junctions and catches a courier up (or down) them', () => {
    /** Places the one thief at `at` (heading for `next`) and runs a static courier until caught or the chase ends. */
    const chaseFrom = (city: ReturnType<typeof thiefCity>, at: Vec3, next: string, courier: Vec3): string[] => {
      const sys = new ThiefSystem(city, cfg, mulberry32(1));
      Object.assign(thief(sys), { position: at, route: [next] });
      const maxDy = new StreetGraph(city.streets, city.hub, cfg.plazaMargin).maxSlope * cfg.chaseSpeed * DT + 1e-6;
      let lastY = at.y;
      const { events } = run(sys, courier, (p: Vec3) => {
        expect(Math.abs(thief(sys).position.y - lastY)).toBeLessThanOrEqual(maxDy);
        lastY = thief(sys).position.y;
        return p;
      }, 12, { until: (e) => e.kind !== 'chaseStarted' });
      return kinds(events);
    };
    const one = (node: string) => [{ id: 'th', node, district: 'downtown' as const }];
    const ramp = (z: number): Vec3 => vec3(420, (5 * z) / 60, z);

    it('L-junction: the ramp leaves the main street at n6; from the node and from along the street, beside it', () => {
      expect(chaseFrom(thiefCity(one('n5')), vec3(420, 0, 0), 'n5', ramp(8))).toEqual(['chaseStarted', 'caught']);
      expect(chaseFrom(thiefCity(one('n5')), vec3(420, 0, 0), 'n5', vec3(420, ramp(12).y, 12))).toEqual(['chaseStarted', 'caught']);
      // Coming along the main street toward a courier up the ramp: it reaches the street's side before the junction
      expect(chaseFrom(thiefCity(one('n5')), vec3(408, 0, 0), 'n6', vec3(418, ramp(8).y, 8))).toEqual(['chaseStarted', 'caught']);
    });

    // A courier more than catchHeight above the thief is not chased (R26), so on these slopes the courier stands within
    // that height: beyond the end cap of the thief's edge (halfWidth 6 m past the node), where the thief used to stall
    it('a straight slope split in two edges, uphill and downhill', () => {
      expect(chaseFrom(slopesCity(one('S0')), vec3(200, 20, 0), 'S1', vec3(207.5, 21.5, 0))).toEqual(['chaseStarted', 'caught']);
      expect(chaseFrom(slopesCity(one('S0')), vec3(200, 20, 0), 'S0', vec3(192.5, 18.5, 0))).toEqual(['chaseStarted', 'caught']);
    });

    it('a flat street running on into a ramp: down off the flat top onto the ramp', () => {
      expect(chaseFrom(slopesCity(one('F0')), vec3(204, 15, 60), 'F3', vec3(192, 12.6, 59))).toEqual(['chaseStarted', 'caught']);
    });

    it('a flat street running on into a ramp: up from the foot after a courier 3 m ahead, on the ramp surface', () => {
      const city = slopesCity(one('F0'));
      const surface = (x: number): number => (x < 150 ? 0 : x < 200 ? 0.3 * (x - 150) : 15);
      const sys = new ThiefSystem(city, cfg, mulberry32(1));
      Object.assign(thief(sys), { position: vec3(146, 0, 60), route: ['F1'] });
      for (let i = 1; i <= 60; i++) {
        const x = thief(sys).position.x + 3;
        expect(sys.step(DT, i * DT, courierAt(vec3(x, surface(x), 60)), always).filter((e) => e.kind !== 'chaseStarted')).toEqual([]);
        expect(thief(sys).position.y).toBeCloseTo(surface(thief(sys).position.x), 1);
      }
      expect(thief(sys).mode).toBe('chase');
      expect(thief(sys).position.x).toBeGreaterThan(156 + 3);
    });
  });

  describe('above street level is measured against the street under the courier (R27)', () => {
    const one = (node: string) => [{ id: 'th', node, district: 'downtown' as const }];

    it('a courier running up a 0.4 hillside ramp ahead of the thief is still chased (no above end, no R26 suppression)', () => {
      const sys = new ThiefSystem(slopesCity(one('G0')), cfg, mulberry32(1));
      Object.assign(thief(sys), { position: vec3(146, 0, 120), route: ['G1'] });
      // 9 m ahead, 2 m up the ramp: more than catchHeight above the thief, but on the street
      const up = (x: number): Vec3 => vec3(x, 0.4 * (x - 150), 120);
      expect(up(155).y - thief(sys).position.y).toBeGreaterThan(cfg.catchHeight);
      const { events } = run(sys, up(155), (p) => up(p.x + movementConfig.run.runSpeed * DT), 12, { until: (e) => e.kind !== 'chaseStarted' });
      expect(kinds(events)).toEqual(['chaseStarted', 'caught']);
    });

    it("a courier on a terrace street above the thief's street is chased via the streets", () => {
      const sys = new ThiefSystem(slopesCity(one('T0')), cfg, mulberry32(1));
      Object.assign(thief(sys), { position: vec3(180, 0, 198), route: ['T1'] });
      const maxDy = new StreetGraph(slopesCity().streets, slopesCity().hub, cfg.plazaMargin).maxSlope * cfg.chaseSpeed * DT + 1e-6;
      let lastY = 0;
      let maxX = 0;
      // On the terrace street, 4 m above and 14 m across from the thief, standing still
      const { events } = run(sys, vec3(180, 4, 212), (p) => {
        expect(Math.abs(thief(sys).position.y - lastY)).toBeLessThanOrEqual(maxDy);
        lastY = thief(sys).position.y;
        maxX = Math.max(maxX, thief(sys).position.x);
        return p;
      }, 12, { until: (e) => e.kind !== 'chaseStarted' });
      expect(kinds(events)).toEqual(['chaseStarted', 'caught']);
      // Round by T1 and up the ramp to T2
      expect(maxX).toBeGreaterThan(199);
    });
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
