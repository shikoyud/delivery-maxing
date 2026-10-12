import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bandFor,
  distance,
  movementConfig as cfg,
  mulberry32,
  OrderSystem,
  ordersConfig,
  parsePieceCatalog,
  solidRect,
  streetDistance,
  type Order,
  type Rect,
  type RotY,
  type Solid,
  type Vec3,
} from '@dm/shared';
import type { DistrictReport, QuayEdge } from '../../src/city/district';
import { generateCityWithReport } from '../../src/city/generate';
import { parseCitySource } from '../../src/city/source';
import { cityHarness, rideZip, untilLanded, yawToward, type CityHarness } from '../helpers/citySim';

// Runs PlayerSim on the generated city (real committed inputs).
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), 'utf8'));
const src = parseCitySource(readJson('map/city.source.json'));
const pieces = parsePieceCatalog(readJson('map/pieces.json'));
const { city, report } = generateCityWithReport(src, pieces);
const harbor = report.districts.harbor as DistrictReport;
const { rect, params: rawParams } = src.districts.find((d) => d.district === 'harbor')!;
const params = rawParams as { stepRise: number };

const isHarbor = (x: { id: string }): boolean => x.id.startsWith('harbor-');
const solids = new Map(city.solids.map((s) => [s.id, s]));
const pads = city.jumpPads.filter(isHarbor);
const zips = city.zipLines.filter(isHarbor);
const checkpoints = new Map(city.checkpoints.map((c) => [c.id, c]));
const MAX_FALL = ordersConfig.fragile.maxFallMeters;
/** The PlayerSim tests run many courier trips on the city. */
const SIM_TIMEOUT = 120_000;
const EPS = 1e-6;
const inRect = (p: Vec3, r: Rect, pad = 0): boolean =>
  p.x >= r.minX - pad && p.x <= r.maxX + pad && p.z >= r.minZ - pad && p.z <= r.maxZ + pad;
const top = (s: Solid): number => s.center.y + s.size.y / 2;
/** The horizontal unit vector a climb facing `dir` runs along (+z turned by dir). */
const climbDir = (dir: RotY): { x: number; z: number } =>
  ({ 0: { x: 0, z: 1 }, 90: { x: 1, z: 0 }, 180: { x: 0, z: -1 }, 270: { x: -1, z: 0 } })[dir];
/** Along-quay coordinate of a point, and its distance inland of the quay line. */
const along = (q: QuayEdge, p: Vec3): number => (q.across === 'x' ? p.z : p.x);
const inland = (q: QuayEdge, p: Vec3): number => q.out * (q.line - (q.across === 'x' ? p.x : p.z));

let h: CityHarness;
beforeAll(async () => {
  h = await cityHarness(city);
});

