import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  distance,
  movementConfig as cfg,
  ordersConfig,
  parsePieceCatalog,
  solidRect,
  type Rect,
  type Solid,
  type Vec3,
} from '@dm/shared';
import type { DistrictReport } from '../../src/city/district';
import { generateCityWithReport } from '../../src/city/generate';
import { parseCitySource } from '../../src/city/source';
import { cityHarness, untilLanded, yawToward, type CityHarness } from '../helpers/citySim';

// Runs PlayerSim on the generated city (real committed inputs).
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), 'utf8'));
const src = parseCitySource(readJson('map/city.source.json'));
const pieces = parsePieceCatalog(readJson('map/pieces.json'));
const { city, report } = generateCityWithReport(src, pieces);
const hill = report.districts.hillside as DistrictReport;
const { rect, params: rawParams } = src.districts.find((d) => d.district === 'hillside')!;
const params = rawParams as { houses: { pieces: string[] }; stairs: { rise: number } };

const isHill = (x: { id: string }): boolean => x.id.startsWith('hillside-');
const solids = new Map(city.solids.map((s) => [s.id, s]));
const pads = city.jumpPads.filter(isHill);
const nodes = new Map(city.streets.nodes.map((n) => [n.id, n]));
const { roadTop } = src.streets;
const MAX_FALL = ordersConfig.fragile.maxFallMeters;
/** The PlayerSim tests run many courier trips on the city. */
const SIM_TIMEOUT = 180_000;
const EPS = 1e-6;
/** A sprinting tick that covers less than this is a stall (the SP1 ground-stall rule). */
const STALL_STEP = 0.05;
const DEG = 180 / Math.PI;
const inRect = (p: Vec3, r: Rect, pad = 0): boolean =>
  p.x >= r.minX - pad && p.x <= r.maxX + pad && p.z >= r.minZ - pad && p.z <= r.maxZ + pad;
const top = (s: Solid): number => s.center.y + s.size.y / 2;
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const flat = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.z - a.z);
/** Slope of the line from `a` to `b`, degrees. */
const slopeDeg = (a: Vec3, b: Vec3): number => Math.atan2(Math.abs(b.y - a.y), flat(a, b)) * DEG;
/** How far `p` has come from `a` along the horizontal direction toward `b`. */
const along = (a: Vec3, b: Vec3, p: Vec3): number => ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / flat(a, b);
/** The surface height straight below `p` (from 2 m above it). */
const surfaceY = (h: CityHarness, p: Vec3): number => {
  const from = { ...p, y: p.y + 2 };
  const d = h.dropTo(from, 10);
  expect(d, `a surface under ${JSON.stringify(p)}`).not.toBeNull();
  return from.y - d!;
};
/** The plane height of a slab solid's top face at (x, z), honouring its XYZ rotation (x rotation only here). */
const slabTopAt = (s: Solid, z: number): number => {
  const a = ((s.rotationDeg?.x ?? 0) * Math.PI) / 180;
  // Top face normal (0, cos a, sin a) through centre + (h/2)·normal
  const c = { y: s.center.y + (s.size.y / 2) * Math.cos(a), z: s.center.z + (s.size.y / 2) * Math.sin(a) };
  return c.y - Math.tan(a) * (z - c.z);
};

let h: CityHarness;
beforeAll(async () => {
  h = await cityHarness(city);
});

