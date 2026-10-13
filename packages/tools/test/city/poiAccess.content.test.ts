import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  distance,
  inCylinder,
  movementConfig as cfg,
  ordersConfig,
  parsePieceCatalog,
  type Rect,
  type Solid,
  type Vec3,
} from '@dm/shared';
import type { PoiKit } from '../../src/city/district';
import { generateCityWithReport } from '../../src/city/generate';
import { MANTLE_STEP_MIN_RISE } from '../../src/city/kits';
import { parseCitySource } from '../../src/city/source';
import { cityHarness, rideZip, untilLanded, yawToward, type CityHarness } from '../helpers/citySim';

// Runs PlayerSim on the generated city (real committed inputs): every POI access kit takes a courier up and down.
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), 'utf8'));
const src = parseCitySource(readJson('map/city.source.json'));
const pieces = parsePieceCatalog(readJson('map/pieces.json'));
const { city, report } = generateCityWithReport(src, pieces);

const kits = report.poiKits;
const solids = new Map(city.solids.map((s) => [s.id, s]));
const pois = new Map(city.pois.map((p) => [p.id, p]));
const pads = new Map(city.jumpPads.map((p) => [p.id, p]));
const zips = new Map(city.zipLines.map((z) => [z.id, z]));
const links = new Map(city.navLinks.map((l) => [l.id, l]));
const zone = ordersConfig.zones;
const MAX_FALL = ordersConfig.fragile.maxFallMeters;
/** The PlayerSim tests run many courier trips on the city. */
const SIM_TIMEOUT = 180_000;
const EPS = 1e-6;
const inRect = (p: Vec3, r: Rect, pad = 0): boolean =>
  p.x >= r.minX - pad && p.x <= r.maxX + pad && p.z >= r.minZ - pad && p.z <= r.maxZ + pad;
const top = (s: Solid): number => s.center.y + s.size.y / 2;
const mantleKits = kits.filter((k): k is Extract<PoiKit, { kind: 'mantle' }> => k.kind === 'mantle');
const padKits = kits.filter((k): k is Extract<PoiKit, { kind: 'pad-zip' }> => k.kind === 'pad-zip');

let h: CityHarness;
beforeAll(async () => {
  h = await cityHarness(city);
});

/** Walks toward the POI (from where the courier stands) until inside its zone; fails on a respawn. */
function walkIntoZone(label: string, poi: Vec3): void {
  for (let i = 0; i < 4 * cfg.tickRate && !inCylinder(h.sim.state.position, poi, zone.poiRadius, zone.poiHeight); i++) {
    const p = h.sim.state.position;
    const events = h.tick({ forward: 1, yaw: yawToward(poi.x - p.x, poi.z - p.z) });
    expect(events.filter((e) => e.kind === 'respawned'), `${label}: respawned`).toEqual([]);
  }
  expect(inCylinder(h.sim.state.position, poi, zone.poiRadius, zone.poiHeight), `${label}: in the POI zone at ${JSON.stringify(h.sim.state.position)}`).toBe(true);
}

describe('POI access kits: layout', () => {
  it('every elevated POI the districts do not already reach has a kit; every kit belongs to an elevated POI', () => {
    expect(mantleKits.length).toBeGreaterThan(0);
    expect(padKits.length).toBeGreaterThan(0);
    for (const k of kits) {
      const poi = pois.get(k.poi);
      expect(poi?.elevated, k.poi).toBe(true);
      // The POI is the ledge top (city.json rounds it to 0.01 m)
      expect(Math.abs(poi!.position.y - k.top), k.poi).toBeLessThanOrEqual(0.01);
      expect(inRect(poi!.position, k.ledge), k.poi).toBe(true);
    }
    // A balcony is always reached by a kit
    for (const p of city.pois) if (p.kind === 'balcony') expect(kits.some((k) => k.poi === p.id), p.id).toBe(true);
  });

  it('every kit has its navigation links, and mantle rises stay in the R17 window', () => {
    for (const k of mantleKits) {
      expect(links.get(k.climb), k.poi).toMatchObject({ kind: 'mantle', bidirectional: true });
      expect(links.get(k.drop), k.poi).toMatchObject({ kind: 'drop', bidirectional: false });
      const crates = k.steps.map((id) => solids.get(id)!);
      expect(crates.every((c) => c !== undefined && c.kind === 'prop'), k.poi).toBe(true);
      const rises = [...crates.map(top), k.top].map((t, i, all) => t - (i === 0 ? k.approach.y : all[i - 1]!));
      for (const r of rises) {
        expect(r, k.poi).toBeGreaterThanOrEqual(MANTLE_STEP_MIN_RISE - EPS);
        expect(r, k.poi).toBeLessThanOrEqual(cfg.mantle.maxHeight + EPS);
      }
    }
    for (const k of padKits) {
      expect(links.get(`${k.pad}-nav`), k.poi).toMatchObject({ kind: 'pad', bidirectional: false });
      expect(links.get(`${k.zip}-nav`), k.poi).toMatchObject({ kind: 'zip', bidirectional: true });
    }
  });
});