describe('harbor: layout', () => {
  it('has quays along the east and south water edges, with checkpoints every ≤ 150 m along each', () => {
    expect(harbor.quay.quays.map((q) => q.edge).sort()).toEqual(['east', 'south']);
    for (const q of harbor.quay.quays) {
      expect(q.line).toBe(1000 - src.boundary.quayInset);
      const cps = harbor.quay.checkpoints
        .map((id) => checkpoints.get(id)!)
        .filter((c) => Math.abs(inland(q, c.position)) < 30)
        .map((c) => along(q, c.position))
        .sort((a, b) => a - b);
      expect(cps.length, q.edge).toBeGreaterThan(0);
      const gaps = [cps[0]! - q.from, ...cps.slice(1).map((a, k) => a - cps[k]!), q.to - cps[cps.length - 1]!];
      expect(gaps[0]!, `${q.edge} first`).toBeLessThanOrEqual(75);
      expect(gaps[gaps.length - 1]!, `${q.edge} last`).toBeLessThanOrEqual(75);
      for (const g of gaps) expect(g, q.edge).toBeLessThanOrEqual(150);
    }
    // Each stands on open ground
    for (const id of harbor.quay.checkpoints) {
      const c = checkpoints.get(id)!;
      expect(h.dropTo({ ...c.position, y: c.position.y + 1 }, 2), id).toBeCloseTo(1, 2);
    }
  });

  it('no ground solid lies beyond the quay line', () => {
    const [east, south] = ['east', 'south'].map((e) => harbor.quay.quays.find((q) => q.edge === e)!.line);
    const quadrant = city.solids.filter((s) => inRect(s.center, rect));
    expect(quadrant.length).toBeGreaterThan(1000);
    for (const s of quadrant) {
      const r = solidRect(s);
      expect(r.maxX, s.id).toBeLessThanOrEqual(east! + EPS);
      expect(r.maxZ, s.id).toBeLessThanOrEqual(south! + EPS);
    }
    const points: [string, Vec3][] = [
      ...pads.map((p): [string, Vec3] => [p.id, p.position]),
      ...zips.flatMap((z): [string, Vec3][] => [[`${z.id}.a`, z.a], [`${z.id}.b`, z.b]]),
      ...harbor.quay.checkpoints.map((id): [string, Vec3] => [id, checkpoints.get(id)!.position]),
      ...city.props.filter(isHarbor).map((p): [string, Vec3] => [p.id, p.position]),
    ];
    for (const [id, p] of points) {
      expect(p.x, id).toBeLessThanOrEqual(east! + EPS);
      expect(p.z, id).toBeLessThanOrEqual(south! + EPS);
    }
  });

  it('containers are 6 × 2.6 × 2.4 m boxes in stacks of 1–3, each stack with its mantle steps', () => {
    const containers = city.solids.filter((s) => s.kind === 'container');
    expect(containers.every(isHarbor)).toBe(true);
    expect(harbor.containerStacks.length).toBeGreaterThanOrEqual(20);
    const owned = new Set<string>();
    for (const st of harbor.containerStacks) {
      expect(st.tiers, st.id).toBeGreaterThanOrEqual(1);
      expect(st.tiers, st.id).toBeLessThanOrEqual(3);
      expect(st.top, st.id).toBeCloseTo(st.tiers * 2.6, 6);
      const boxes = containers.filter((c) => inRect(c.center, st.rect));
      expect(boxes.length % st.tiers, st.id).toBe(0);
      for (const c of boxes) {
        owned.add(c.id);
        expect([c.size.x, c.size.y, c.size.z].sort((a, b) => a - b), c.id).toEqual([2.4, 2.6, 6]);
      }
      expect(Math.max(...boxes.map(top)), st.id).toBeCloseTo(st.top, 6);
      expect(st.steps.length, st.id).toBeGreaterThan(0);
      const crates = st.steps.map((id) => solids.get(id)!);
      expect(crates.every((c) => c !== undefined && c.kind === 'prop'), st.id).toBe(true);
      // Each rise is within the mantle window and at most stepRise
      const rises = [...crates.map(top), st.top].map((t, k, all) => t - (k === 0 ? 0 : all[k - 1]!));
      for (const r of rises) {
        expect(r, st.id).toBeGreaterThan(cfg.mantle.minHeight);
        expect(r, st.id).toBeLessThanOrEqual(Math.min(params.stepRise, cfg.mantle.maxHeight) + EPS);
      }
    }
    expect(containers.filter((c) => !owned.has(c.id)).map((c) => c.id)).toEqual([]);
  });

  it('≥ 3 cranes, frames 30–40 m tall, each with pads up to its jib and zip lines leaving it', () => {
    expect(harbor.cranes.length).toBeGreaterThanOrEqual(3);
    for (const c of harbor.cranes) {
      const frame = city.solids.filter((s) => s.id.startsWith(`${c.id}-`));
      expect(frame.length, c.id).toBeGreaterThan(1);
      expect(frame.every((s) => s.kind === 'crane'), c.id).toBe(true);
      expect(Math.max(...frame.map(top)), c.id).toBeCloseTo(c.height, 6);
      expect(c.height, c.id).toBeGreaterThanOrEqual(30);
      expect(c.height, c.id).toBeLessThanOrEqual(40);
      expect(c.pads.length, c.id).toBeGreaterThan(0);
      expect(c.zips.length, c.id).toBeGreaterThan(0);
    }
    expect(new Set(harbor.cranes.flatMap((c) => c.pads))).toEqual(new Set(pads.map((p) => p.id)));
  });

  it('≥ 3 harbor zips are ≥ 120 m long (every one 120–300 m)', () => {
    expect(new Set(harbor.zipLines)).toEqual(new Set(zips.map((z) => z.id)));
    expect(zips.filter((z) => distance(z.a, z.b) >= 120).length).toBeGreaterThanOrEqual(3);
    for (const z of zips) {
      expect(distance(z.a, z.b), z.id).toBeGreaterThanOrEqual(120);
      expect(distance(z.a, z.b), z.id).toBeLessThanOrEqual(300);
    }
  });

  it('every pad, zip line and mantle stack has its navigation link', () => {
    const links = new Map(city.navLinks.map((l) => [l.id, l]));
    for (const pad of pads) expect(links.get(`${pad.id}-nav`), pad.id).toMatchObject({ kind: 'pad', from: pad.position, bidirectional: false });
    for (const z of zips) expect(links.get(`${z.id}-nav`), z.id).toMatchObject({ kind: 'zip', from: z.a, to: z.b, bidirectional: true });
    for (const st of harbor.containerStacks) {
      const l = links.get(`${st.id}-climb`);
      expect(l, st.id).toMatchObject({ kind: 'mantle', bidirectional: true });
      expect(l!.to.y, st.id).toBeCloseTo(st.top, 6);
    }
  });

  it('every harbor zip line clears what is below it by the hang drop', () => {
    for (const z of zips) {
      const len = distance(z.a, z.b);
      for (let s = 0; s <= len; s += 1) {
        const k = s / len;
        const c = { x: z.a.x + (z.b.x - z.a.x) * k, y: z.a.y + (z.b.y - z.a.y) * k, z: z.a.z + (z.b.z - z.a.z) * k };
        const drop = h.dropTo(c);
        expect(drop === null || drop >= cfg.zipLine.hangDrop, `${z.id} at ${s} m`).toBe(true);
      }
    }
  });
});

