import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  distance,
  jumpVelocity,
  movementConfig as cfg,
  NO_MODS,
  parsePieceCatalog,
  solidRect,
  type Rail,
  type Rect,
  type Solid,
  type Vec3,
} from '@dm/shared';
import type { DistrictReport, QuayEdge, RampReport, RailReport } from '../../src/city/district';
import { generateCityWithReport } from '../../src/city/generate';
import { parseCitySource } from '../../src/city/source';
import { cityHarness, untilLanded, yawToward, type CityHarness, type Hold } from '../helpers/citySim';

// Runs PlayerSim on the generated city (real committed inputs).
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), 'utf8'));
const src = parseCitySource(readJson('map/city.source.json'));
const pieces = parsePieceCatalog(readJson('map/pieces.json'));
const { city, report } = generateCityWithReport(src, pieces);
const sub = report.districts.suburbs as DistrictReport;
const { rect, params: rawParams } = src.districts.find((d) => d.district === 'suburbs')!;
const params = rawParams as {
  streetHalfWidth: number;
  houses: { pieces: string[]; setback: number };
  rails: { height: number };
  skatepark: { runUp: number };
};

const isSub = (x: { id: string }): boolean => x.id.startsWith('suburbs-');
const solids = new Map(city.solids.map((s) => [s.id, s]));
const rails = new Map(city.rails.map((r) => [r.id, r]));
const checkpoints = new Map(city.checkpoints.map((c) => [c.id, c]));
const { sidewalkTop } = src.streets;
/** The PlayerSim tests run many courier trips on the city. */
const SIM_TIMEOUT = 240_000;
const EPS = 1e-6;
const DEG = 180 / Math.PI;
/** A riding tick that covers less than this is a stall (the SP1 ground-stall rule). */
const STALL_STEP = 0.05;
/** The grind tests time their jump so its apex comes this far past the rail's first point. */
const APEX_PAST = 1;
const inRect = (p: { x: number; z: number }, r: Rect, pad = 0): boolean =>
  p.x >= r.minX - pad && p.x <= r.maxX + pad && p.z >= r.minZ - pad && p.z <= r.maxZ + pad;
const overlaps = (a: Rect, b: Rect): boolean => a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
const top = (s: Solid): number => s.center.y + s.size.y / 2;
const flat = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.z - a.z);
const speedOf = (v: Vec3): number => Math.hypot(v.x, v.z);
/** How far `p` lies from `o` along the horizontal unit direction `d`. */
const ahead = (o: Vec3, d: { x: number; z: number }, p: Vec3): number => (p.x - o.x) * d.x + (p.z - o.z) * d.z;
/** The horizontal unit direction from `a` to `b`. */
const dirOf = (a: Vec3, b: Vec3): { x: number; z: number } => ({ x: (b.x - a.x) / flat(a, b), z: (b.z - a.z) / flat(a, b) });
/** The surface height straight below `p` (from 2 m above it). */
const surfaceY = (h: CityHarness, p: Vec3): number => {
  const from = { ...p, y: p.y + 2 };
  const d = h.dropTo(from, 10);
  expect(d, `a surface under ${JSON.stringify(p)}`).not.toBeNull();
  return from.y - d!;
};
const respawns = (events: { kind: string }[]): unknown[] => events.filter((e) => e.kind === 'respawned');
/** Along-quay coordinate of a point, and its distance inland of the quay line. */
const alongQuay = (q: QuayEdge, p: Vec3): number => (q.across === 'x' ? p.z : p.x);
const inland = (q: QuayEdge, p: Vec3): number => q.out * (q.line - (q.across === 'x' ? p.x : p.z));

let h: CityHarness;
beforeAll(async () => {
  h = await cityHarness(city);
});

