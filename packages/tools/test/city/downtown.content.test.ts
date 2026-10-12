import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  closestOnSegment,
  distance,
  movementConfig as cfg,
  ordersConfig,
  parsePieceCatalog,
  solidRect,
  type Rect,
  type Solid,
  type Vec3,
  type ZipLine,
} from '@dm/shared';
import type { DistrictReport } from '../../src/city/district';
import { generateCityWithReport } from '../../src/city/generate';
import { parseCitySource } from '../../src/city/source';
import { cityHarness, yawToward, type CityHarness } from '../helpers/citySim';

// Runs PlayerSim on the generated city (real committed inputs).
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), 'utf8'));
const src = parseCitySource(readJson('map/city.source.json'));
const pieces = parsePieceCatalog(readJson('map/pieces.json'));
const { city, report } = generateCityWithReport(src, pieces);
const downtown = report.districts.downtown as DistrictReport;
const params = src.districts.find((d) => d.district === 'downtown')!.params;
const assetsCfg = JSON.parse(readFileSync(join(here, '../../assets.config.json'), 'utf8')) as {
  pieces: { id: string; kind: string; scale: number }[];
};

const solids = new Map(city.solids.map((s) => [s.id, s]));
const pads = city.jumpPads.filter((p) => p.id.startsWith('downtown-'));
const zips = city.zipLines.filter((z) => z.id.startsWith('downtown-'));
const MAX_FALL = ordersConfig.fragile.maxFallMeters;
/** The PlayerSim tests run many courier trips on the city. */
const SIM_TIMEOUT = 60_000;
const inRect = (p: Vec3, r: Rect, pad = 0): boolean =>
  p.x >= r.minX - pad && p.x <= r.maxX + pad && p.z >= r.minZ - pad && p.z <= r.maxZ + pad;
const top = (s: Solid): number => s.center.y + s.size.y / 2;

let h: CityHarness;
beforeAll(async () => {
  h = await cityHarness(city);
});

/** Settling after a landing: this many ticks with no input. */
const SETTLE_TICKS = 10;

/**
 * Lands the courier: runs `hold` until grounded in ground mode after being airborne (already airborne when
 * `airborne`), then lets go of the keys for SETTLE_TICKS. Returns the largest fall seen and the feet on the landing
 * tick. Fails on a respawn.
 */
function untilLanded(label: string, hold: Parameters<CityHarness['tick']>[0], maxTicks: number, airborne = false): { fall: number; at: Vec3 } {
  let fall = 0;
  const watch = (events: ReturnType<CityHarness['tick']>): void => {
    expect(events.filter((e) => e.kind === 'respawned'), `${label}: respawned`).toEqual([]);
    for (const e of events) if (e.kind === 'landed') fall = Math.max(fall, e.fallHeight);
  };
  for (let i = 0; i < maxTicks; i++) {
    watch(h.tick(hold));
    const s = h.sim.state;
    if (!s.grounded) airborne = true;
    else if (airborne && s.mode === 'ground') {
      const at = { ...s.position };
      for (let k = 0; k < SETTLE_TICKS; k++) watch(h.tick());
      return { fall, at };
    }
  }
  throw new Error(`${label}: not standing again within ${maxTicks} ticks (at ${JSON.stringify(h.sim.state.position)})`);
}