describe('harbor: cranes', () => {
  it('every crane pad lands its rider on its jib (feet within 1.5 m of the target, grounded, fall ≤ 7 m)', () => {
    const targets = new Map(harbor.padTargets.map((t) => [t.pad, t]));
    for (const pad of pads) {
      const t = targets.get(pad.id);
      expect(t, `${pad.id} has a target`).toBeDefined();
      // Standing on the pad launches the courier at once (during spawnAt's settling ticks)
      h.spawnAt(pad.position, yawToward(pad.launch.x, pad.launch.z));
      expect(h.sim.state.padCooldown[pad.id] ?? 0, `${pad.id} launched`).toBeGreaterThan(0);
      const { fall, at } = untilLanded(h, pad.id, {}, 10 * cfg.tickRate, true);
      expect(h.sim.state.grounded, `${pad.id} grounded`).toBe(true);
      expect(distance(at, t!.target), `${pad.id} lands at ${at.x.toFixed(2)}, ${at.y.toFixed(2)}, ${at.z.toFixed(2)}`).toBeLessThanOrEqual(1.5);
      expect(inRect(h.sim.state.position, t!.landing), `${pad.id} on its jib`).toBe(true);
      expect(fall, `${pad.id} fall`).toBeLessThanOrEqual(MAX_FALL);
    }
  }, SIM_TIMEOUT);
});

describe('harbor: zip lines', () => {
  it('every harbor zip line rides both ways and dismounts', () => {
    for (const z of zips) for (const to of ['b', 'a'] as const) rideZip(h, z, to);
  }, SIM_TIMEOUT);
});