describe('hillside: layout', () => {
  it('the hillside top terrace is ≥ 35 m above y = 0, and the terraces rise toward the NW corner', () => {
    expect(hill.terraces.length).toBeGreaterThan(20);
    const best = hill.terraces.reduce((a, b) => (b.top > a.top ? b : a));
    expect(best.top).toBeGreaterThanOrEqual(35);
    // The top terrace is in the NW corner cell; tops fall off toward the SE (the hub)
    expect(best.rect.minX).toBeLessThan(rect.minX + 200);
    expect(best.rect.minZ).toBeLessThan(rect.minZ + 200);
    const nw = hill.terraces.filter((t) => (t.rect.minX + t.rect.maxX) / 2 + (t.rect.minZ + t.rect.maxZ) / 2 < -1000);
    const se = hill.terraces.filter((t) => (t.rect.minX + t.rect.maxX) / 2 + (t.rect.minZ + t.rect.maxZ) / 2 >= -1000);
    const mean = (ts: typeof nw): number => ts.reduce((s, t) => s + t.top, 0) / ts.length;
    expect(mean(nw)).toBeGreaterThan(mean(se) + 5);
  });

  it('terraces are flat ground plateaus, each solid at most one chunk across', () => {
    for (const t of hill.terraces) {
      expect(t.solids.length, t.id).toBeGreaterThan(0);
      for (const id of t.solids) {
        const s = solids.get(id)!;
        expect(s, id).toBeDefined();
        expect(s.kind, id).toBe('ground');
        expect(s.rotationDeg, id).toBeUndefined();
        expect(top(s), id).toBeCloseTo(t.top, 6);
        const r = solidRect(s);
        expect(Math.max(r.maxX - r.minX, r.maxZ - r.minZ), id).toBeLessThanOrEqual(city.chunkSize + EPS);
        expect(inRect({ x: r.minX, y: 0, z: r.minZ }, t.rect, EPS) && inRect({ x: r.maxX, y: 0, z: r.maxZ }, t.rect, EPS), id).toBe(true);
      }
    }
  });

  it('steep streets climb 15–25° road ramps, below maxSlopeClimbDeg', () => {
    expect(hill.steepStreets.length).toBeGreaterThan(10);
    for (const st of hill.steepStreets) {
      expect(st.ramps.length, st.id).toBeGreaterThan(0);
      for (const r of st.ramps) {
        const s = solids.get(r.solid)!;
        expect(s.kind, r.solid).toBe('road');
        const deg = slopeDeg(r.bottom, r.top);
        expect(deg, r.solid).toBeGreaterThanOrEqual(15);
        expect(deg, r.solid).toBeLessThanOrEqual(25);
        expect(deg, r.solid).toBeLessThan(cfg.controller.maxSlopeClimbDeg);
        expect(Math.abs(s.rotationDeg!.x), r.solid).toBeCloseTo(deg, 1);
        // The slab's top face passes through both ends (no lip at the crest)
        expect(slabTopAt(s, r.top.z), `${r.solid} top`).toBeCloseTo(r.top.y, 1);
        expect(slabTopAt(s, r.bottom.z), `${r.solid} bottom`).toBeCloseTo(r.bottom.y, 1);
      }
      expect(st.to.y, st.id).toBeGreaterThan(st.from.y);
    }
  });

  it('every hillside street edge runs on its road surface (y interpolated along the edge), sloped edges on the ramps', () => {
    // Hillside's own edges (the arterials it joins are the core's, at y = 0)
    const edges = city.streets.edges.filter((e) => e.a.startsWith('hillside-') && e.b.startsWith('hillside-'));
    expect(edges.length).toBeGreaterThan(50);
    const sloped = edges.filter((e) => Math.abs(nodes.get(e.a)!.p.y - nodes.get(e.b)!.p.y) > EPS);
    expect(sloped.length).toBe(hill.steepStreets.reduce((n, s) => n + s.ramps.length, 0));
    for (const e of edges) {
      const [a, b] = [nodes.get(e.a)!.p, nodes.get(e.b)!.p];
      const len = flat(a, b);
      for (let s = 0; s <= len; s += 1) {
        const p = lerp(a, b, s / len);
        expect(surfaceY(h, p) - p.y, `${e.a}-${e.b} at ${s.toFixed(0)} m`).toBeCloseTo(roadTop, 1);
      }
    }
    expect(Math.max(...[...nodes.values()].filter(isHill).map((n) => n.p.y))).toBeGreaterThanOrEqual(35);
  });

  it('stairs rise 0.3 m per step', () => {
    expect(hill.stairRuns.length).toBeGreaterThan(10);
    expect(params.stairs.rise).toBe(0.3);
    for (const run of hill.stairRuns) {
      const steps = run.steps.map((id) => solids.get(id)!);
      expect(steps.every((s) => s && s.kind === 'stairs'), run.id).toBe(true);
      const tops = [run.from.y, ...steps.map(top)];
      for (let k = 1; k < tops.length; k++) expect(tops[k]! - tops[k - 1]!, `${run.id} step ${k}`).toBeCloseTo(0.3, 2);
      // The last step is level with the terrace above (the sidewalk curb above it is under maxStepHeight)
      expect(run.to.y - tops[tops.length - 1]!, run.id).toBeGreaterThanOrEqual(-EPS);
      expect(run.to.y - tops[tops.length - 1]!, run.id).toBeLessThanOrEqual(cfg.controller.maxStepHeight);
      for (const s of steps) expect(Math.min(s.size.x, s.size.z), s.id).toBeGreaterThanOrEqual(cfg.controller.minStepWidth);
    }
  });

  it('≥ 3 long chutes, each 100–300 m, in ≤ 100 m segments laid end to end without lips', () => {
    expect(hill.chutes.length).toBeGreaterThanOrEqual(3);
    for (const c of hill.chutes) {
      const len = distance(c.start, c.end);
      expect(len, c.id).toBeGreaterThanOrEqual(100);
      expect(len, c.id).toBeLessThanOrEqual(300);
      const deg = slopeDeg(c.start, c.end);
      expect(deg, c.id).toBeLessThan(cfg.controller.minSlopeSlideDeg);
      // Steep enough that slope gravity beats chute friction (the slide keeps its speed)
      const a = deg / DEG;
      expect(cfg.gravity * Math.sin(a) * Math.cos(a) ** 2, c.id).toBeGreaterThan(cfg.chute.friction);
      expect(c.end.y, c.id).toBeLessThan(c.start.y);
      const segs = c.segments.map((id) => solids.get(id)!);
      expect(segs.length, c.id).toBeGreaterThan(1);
      for (const s of segs) {
        expect(s.kind, s.id).toBe('chute');
        const r = solidRect(s);
        expect(Math.max(r.maxX - r.minX, r.maxZ - r.minZ), s.id).toBeLessThanOrEqual(100);
      }
      // Every segment's top face lies on the chute's line (so consecutive faces meet without a lip)
      for (const s of segs) {
        const r = solidRect(s);
        for (const z of [Math.max(r.minZ, Math.min(c.start.z, c.end.z)), Math.min(r.maxZ, Math.max(c.start.z, c.end.z))]) {
          const t = (z - c.start.z) / (c.end.z - c.start.z);
          expect(Math.abs(slabTopAt(s, z) - lerp(c.start, c.end, t).y), `${s.id} at z ${z.toFixed(2)}`).toBeLessThanOrEqual(0.02);
        }
      }
    }
  });

  it('houses: gable and round pieces (and other small ones) at prop scale 1, standing on the terraces', () => {
    const houses = city.props.filter(isHill);
    expect(houses.length).toBeGreaterThan(150);
    const gableOrRound = houses.filter((p) => /-(gable|round)roof$/.test(p.piece));
    expect(gableOrRound.length / houses.length).toBeGreaterThan(0.4);
    const levels = new Set([0, ...hill.terraces.map((t) => t.top)]);
    for (const p of houses) {
      expect(p.scale, p.id).toBe(1);
      expect(params.houses.pieces, p.id).toContain(p.piece);
      expect(levels.has(p.position.y), `${p.id} at y ${p.position.y}`).toBe(true);
      const under = hill.terraces.find((t) => inRect(p.position, t.rect));
      expect(under?.top ?? 0, `${p.id} stands on its terrace`).toBe(p.position.y);
    }
  });

  it('every uphill pad has its navigation link and a target on a higher terrace, its apex ≤ 7 m above the target', () => {
    const links = new Map(city.navLinks.map((l) => [l.id, l]));
    expect(pads.length).toBeGreaterThan(10);
    const targets = new Map(hill.padTargets.map((t) => [t.pad, t]));
    for (const pad of pads) {
      const t = targets.get(pad.id)!;
      expect(t, pad.id).toBeDefined();
      expect(t.target.y, pad.id).toBeGreaterThan(pad.position.y + 2);
      expect(links.get(`${pad.id}-nav`), pad.id).toMatchObject({ kind: 'pad', from: pad.position, bidirectional: false });
      const apex = pad.position.y + (pad.launch.y * pad.launch.y) / (2 * cfg.gravity);
      expect(apex - t.target.y, pad.id).toBeLessThanOrEqual(MAX_FALL);
    }
  });
});