describe('POI access kits: pads', () => {
  it('every kit pad lands on its POI roof', () => {
    for (const k of padKits) {
      const pad = pads.get(k.pad)!;
      expect(pad, k.pad).toBeDefined();
      h.spawnAt(pad.position, yawToward(pad.launch.x, pad.launch.z));
      expect(h.sim.state.padCooldown[pad.id] ?? 0, `${pad.id} launched`).toBeGreaterThan(0);
      const { fall, at } = untilLanded(h, pad.id, {}, 10 * cfg.tickRate, true);
      expect(distance(at, k.target), `${pad.id} lands at ${at.x.toFixed(2)}, ${at.y.toFixed(2)}, ${at.z.toFixed(2)}`).toBeLessThanOrEqual(1.5);
      expect(inRect(h.sim.state.position, k.ledge), `${pad.id} on its roof`).toBe(true);
      expect(fall, `${pad.id} fall`).toBeLessThanOrEqual(MAX_FALL);
      expect(inCylinder(h.sim.state.position, pois.get(k.poi)!.position, zone.poiRadius, zone.poiHeight), `${pad.id} in the POI zone`).toBe(true);
    }
  }, SIM_TIMEOUT);
});

describe('POI access kits: mantle stacks', () => {
  it('every kit mantle stack is climbable to the POI', () => {
    for (const k of mantleKits) {
      const poi = pois.get(k.poi)!;
      const yaw = yawToward(k.facing.x, k.facing.z);
      h.spawnAt(k.approach, yaw);
      expect(h.sim.state.grounded, `${k.poi}: standing at the start`).toBe(true);
      const onTop = (): boolean => {
        const s = h.sim.state;
        return s.grounded && s.mode === 'ground' && Math.abs(s.position.y - k.top) <= 0.05 && inRect(s.position, k.ledge);
      };
      for (let i = 0; i < 8 * cfg.tickRate && !onTop(); i++) {
        const events = h.tick({ forward: 1, yaw });
        expect(events.filter((e) => e.kind === 'respawned'), `${k.poi}: respawned`).toEqual([]);
      }
      expect(onTop(), `${k.poi}: on top at ${JSON.stringify(h.sim.state.position)}`).toBe(true);
      walkIntoZone(k.poi, poi.position);
      expect(onTop(), `${k.poi}: still on its ledge`).toBe(true);
    }
  }, SIM_TIMEOUT);
});

describe('POI access kits: ways down', () => {
  it('every kit zip rides down and dismounts', () => {
    for (const k of padKits) {
      const z = zips.get(k.zip)!;
      expect(z, k.zip).toBeDefined();
      expect(z.a.y, k.zip).toBeGreaterThan(z.b.y);
      expect(inRect(z.a, k.ledge), `${k.zip} starts over the roof`).toBe(true);
      rideZip(h, z, 'b');
    }
  }, SIM_TIMEOUT);

  it('every drop link is ≤ 7 m', () => {
    const drops = city.navLinks.filter((l) => l.kind === 'drop');
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) expect(d.from.y - d.to.y, d.id).toBeLessThanOrEqual(MAX_FALL);
    // Each kit's drop: walking off the ledge toward its end lands there with a fall ≤ 7 m
    for (const k of mantleKits) {
      const d = links.get(k.drop)!;
      h.spawnAt(d.from, yawToward(d.to.x - d.from.x, d.to.z - d.from.z));
      const yaw = yawToward(d.to.x - d.from.x, d.to.z - d.from.z);
      const { fall, at } = untilLanded(h, d.id, { forward: 1, yaw }, 4 * cfg.tickRate);
      expect(fall, d.id).toBeLessThanOrEqual(MAX_FALL);
      expect(Math.abs(at.y - d.to.y), `${d.id} lands at its end's level`).toBeLessThanOrEqual(0.2);
    }
  }, SIM_TIMEOUT);
});