describe('downtown: layout', () => {
  it('downtown has ≥ 6 alleys and ≥ 12 pads', () => {
    expect(downtown.alleys.length).toBeGreaterThanOrEqual(6);
    expect(pads.length).toBeGreaterThanOrEqual(12);
    expect(zips.length).toBeGreaterThan(0);
    expect(city.boostOrbs.filter((o) => o.id.startsWith('downtown-')).length).toBeGreaterThan(0);
    expect(downtown.rooftopGaps.length).toBeGreaterThan(0);
  });

  it('each alley is 4 m wide between walls ≥ 20 m long and ≥ 8 m high', () => {
    for (const a of downtown.alleys) {
      const width = a.axis === 'x' ? a.floor.maxZ - a.floor.minZ : a.floor.maxX - a.floor.minX;
      expect(Math.abs(width - 4), a.id).toBeLessThanOrEqual(0.02);
      for (const side of a.walls) {
        const rects = side.map((id) => solidRect(solids.get(id)!));
        const lo = Math.min(...rects.map((r) => (a.axis === 'x' ? r.minX : r.minZ)));
        const hi = Math.max(...rects.map((r) => (a.axis === 'x' ? r.maxX : r.maxZ)));
        expect(hi - lo, `${a.id} wall length`).toBeGreaterThanOrEqual(20);
        for (const id of side) expect(top(solids.get(id)!), `${id} height`).toBeGreaterThanOrEqual(8);
        // The wall faces are flush with the floor strip, with no gap along the run
        const along = rects.map((r) => (a.axis === 'x' ? [r.minX, r.maxX] : [r.minZ, r.maxZ]) as [number, number]).sort((p, q) => p[0] - q[0]);
        for (let k = 1; k < along.length; k++) expect(along[k]![0] - along[k - 1]![1], `${a.id} seam`).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it('the downtown art scale is 3.2–4.2 at the ×2.8 bake of the building pieces', () => {
    expect([params.artScaleMin, params.artScaleMax]).toEqual([3.2, 4.2]);
    for (const p of assetsCfg.pieces.filter((x) => x.kind === 'building')) expect(p.scale, p.id).toBe(params.bakeScale);
    for (const p of city.props.filter((x) => x.id.startsWith('downtown-'))) {
      expect(p.scale * (params.bakeScale as number), p.id).toBeGreaterThanOrEqual(3.2 - 0.02);
      expect(p.scale * (params.bakeScale as number), p.id).toBeLessThanOrEqual(4.2 + 0.02);
    }
  });

  it('marked rooftop gaps are 2.5–4.5 m with steps ≤ 1.2 m up or ≤ 7 m down', () => {
    for (const g of downtown.rooftopGaps) {
      const r = g.landing;
      const gap = Math.hypot(Math.max(0, r.minX - g.from.x, g.from.x - r.maxX), Math.max(0, r.minZ - g.from.z, g.from.z - r.maxZ));
      const label = `gap at ${g.from.x}, ${g.from.z}`;
      expect(gap, label).toBeGreaterThanOrEqual(2.5 - 0.01);
      expect(gap, label).toBeLessThanOrEqual(4.5 + 0.01);
      expect(g.to.y - g.from.y, label).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(g.from.y - g.to.y, label).toBeLessThanOrEqual(7);
    }
  });
});

describe('downtown: features', () => {
  it('every pad and zip line has its navigation link (pads one-way, zips both ways)', () => {
    const links = new Map(city.navLinks.map((l) => [l.id, l]));
    for (const pad of pads) expect(links.get(`${pad.id}-nav`), pad.id).toMatchObject({ kind: 'pad', from: pad.position, bidirectional: false });
    for (const z of zips) expect(links.get(`${z.id}-nav`), z.id).toMatchObject({ kind: 'zip', from: z.a, to: z.b, bidirectional: true });
  });

  it('boost orbs float over route roofs, clear of every marked jump line', () => {
    const orbs = city.boostOrbs.filter((o) => o.id.startsWith('downtown-'));
    const reach = cfg.boostOrb.radius + cfg.capsule.radius;
    for (const o of orbs) {
      const below = h.dropTo(o.position, 5);
      expect(below, `${o.id} over a roof`).not.toBeNull();
      expect(o.position.y - below!, o.id).toBeGreaterThan(10);
      for (const g of downtown.rooftopGaps) {
        // The run-up (3 m back from the edge) and the jump to the landing point
        const len = Math.hypot(g.to.x - g.from.x, g.to.z - g.from.z);
        const start = { x: g.from.x - ((g.to.x - g.from.x) / len) * 3, y: g.from.y + 1, z: g.from.z - ((g.to.z - g.from.z) / len) * 3 };
        const hit = closestOnSegment(o.position, start, { ...g.to, y: g.to.y + 1 });
        expect(hit.dist, `${o.id} by the jump from ${g.from.x}, ${g.from.z}`).toBeGreaterThan(reach);
      }
    }
  });

  it('every downtown zip line clears what is below it by the hang drop', () => {
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

describe('downtown: jump pads', () => {
  it('every downtown jump pad lands its rider on its target roof (feet within 1.5 m of the target, grounded, fall ≤ 7 m)', () => {
    const targets = new Map(downtown.padTargets.map((t) => [t.pad, t]));
    for (const pad of pads) {
      const t = targets.get(pad.id);
      expect(t, `${pad.id} has a target`).toBeDefined();
      // Standing on the pad launches the courier at once (during spawnAt's settling ticks)
      h.spawnAt(pad.position, yawToward(pad.launch.x, pad.launch.z));
      expect(h.sim.state.padCooldown[pad.id] ?? 0, `${pad.id} launched`).toBeGreaterThan(0);
      const { fall, at } = untilLanded(pad.id, {}, 10 * cfg.tickRate, true);
      const p = h.sim.state.position;
      expect(h.sim.state.grounded, `${pad.id} grounded`).toBe(true);
      expect(distance(at, t!.target), `${pad.id} lands at ${at.x.toFixed(2)}, ${at.y.toFixed(2)}, ${at.z.toFixed(2)}`).toBeLessThanOrEqual(1.5);
      expect(inRect(p, t!.landing), `${pad.id} on its roof`).toBe(true);
      expect(fall, `${pad.id} fall`).toBeLessThanOrEqual(MAX_FALL);
    }
  }, SIM_TIMEOUT);
});

/**
 * Feet for a standing spot under the first 4 m of the cable from `from` (toward `to`) where a standing courier's hand
 * reaches the cable, or null.
 */
function grabSpot(z: ZipLine, from: Vec3, to: Vec3): Vec3 | null {
  const len = distance(from, to);
  for (let s = 0; s <= Math.min(4, len); s += 0.25) {
    const k = s / len;
    const c = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k };
    const drop = h.dropTo(c, 10);
    if (drop === null || drop <= 0) continue;
    const feet = { x: c.x, y: c.y - drop, z: c.z };
    const hand = { x: feet.x, y: feet.y + cfg.capsule.height, z: feet.z };
    if (closestOnSegment(hand, z.a, z.b).dist <= cfg.zipLine.attachDistance) return feet;
  }
  return null;
}

describe('downtown: zip lines', () => {
  it('every downtown zip line rides both ways and ends in a dismount (mode ground on the detach tick)', () => {
    expect(new Set(downtown.zipLines)).toEqual(new Set(zips.map((z) => z.id)));
    for (const z of zips) {
      for (const to of ['b', 'a'] as const) {
        const [from, target, dir] = to === 'b' ? [z.a, z.b, 1] : [z.b, z.a, -1];
        const label = `${z.id} -> ${to}`;
        const feet = grabSpot(z, from, target);
        expect(feet, `${label}: a standing spot within reach of the cable near the start`).not.toBeNull();
        h.spawnAt(feet!, yawToward(target.x - from.x, target.z - from.z));
        h.tick({}, ['interact']);
        expect(h.sim.state.zip, `${label}: grabbed`).toMatchObject({ id: z.id, dir });
        const rideTicks = Math.ceil((distance(z.a, z.b) / cfg.zipLine.baseSpeed) * cfg.tickRate) + 5;
        for (let i = 0; i < rideTicks && h.sim.state.mode === 'zipline'; i++) {
          const events = h.tick();
          expect(events.filter((e) => e.kind === 'respawned'), `${label}: respawned`).toEqual([]);
        }
        expect(h.sim.state.mode, `${label}: the ride ends in a dismount`).toBe('ground');
        const off = { ...h.sim.state.position };
        expect(Math.hypot(off.x - target.x, off.z - target.z), `${label}: rode to the far end`).toBeLessThan(1);
        const events = h.run(cfg.tickRate / 2);
        expect(events.filter((e) => e.kind === 'landed' && e.fallHeight > 0.1), `${label}: no fall after the dismount`).toEqual([]);
        expect(h.sim.state.grounded, `${label}: standing after the exit`).toBe(true);
        expect(Math.abs(h.sim.state.position.y - off.y), `${label}: still on the dismount surface`).toBeLessThanOrEqual(0.05);
      }
    }
  }, SIM_TIMEOUT);
});

describe('downtown: wall-run alleys', () => {
  it('each wall-run alley: a sprint-jump along the wall starts a wall-run', () => {
    const r = cfg.capsule.radius;
    for (const a of downtown.alleys) {
      const alongX = a.axis === 'x';
      // Run from either open end, next to either wall
      for (const end of [-1, 1] as const) {
        for (const side of [0, 1] as const) {
          const label = `${a.id} from the ${end < 0 ? 'low' : 'high'} end beside wall ${side}`;
          const start = alongX ? (end < 0 ? a.floor.minX : a.floor.maxX) : end < 0 ? a.floor.minZ : a.floor.maxZ;
          const across = alongX ? (side === 0 ? a.floor.minZ + r + 0.5 : a.floor.maxZ - r - 0.5) : side === 0 ? a.floor.minX + r + 0.5 : a.floor.maxX - r - 0.5;
          const dir = -end; // run into the alley
          const feet = alongX ? { x: start + dir * 1, y: 0.05, z: across } : { x: across, y: 0.05, z: start + dir * 1 };
          const yaw = alongX ? yawToward(dir, 0) : yawToward(0, dir);
          h.spawnAt(feet, yaw);
          const hold = { forward: 1, sprint: true, yaw };
          h.run(10, hold);
          expect(h.sim.state.grounded, label).toBe(true);
          h.tick(hold, ['jump']);
          const ticks = h.runUntil((s) => s.mode === 'wallrun', 10, hold);
          expect(ticks, label).toBeLessThanOrEqual(10);
          const n = h.sim.state.wallRun.normal!;
          // The wall's normal points into the alley
          expect(alongX ? n.z : n.x, label).toBeCloseTo(side === 0 ? 1 : -1, 3);
        }
      }
    }
  }, SIM_TIMEOUT);
});

describe('downtown: rooftop routes', () => {
  it('each marked rooftop gap is cleared by a sprint jump from the edge', () => {
    for (const g of downtown.rooftopGaps) {
      const dx = g.to.x - g.from.x;
      const dz = g.to.z - g.from.z;
      const len = Math.hypot(dx, dz);
      const [ux, uz] = [dx / len, dz / len];
      const yaw = yawToward(ux, uz);
      const label = `gap ${g.from.x}, ${g.from.y}, ${g.from.z} -> ${g.to.x}, ${g.to.y}, ${g.to.z}`;
      // Run up 3 m back from the edge, jump within 0.3 m of it
      h.spawnAt({ x: g.from.x - ux * 3, y: g.from.y, z: g.from.z - uz * 3 }, yaw);
      expect(h.sim.state.grounded, `${label}: standing at the run-up`).toBe(true);
      const hold = { forward: 1, sprint: true, yaw };
      let jumped = false;
      for (let i = 0; i < 30 && !jumped; i++) {
        const p = h.sim.state.position;
        const toEdge = (g.from.x - p.x) * ux + (g.from.z - p.z) * uz;
        if (toEdge <= 0.3) {
          h.tick(hold, ['jump']);
          jumped = true;
        } else h.tick(hold);
      }
      expect(jumped, `${label}: reached the edge`).toBe(true);
      const { fall } = untilLanded(label, hold, 3 * cfg.tickRate);
      const p = h.sim.state.position;
      expect(Math.abs(p.y - g.to.y), `${label}: lands at y ${p.y.toFixed(2)}`).toBeLessThanOrEqual(0.05);
      expect(inRect(p, g.landing), `${label}: lands on the roof ahead at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`).toBe(true);
      expect(fall, `${label}: fall`).toBeLessThanOrEqual(MAX_FALL);
    }
  }, SIM_TIMEOUT);
});