describe('hillside: chutes', () => {
  it('every hillside chute slides start to end without stopping (mode slide until the end, speed ≥ endSpeed)', () => {
    for (const c of hill.chutes) {
      const len = flat(c.start, c.end);
      const yaw = yawToward(c.end.x - c.start.x, c.end.z - c.start.z);
      // Standing on the top terrace 1 m before the chute's top end, then walking onto it until it takes over
      const before = lerp(c.start, c.end, -1 / len);
      h.spawnAt({ ...before, y: surfaceY(h, before) + 0.02 }, yaw);
      expect(h.sim.state.grounded && h.sim.state.mode === 'ground', `${c.id}: standing above the chute`).toBe(true);
      for (let i = 0; h.sim.state.mode !== 'slide'; i++) {
        h.tick({ forward: 1, yaw });
        expect(i, `${c.id}: the chute takes over`).toBeLessThan(cfg.tickRate);
      }
      // The end: where the feet come within a capsule radius of the chute's foot (the ground beyond takes over there)
      const endAt = len - cfg.capsule.radius;
      for (let ticks = 1; ; ticks++) {
        const events = h.tick();
        expect(events.filter((e) => e.kind === 'respawned'), `${c.id}: respawned`).toEqual([]);
        const s = h.sim.state;
        if (along(c.start, c.end, s.position) >= endAt) break;
        expect(s.mode, `${c.id}: mode at ${along(c.start, c.end, s.position).toFixed(1)} m`).toBe('slide');
        expect(ticks, `${c.id}: reaches the end`).toBeLessThan(60 * cfg.tickRate);
      }
      const v = h.sim.state.velocity;
      expect(Math.hypot(v.x, v.z), `${c.id}: speed at the end`).toBeGreaterThanOrEqual(cfg.slide.endSpeed);
    }
  }, SIM_TIMEOUT);
});