describe('harbor: container yards', () => {
  it('every container stack top is reachable via its mantle steps (run at the steps, end on top)', () => {
    for (const st of harbor.containerStacks) {
      const d = climbDir(st.dir);
      const lowest = solids.get(st.steps[0]!)!;
      const depth = Math.abs(d.x) > 0 ? lowest.size.x : lowest.size.z;
      // Start 1 m out from the lowest crate's outer face, facing the stack
      const back = depth / 2 + 1;
      const yaw = yawToward(d.x, d.z);
      h.spawnAt({ x: lowest.center.x - d.x * back, y: 0, z: lowest.center.z - d.z * back }, yaw);
      expect(h.sim.state.grounded, `${st.id}: standing at the start`).toBe(true);
      const onTop = (): boolean => {
        const s = h.sim.state;
        return s.grounded && s.mode === 'ground' && Math.abs(s.position.y - st.top) <= 0.05 && inRect(s.position, st.rect);
      };
      for (let i = 0; i < 8 * cfg.tickRate && !onTop(); i++) {
        const events = h.tick({ forward: 1, yaw });
        expect(events.filter((e) => e.kind === 'respawned'), `${st.id}: respawned`).toEqual([]);
      }
      expect(onTop(), `${st.id}: on top at ${JSON.stringify(h.sim.state.position)}`).toBe(true);
      h.run(10);
      expect(onTop(), `${st.id}: still on top after letting go`).toBe(true);
    }
  }, SIM_TIMEOUT);
});

/** An OrderSystem with one POI whose first board order is a Fragile drop-off (searching board seeds). */
function fragileDropoff(): { orders: OrderSystem; order: Order } {
  const position = { x: 500, y: 0, z: 500 };
  const d = streetDistance(city.hub.center, position);
  const pois = [{ poi: { id: 'harbor-test-poi', position, district: 'harbor' as const, kind: 'door' as const }, hubDistance: d, band: bandFor(d, ordersConfig.bands) }];
  for (let seed = 1; seed < 1000; seed++) {
    const orders = new OrderSystem(
      {
        pois,
        distance: streetDistance,
        hub: city.hub.center,
        cfg: ordersConfig,
        baseSprintSpeed: cfg.run.sprintSpeed,
        rng: mulberry32(seed),
        unlocks: { express: true, chain: true },
        backpackCapacity: 1,
      },
      0,
    );
    const order = orders.board[0];
    if (order && order.type === 'dropoff' && order.modifier === 'fragile') return { orders, order };
  }
  throw new Error('no board seed gives a Fragile drop-off');
}

describe('harbor: water', () => {
  it('falling off the quay into the water respawns at a harbor checkpoint within 150 m and keeps packages', () => {
    let falls = 0;
    for (const q of harbor.quay.quays) {
      for (let a = q.from + 25; a < q.to; a += 50) {
        const label = `${q.edge} quay at ${a}`;
        const { orders, order } = fragileDropoff();
        expect(orders.accept(order.id, 0, true), label).toBe('ok');
        const above = q.across === 'x' ? { x: q.line - 1, y: 2, z: a } : { x: a, y: 2, z: q.line - 1 };
        const start = { ...above, y: above.y - h.dropTo(above, 3)! };
        const yaw = q.across === 'x' ? yawToward(q.out, 0) : yawToward(0, q.out);
        h.spawnAt(start, yaw);
        expect(h.sim.state.grounded, `${label}: standing on the quay`).toBe(true);
        let respawn: string | null = null;
        const broken: string[] = [];
        for (let i = 0; i < 4 * cfg.tickRate && !respawn; i++) {
          const events = h.tick({ forward: 1, yaw });
          for (const e of orders.onSimEvents(events)) if (e.kind === 'fragileBroken') broken.push(e.reason);
          for (const e of events) if (e.kind === 'respawned') respawn = e.checkpointId;
        }
        expect(respawn, `${label}: respawned`).not.toBeNull();
        expect(harbor.quay.checkpoints, `${label}: at a harbor quay checkpoint`).toContain(respawn);
        const cp = checkpoints.get(respawn!)!;
        expect(Math.hypot(cp.position.x - start.x, cp.position.z - start.z), label).toBeLessThanOrEqual(150);
        expect(distance(h.sim.state.position, cp.position), `${label}: at the checkpoint`).toBeLessThan(0.1);
        // The package is still carried; only the Fragile bonus is lost
        expect(orders.active.map((x) => x.order.id), label).toEqual([order.id]);
        expect(orders.isCarried(orders.active[0]!), label).toBe(true);
        expect(orders.active[0]!.fragileIntact, label).toBe(false);
        expect(broken, label).toEqual(['respawn']);
        falls++;
      }
    }
    expect(falls).toBeGreaterThanOrEqual(30);
  }, SIM_TIMEOUT);
});