describe('suburbs: layout', () => {
  it('wide roads: every suburbs street is 10 m half-width', () => {
    const edges = city.streets.edges.filter((e) => e.a.startsWith('suburbs-') || e.b.startsWith('suburbs-'));
    expect(edges.length).toBeGreaterThan(50);
    expect(params.streetHalfWidth).toBe(10);
    for (const e of edges) expect(e.halfWidth, `${e.a}-${e.b}`).toBe(10);
  });

  it('no road or sidewalk slab overlaps another along z = 0 (where Hillside streets meet Suburbs streets)', () => {
    const slabs = city.solids.filter((s) => (s.kind === 'road' || s.kind === 'sidewalk') && !s.rotationDeg && Math.abs(s.center.z) < 40);
    expect(slabs.length).toBeGreaterThan(50);
    const bad: string[] = [];
    for (let i = 0; i < slabs.length; i++) {
      for (let j = i + 1; j < slabs.length; j++) {
        const [a, b] = [slabs[i]!, slabs[j]!];
        if (Math.abs(top(a) - top(b)) > 1 && Math.abs(a.center.y - b.center.y) > 1) continue;
        if (overlaps(solidRect(a), solidRect(b))) bad.push(`${a.id} × ${b.id}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('houses: 1–2 story pieces at prop scale 1, on yards set back from the street', () => {
    const houses = city.props.filter(isSub);
    expect(houses.length).toBeGreaterThan(300);
    const walks = city.solids.filter((s) => s.kind === 'sidewalk' && inRect(s.center, rect, 20)).map(solidRect);
    for (const p of houses) {
      expect(p.scale, p.id).toBe(1);
      expect(params.houses.pieces, p.id).toContain(p.piece);
      expect(p.piece, p.id).toMatch(/^b-[12]story/);
      // Front yard: no collider of the house comes within the setback of a sidewalk
      for (const c of city.solids.filter((s) => s.id.startsWith(`${p.id}-c`))) {
        const r = solidRect(c);
        const grown = { minX: r.minX - params.houses.setback + 0.01, maxX: r.maxX + params.houses.setback - 0.01, minZ: r.minZ - params.houses.setback + 0.01, maxZ: r.maxZ + params.houses.setback - 0.01 };
        expect(walks.some((w) => overlaps(grown, w)), `${c.id} keeps its yard`).toBe(false);
      }
    }
  });

  it('the skatepark is a clear plaza ≥ 120 × 120 m outside the hub clear circle, with ≥ 8 rails, quarter pipes and a bowl', () => {
    const sk = sub.skatepark;
    expect(sk.maxX - sk.minX).toBeGreaterThanOrEqual(120);
    expect(sk.maxZ - sk.minZ).toBeGreaterThanOrEqual(120);
    expect(inRect({ x: sk.minX, z: sk.minZ }, rect) && inRect({ x: sk.maxX, z: sk.maxZ }, rect)).toBe(true);
    const c = city.hub.center;
    const gap = Math.hypot(Math.max(0, sk.minX - c.x, c.x - sk.maxX), Math.max(0, sk.minZ - c.z, c.z - sk.maxZ));
    expect(gap).toBeGreaterThan(src.hub.clearRadius);
    // Nothing but the park's own pieces stands in it: no streets, no buildings
    const inside = city.solids.filter((s) => overlaps(solidRect(s), sk) && s.kind !== 'ground');
    expect(inside.filter((s) => s.kind !== 'ramp').map((s) => s.id).slice(0, 5)).toEqual([]);
    expect(city.props.filter((p) => inRect(p.position, sk)).map((p) => p.id)).toEqual([]);
    expect(city.streets.nodes.filter((n) => inRect(n.p, sk, -EPS)).map((n) => n.id)).toEqual([]);

    const parkRails = sub.rails.filter((r) => r.kind === 'skatepark');
    expect(parkRails.length).toBeGreaterThanOrEqual(8);
    for (const r of parkRails) for (const p of rails.get(r.id)!.points) expect(inRect(p, sk), r.id).toBe(true);
    expect(sub.ramps.filter((r) => r.kind === 'quarter').length).toBeGreaterThanOrEqual(2);
    expect(sub.bowl.walls.length).toBe(4);
    expect(sub.bowl.outerRamps.length).toBeGreaterThanOrEqual(1);
    expect(inRect({ x: sub.bowl.rim.minX, z: sub.bowl.rim.minZ }, sk) && inRect({ x: sub.bowl.rim.maxX, z: sub.bowl.rim.maxZ }, sk)).toBe(true);
    for (const r of sub.ramps) {
      expect(inRect(r.foot, sk) && inRect(r.top, sk), r.id).toBe(true);
      expect(r.solids.length, r.id).toBeGreaterThan(0);
      for (const id of r.solids) expect(solids.get(id)?.kind, id).toBe('ramp');
    }
  });

  it('skatepark ramps are rotated ramp cuboids, every face rideable (below maxSlopeClimbDeg and minSlopeSlideDeg), with no lip at the foot or the top', () => {
    expect(sub.ramps.length).toBeGreaterThanOrEqual(8);
    const maxDeg = Math.min(cfg.controller.maxSlopeClimbDeg, cfg.controller.minSlopeSlideDeg);
    for (const r of sub.ramps) {
      for (const id of r.solids) {
        const s = solids.get(id)!;
        const rot = s.rotationDeg!;
        expect(rot, id).toBeDefined();
        const deg = Math.max(Math.abs(rot.x), Math.abs(rot.z));
        expect(deg, id).toBeGreaterThan(5);
        expect(deg, id).toBeLessThan(maxDeg);
      }
      const f = r.facing;
      const at = (p: Vec3, d: number): Vec3 => ({ x: p.x + f.x * d, y: p.y, z: p.z + f.z * d });
      // At the foot the ramp's face meets the ground (no step up onto it), and at the top it meets the deck
      expect(Math.abs(surfaceY(h, at(r.foot, 0.05)) - surfaceY(h, at(r.foot, -0.05))), `${r.id} foot`).toBeLessThan(0.05);
      expect(Math.abs(surfaceY(h, at(r.foot, -0.05)) - r.foot.y), `${r.id} foot level`).toBeLessThan(0.02);
      expect(Math.abs(surfaceY(h, at(r.top, -0.05)) - r.top.y), `${r.id} top`).toBeLessThan(0.05);
      expect(Math.abs(surfaceY(h, at(r.top, 0.05)) - r.top.y), `${r.id} deck`).toBeLessThan(0.05);
      const deg = Math.atan2(r.top.y - r.foot.y, flat(r.foot, r.top)) * DEG;
      expect(deg, r.id).toBeLessThan(maxDeg);
    }
  });

  it('street grind rails run along ≥ 2 streets, over the sidewalk at its outer edge (off the road lane)', () => {
    const street = sub.rails.filter((r) => r.kind === 'street');
    const lines = new Set(street.map((r) => {
      const [a, b] = rails.get(r.id)!.points as [Vec3, Vec3];
      return Math.abs(a.x - b.x) < EPS ? `x${a.x}` : `z${a.z}`;
    }));
    expect(lines.size).toBeGreaterThanOrEqual(2);
    const roads = city.solids.filter((s) => s.kind === 'road').map(solidRect);
    for (const r of street) {
      const rail = rails.get(r.id)!;
      const [a, b] = rail.points as [Vec3, Vec3];
      expect(rail.points.length, r.id).toBe(2);
      expect(a.y, r.id).toBeCloseTo(sidewalkTop + params.rails.height, 6);
      expect(b.y, r.id).toBeCloseTo(a.y, 6);
      expect(flat(a, b), r.id).toBeGreaterThanOrEqual(20);
      for (let s = 0; s <= flat(a, b); s += 2) {
        const p = { x: a.x + ((b.x - a.x) * s) / flat(a, b), y: a.y, z: a.z + ((b.z - a.z) * s) / flat(a, b) };
        expect(surfaceY(h, p), `${r.id} over the sidewalk at ${s} m`).toBeCloseTo(sidewalkTop, 2);
        // A courier grinding it (capsule radius off the rail) stays off the road lane
        const lane = { minX: p.x - cfg.capsule.radius, maxX: p.x + cfg.capsule.radius, minZ: p.z - cfg.capsule.radius, maxZ: p.z + cfg.capsule.radius };
        expect(roads.some((q) => overlaps(lane, q)), `${r.id} off the road at ${s} m`).toBe(false);
      }
    }
  });

  it('every rail has room for a grinding courier: nothing within its capsule along it, a surface below', () => {
    expect(sub.rails.length).toBe(city.rails.filter(isSub).length);
    const head = cfg.capsule.height + 0.1;
    for (const r of sub.rails) {
      const pts = rails.get(r.id)!.points;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [a, b] = [pts[i]!, pts[i + 1]!];
        const len = distance(a, b);
        for (let s = 0; s <= len; s += 0.25) {
          const t = s / len;
          const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
          for (const [dx, dz] of [[0, 0], [cfg.capsule.radius, 0], [-cfg.capsule.radius, 0], [0, cfg.capsule.radius], [0, -cfg.capsule.radius]] as const) {
            // From head height down: the first surface is at least 0.3 m under the rail
            const d = h.dropTo({ x: p.x + dx, y: p.y + head, z: p.z + dz }, 10);
            expect(d, `${r.id} at ${s.toFixed(2)} m: a surface below`).not.toBeNull();
            expect(d!, `${r.id} at ${s.toFixed(2)} m: clear`).toBeGreaterThanOrEqual(head + 0.3);
          }
        }
      }
    }
  });

  it('the south edge is a quay: checkpoints every ≤ 150 m along it, on open ground, and no land beyond it', () => {
    const south = sub.quay.quays.find((q) => q.edge === 'south')!;
    expect(south).toBeDefined();
    expect(south.line).toBe(1000 - src.boundary.quayInset);
    const cps = sub.quay.checkpoints
      .map((id) => checkpoints.get(id)!)
      .filter((c) => Math.abs(inland(south, c.position)) < 30)
      .map((c) => alongQuay(south, c.position))
      .sort((a, b) => a - b);
    expect(cps.length).toBeGreaterThanOrEqual(Math.ceil((south.to - south.from) / 150));
    const gaps = [cps[0]! - south.from, ...cps.slice(1).map((a, k) => a - cps[k]!), south.to - cps[cps.length - 1]!];
    expect(gaps[0]!).toBeLessThanOrEqual(75);
    expect(gaps[gaps.length - 1]!).toBeLessThanOrEqual(75);
    for (const g of gaps) expect(g).toBeLessThanOrEqual(150);
    for (const id of sub.quay.checkpoints) {
      const c = checkpoints.get(id)!;
      expect(h.dropTo({ ...c.position, y: c.position.y + 1 }, 2), id).toBeCloseTo(1, 2);
    }
    for (const s of city.solids.filter((x) => isSub(x))) expect(solidRect(s).maxZ, s.id).toBeLessThanOrEqual(south.line + EPS);
  });
});

/**
 * Grinds `rail` from its first point to its last: starting at `approach`, runs (sprinting, or riding the board) along
 * its first segment, jumps so the apex comes APEX_PAST m past the first point, and checks the courier snaps onto this
 * rail, grinds every segment in order at no less than `minSpeed`, detaches at the far end and lands without a respawn.
 */
function grind(rail: Rail, approach: Vec3, board: boolean, minSpeed: number): void {
  const label = `${rail.id} (${board ? 'board' : 'foot'})`;
  const pts = rail.points;
  const [p0, p1] = [pts[0]!, pts[1]!];
  const d = dirOf(p0, p1);
  const yaw = yawToward(d.x, d.z);
  h.spawnAt(approach, yaw);
  expect(h.sim.state.grounded, `${label}: standing at the approach`).toBe(true);
  if (board) {
    h.tick({}, ['board']);
    expect(h.sim.state.onBoard, `${label}: on the board`).toBe(true);
  }
  const hold: Hold = board ? { forward: 1, yaw } : { forward: 1, sprint: true, yaw };
  const tApex = jumpVelocity(cfg, NO_MODS) / cfg.gravity;
  for (let i = 0; ; i++) {
    expect(i, `${label}: reaches the jump point`).toBeLessThan(5 * cfg.tickRate);
    const s = h.sim.state;
    const left = -ahead(p0, d, s.position);
    if (left <= ahead({ x: 0, y: 0, z: 0 }, d, s.velocity) * tApex - APEX_PAST) {
      h.tick(hold, ['jump']);
      break;
    }
    expect(respawns(h.tick(hold)), `${label}: respawned on the approach`).toEqual([]);
  }
  for (let i = 0; h.sim.state.mode !== 'grind'; i++) {
    expect(i, `${label}: lands on the rail (at ${JSON.stringify(h.sim.state.position)})`).toBeLessThan(cfg.tickRate);
    h.tick(hold);
  }
  expect(h.sim.state.grind, `${label}: on this rail, going toward its last point`).toMatchObject({ id: rail.id, segment: 0, dir: 1 });
  let segment = 0;
  for (let i = 0; h.sim.state.mode === 'grind'; i++) {
    const g = h.sim.state.grind!;
    expect(g.segment, `${label}: segments in order`).toBeGreaterThanOrEqual(segment);
    segment = g.segment;
    expect(g.speed, `${label}: grind speed`).toBeGreaterThanOrEqual(minSpeed);
    expect(i, `${label}: reaches the end`).toBeLessThan(30 * cfg.tickRate);
    expect(respawns(h.tick()), `${label}: respawned`).toEqual([]);
  }
  const last = pts[pts.length - 1]!;
  expect(segment, `${label}: grinds every segment`).toBe(pts.length - 2);
  expect(flat(h.sim.state.position, last), `${label}: detaches at the far end`).toBeLessThan(0.6);
  expect(h.sim.state.mode, `${label}: airborne after the end`).toBe('air');
  untilLanded(h, label, {}, 5 * cfg.tickRate, true);
}

describe('suburbs: rails', () => {
  const each = (f: (r: RailReport, rail: Rail) => void): void => {
    expect(sub.rails.length).toBeGreaterThanOrEqual(10);
    for (const r of sub.rails) f(r, rails.get(r.id)!);
  };

  it('every suburbs rail can be grinded end to end on the board at railMinSpeed', () => {
    each((r, rail) => grind(rail, r.approach, true, cfg.board.railMinSpeed));
  }, SIM_TIMEOUT);

  it('every rail can be grinded on foot at minSpeedFoot', () => {
    each((r, rail) => grind(rail, r.approach, false, cfg.rail.minSpeedFoot));
  }, SIM_TIMEOUT);
});

/**
 * Rides ramp `r` on the board: from `runUp` m in front of its foot, at board speed onto it; it must climb to the top
 * without stalling (every tick on the ramp covers ≥ STALL_STEP) and then keep going for a second (grounded or in the
 * air off the top), not stuck and with no respawn.
 */
function ride(r: RampReport): void {
  const f = r.facing;
  const yaw = yawToward(f.x, f.z);
  const runUp = params.skatepark.runUp;
  const start = { x: r.foot.x - f.x * runUp, y: r.foot.y, z: r.foot.z - f.z * runUp };
  h.spawnAt(start, yaw);
  expect(h.sim.state.grounded, `${r.id}: standing in front of the ramp`).toBe(true);
  h.tick({}, ['board']);
  expect(h.sim.state.onBoard, `${r.id}: on the board`).toBe(true);
  const hold: Hold = { forward: 1, yaw };
  const length = ahead(r.foot, f, r.top);
  let footSpeed: number | null = null;
  for (let i = 0; ; i++) {
    expect(i, `${r.id}: reaches the top (at ${JSON.stringify(h.sim.state.position)})`).toBeLessThan(6 * cfg.tickRate);
    const before = h.sim.state.position;
    expect(respawns(h.tick(hold)), `${r.id}: respawned`).toEqual([]);
    const p = h.sim.state.position;
    const a = ahead(r.foot, f, p);
    if (a < 0) continue;
    footSpeed ??= speedOf(h.sim.state.velocity);
    if (a >= length) {
      expect(p.y, `${r.id}: up at the top`).toBeGreaterThanOrEqual(r.top.y - 0.1);
      break;
    }
    expect(ahead(before, f, p), `${r.id}: no stall at ${a.toFixed(2)} m up`).toBeGreaterThanOrEqual(STALL_STEP);
  }
  expect(footSpeed!, `${r.id}: at board speed at the foot`).toBeGreaterThanOrEqual(cfg.board.topSpeed - 0.5);
  const off = h.sim.state.position;
  for (let i = 0; i < cfg.tickRate; i++) {
    expect(respawns(h.tick(hold)), `${r.id}: respawned off the top`).toEqual([]);
    expect(h.sim.state.mode, `${r.id}: off the top`).not.toBe('mantle');
  }
  expect(h.sim.state.onBoard, `${r.id}: still on the board`).toBe(true);
  expect(ahead(off, f, h.sim.state.position), `${r.id}: keeps going off the top (not stuck)`).toBeGreaterThan(3);
}

describe('suburbs: skatepark ramps', () => {
  it('every skatepark ramp is rideable on the board (no stall)', () => {
    expect(sub.ramps.length).toBeGreaterThanOrEqual(8);
    for (const r of sub.ramps) ride(r);
  }, SIM_TIMEOUT);
});

describe('suburbs: water', () => {
  it('running off the south quay into the water respawns at a suburbs quay checkpoint within 150 m', () => {
    const south = sub.quay.quays.find((q) => q.edge === 'south')!;
    let falls = 0;
    for (let a = south.from + 40; a < south.to; a += 120) {
      const label = `south quay at ${a}`;
      const above = { x: a, y: 2, z: south.line - 1 };
      const start = { ...above, y: above.y - h.dropTo(above, 3)! };
      const yaw = yawToward(0, south.out);
      h.spawnAt(start, yaw);
      expect(h.sim.state.grounded, `${label}: standing on the quay`).toBe(true);
      let respawn: string | null = null;
      for (let i = 0; i < 4 * cfg.tickRate && !respawn; i++) {
        for (const e of h.tick({ forward: 1, yaw })) if (e.kind === 'respawned') respawn = e.checkpointId;
      }
      expect(sub.quay.checkpoints, `${label}: at a suburbs quay checkpoint`).toContain(respawn);
      const cp = checkpoints.get(respawn!)!;
      expect(Math.hypot(cp.position.x - start.x, cp.position.z - start.z), label).toBeLessThanOrEqual(150);
      falls++;
    }
    expect(falls).toBeGreaterThanOrEqual(7);
  }, SIM_TIMEOUT);
});