describe('hillside: steep streets', () => {
  it('every steep street can be sprinted up (no stall; reaches the top terrace)', () => {
    for (const st of hill.steepStreets) {
      const len = flat(st.from, st.to);
      const yaw = yawToward(st.to.x - st.from.x, st.to.z - st.from.z);
      h.spawnAt({ ...st.from, y: st.from.y + 0.02 }, yaw);
      expect(h.sim.state.grounded, `${st.id}: standing at the foot`).toBe(true);
      let ticks = 0;
      let stalls = 0;
      while (along(st.from, st.to, h.sim.state.position) < len) {
        const before = h.sim.state.position;
        const events = h.tick({ forward: 1, sprint: true, yaw });
        expect(events.filter((e) => e.kind === 'respawned'), `${st.id}: respawned`).toEqual([]);
        const p = h.sim.state.position;
        if (ticks > 10 && Math.hypot(p.x - before.x, p.z - before.z) < STALL_STEP) stalls++;
        expect(++ticks, `${st.id}: reaches the top (at ${JSON.stringify(p)})`).toBeLessThan(len / 4 * cfg.tickRate);
      }
      expect(stalls, `${st.id}: stalled ticks`).toBe(0);
      h.run(10);
      const s = h.sim.state;
      expect(s.grounded && s.mode === 'ground', `${st.id}: standing at the top`).toBe(true);
      expect(Math.abs(s.position.y - st.to.y), `${st.id}: on the top terrace street`).toBeLessThanOrEqual(0.05);
    }
  }, SIM_TIMEOUT);
});

describe('hillside: stairs', () => {
  it('every stair run can be walked up', () => {
    for (const run of hill.stairRuns) {
      const len = flat(run.from, run.to);
      const yaw = yawToward(run.to.x - run.from.x, run.to.z - run.from.z);
      h.spawnAt({ ...run.from, y: run.from.y + 0.02 }, yaw);
      expect(h.sim.state.grounded, `${run.id}: standing at the foot`).toBe(true);
      let ticks = 0;
      while (along(run.from, run.to, h.sim.state.position) < len) {
        const events = h.tick({ forward: 1, yaw });
        expect(events.filter((e) => e.kind === 'respawned'), `${run.id}: respawned`).toEqual([]);
        expect(++ticks, `${run.id}: reaches the top (at ${JSON.stringify(h.sim.state.position)})`).toBeLessThan((len / 2) * cfg.tickRate);
      }
      h.run(10);
      const s = h.sim.state;
      expect(s.grounded && s.mode === 'ground', `${run.id}: standing at the top`).toBe(true);
      expect(Math.abs(s.position.y - run.to.y), `${run.id}: on the terrace above`).toBeLessThanOrEqual(0.05);
    }
  }, SIM_TIMEOUT);
});

describe('hillside: pads', () => {
  it('every uphill pad lands on its terrace', () => {
    const targets = new Map(hill.padTargets.map((t) => [t.pad, t]));
    for (const pad of pads) {
      const t = targets.get(pad.id)!;
      // Standing on the pad launches the courier at once (during spawnAt's settling ticks)
      h.spawnAt(pad.position, yawToward(pad.launch.x, pad.launch.z));
      expect(h.sim.state.padCooldown[pad.id] ?? 0, `${pad.id} launched`).toBeGreaterThan(0);
      const { fall, at } = untilLanded(h, pad.id, {}, 10 * cfg.tickRate, true);
      expect(h.sim.state.grounded, `${pad.id} grounded`).toBe(true);
      expect(distance(at, t.target), `${pad.id} lands at ${at.x.toFixed(2)}, ${at.y.toFixed(2)}, ${at.z.toFixed(2)}`).toBeLessThanOrEqual(1.5);
      expect(inRect(h.sim.state.position, t.landing), `${pad.id} on its terrace`).toBe(true);
      expect(fall, `${pad.id} fall`).toBeLessThanOrEqual(MAX_FALL);
    }
  }, SIM_TIMEOUT);
});
