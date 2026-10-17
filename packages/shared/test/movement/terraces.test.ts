import { describe, expect, test } from 'vitest';
import { cityConfig, movementConfig as cfg, ordersConfig } from '../../src/config';
import type { OrdersConfig } from '../../src/config/types';
import { OrderSystem } from '../../src/orders/OrderSystem';
import { streetDistance } from '../../src/world/distance';
import type { Poi } from '../../src/world/mapTypes';
import type { PlayerZones } from '../../src/world/zones';
import { offerPlayer, offerRules } from '../orders/fixture';
import { vec3, type Vec3 } from '../../src/math/vec3';
import { wrapAngle } from '../../src/movement/ground';
import type { PlayerState, SimEvent } from '../../src/movement/types';
import type { SavedVehicle } from '../../src/vehicles/Garage';
import { forbiddenZoneAt } from '../../src/world/access';
import type { CityLayout, Connector } from '../../src/world/cityLayout';
import { layoutToMap } from '../../src/world/cityMap';
import { steepLaneGeometry, switchbackGeometry } from '../../src/world/terrainSolids';
import { makeSim, type Harness } from '../helpers/simHarness';
import { cityCatalogFixture, cityLayoutFixture } from '../world/cityFixtures';
import { testHospital } from '../world/fixtures';

// One band (B: L1 at y 10 up to L2 at y 24 over z 560-620) with a staircase, a steep lane and a switchback, built with
// layoutToMap as the city is.
const B = cityConfig.bands.B;
const conn = (id: string, kind: Connector['kind'], x: number, extra: Partial<Connector> = {}): Connector => ({ id, kind, band: 'B', x, ...B, ...extra });
const STAIRS = conn('stairs-b', 'stairs', 170);
const LANE = conn('lane-b', 'steepLane', 52);
const SW = conn('sw-b', 'switchback', 228, { legLength: 80 });

const layout = (): CityLayout => ({
  ...cityLayoutFixture(),
  lots: [],
  areas: [],
  blocks: [],
  connectors: [STAIRS, LANE, SW],
  hospitals: [testHospital('h-l2', vec3(500, 24, 700), 'Midtown Medical')],
});
const map = layoutToMap(layout(), cityCatalogFixture());

const seconds = (t: number) => Math.round(t * cfg.tickRate);
/** Look yaw whose forward (facing) is the horizontal direction (dx, dz). */
const yawToward = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const NORTH = yawToward(0, 1);
const SOUTH = yawToward(0, -1);
const EAST = yawToward(1, 0);
const WEST = yawToward(-1, 0);
/** The steep lane's direction (Decision 8: diagonal, about 84 m east for 55 m north). */
const LANE_G = steepLaneGeometry(LANE, cityConfig.steepLane);
const LANE_DIR = { x: LANE_G.dx, z: LANE_G.dz };
const LANE_YAW = yawToward(LANE_DIR.x, LANE_DIR.z);
/** `t` m to the left (west-north) of the lane's centre line */
const offLine = (p: Vec3, t: number): Vec3 => vec3(p.x - t * LANE_DIR.z, p.y, p.z + t * LANE_DIR.x);
/** On L1, 14 m before the foot of the lane, on its centre line. */
const BEFORE_LANE = vec3(LANE_G.start.x - 14 * LANE_DIR.x, 10, LANE_G.start.z - 14 * LANE_DIR.z);

const parked = (tier: SavedVehicle['tier'], position: Vec3, heading: number): SavedVehicle => ({ tier, spot: { kind: 'parked', position, heading }, fuel: 1 });
const SKATEBOARD: SavedVehicle = { tier: 'skateboard', spot: { kind: 'carried' }, fuel: 1 };

async function riding(tier: SavedVehicle['tier'], at: Vec3, heading: number): Promise<Harness> {
  const garage = tier === 'skateboard' ? [SKATEBOARD] : [SKATEBOARD, parked(tier, at, heading)];
  const h = await makeSim({ map, spawn: vec3(at.x + 2, at.y, at.z), yaw: heading, garage });
  expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'mounted', tier });
  return h;
}

const speed = (s: PlayerState) => Math.hypot(s.velocity.x, s.velocity.z);
/** Holds W and steers (A/D) toward the heading `yaw`, coasting above `vmax` and braking well above it, until `until` holds. */
function drive(h: Harness, yaw: number, vmax: number, until: (s: PlayerState) => boolean, maxSeconds = 30): void {
  for (let i = 0; i < seconds(maxSeconds); i++) {
    const v = speed(h.sim.state);
    const steer = Math.max(-1, Math.min(1, 3 * wrapAngle(yaw - h.sim.state.heading)));
    h.tick({ forward: v > vmax + 2 ? -1 : v > vmax ? 0 : 1, strafe: -steer, yaw });
    if (until(h.sim.state)) return;
  }
  throw new Error(`drive: not there after ${maxSeconds} s (at ${JSON.stringify(h.sim.state.position)})`);
}
/** Brakes (S) to a stop. */
function stop(h: Harness, yaw: number): void {
  for (let i = 0; i < seconds(5) && speed(h.sim.state) > 0.5; i++) h.tick({ forward: -1, yaw });
  h.run(2);
}

/** An OrderSystem with one accepted, picked-up Fragile package order (the SP4 OrderSystem test's set-up). */
function fragileCarried(): { sys: OrderSystem; id: string } {
  const cfg: OrdersConfig = {
    ...ordersConfig,
    offers: { maxShown: 3, lifetimeSeconds: 20, minIntervalSeconds: 8, maxIntervalSeconds: 15, maxPathQueries: 8 },
    deliveryCooldown: { minSeconds: 0, maxSeconds: 0 },
    prep: { foodSeconds: 0 },
    mix: { kindWeights: { food: 0, package: 1 }, modifierWeights: { none: 0, express: 0, fragile: 1 } },
  };
  const pois: Poi[] = [
    { id: 'ps-30', position: vec3(0, 0, 60), district: 'downtown', kind: 'counter', name: 'Sender', roles: ['packagePickup'], items: ['vase'], weightKg: [30, 30] },
    { id: 'dp-0', position: vec3(300, 0, 0), district: 'downtown', kind: 'door', name: '0 Pkg Ave', roles: ['dropoffPackage'] },
  ];
  const zones = (...ids: string[]): PlayerZones => ({ poiIds: new Set(ids), safeZone: null });
  const sys = new OrderSystem({ pois, distance: streetDistance, rules: offerRules, cfg, rng: () => 0, capacity: { slots: 3, maxPackageKg: 50 } }, 0);
  sys.update(8, offerPlayer, zones());
  const id = sys.offers[0]!.order.id;
  expect(sys.offers[0]!.order.modifier).toBe('fragile');
  sys.accept(id, 9);
  sys.update(10, offerPlayer, zones('ps-30'));
  expect(sys.active[0]!.pickedUpAt).not.toBeNull();
  return { sys, id };
}

describe('terraces (band B fixture)', () => {
  test('the courier walks up the stairs and the bicycle rides up the steep lane; the car climbs the switchback at 9%', async () => {
    // On foot: from L1 straight north up the 56 steps onto L2.
    const walk = await makeSim({ map, spawn: vec3(170, 10, 555), yaw: NORTH });
    walk.runUntil((s) => s.position.z > 625, seconds(30), { forward: 1, yaw: NORTH });
    expect(walk.sim.state.position.y).toBeCloseTo(24, 1);
    expect(walk.sim.state.grounded).toBe(true);

    // Bicycle: up the diagonal lane.
    const bike = await riding('bicycle', BEFORE_LANE, LANE_YAW);
    bike.runUntil((s) => s.position.z > 625, seconds(40), { forward: 1, yaw: LANE_YAW });
    expect(bike.sim.state.riding).toBe('bicycle');
    expect(bike.sim.state.position.y).toBeCloseTo(24, 1);
    expect(bike.sim.state.position.x).toBeGreaterThan(125);

    // Car: east up the first leg onto the hairpin, north across it, west up the second leg, north onto L2.
    const g = switchbackGeometry(SW, cityConfig.switchback);
    const car = await riding('car', vec3(228, 10, g.legZ[0]), EAST);
    const samples: Vec3[] = [];
    drive(car, EAST, 12, (s) => {
      if (s.position.x > g.xs + 10 && s.position.x < g.xs + g.run - 10) samples.push({ ...s.position });
      return s.position.x > g.xs + g.run + 3;
    });
    expect(car.sim.state.position.y).toBeCloseTo(g.mid, 1);
    const [first, last] = [samples[0]!, samples[samples.length - 1]!];
    expect((last.y - first.y) / (last.x - first.x)).toBeCloseTo(0.09, 2);
    stop(car, EAST);
    drive(car, NORTH, 4, (s) => s.position.z > g.legZ[1] - 1);
    drive(car, WEST, 12, (s) => s.position.x < g.xs - 1);
    expect(car.sim.state.position.y).toBeCloseTo(24, 1);
    stop(car, WEST);
    drive(car, NORTH, 6, (s) => s.position.z > 625);
    expect(car.sim.state.riding).toBe('car');
    expect(car.sim.state.position.y).toBeCloseTo(24, 1);
  });

  test('the bicycle rides up the steep lane 2 m either side of its centre line onto L2 without a fall or a stall', async () => {
    for (const t of [-2, 2]) {
      const bike = await riding('bicycle', offLine(BEFORE_LANE, t), LANE_YAW);
      const events: SimEvent[] = [];
      // how far the bike ever is from the deck height at its distance along the lane (it never leaves the deck)
      let off = 0;
      for (let i = 0; i < seconds(40) && bike.sim.state.position.z <= 625; i++) {
        events.push(...bike.tick({ forward: 1, yaw: LANE_YAW }));
        const p = bike.sim.state.position;
        const along = (p.x - LANE_G.start.x) * LANE_DIR.x + (p.z - LANE_G.start.z) * LANE_DIR.z;
        off = Math.max(off, Math.abs(p.y - (10 + (14 * Math.min(LANE_G.run, Math.max(0, along))) / LANE_G.run)));
      }
      const s = bike.sim.state;
      expect(s.position.z, `offset ${t}`).toBeGreaterThan(625);
      expect(s.riding).toBe('bicycle');
      expect(s.position.y).toBeCloseTo(24, 1);
      expect(off).toBeLessThan(0.3);
      expect(events.filter((e) => e.kind === 'landed' && e.fallHeight > 0.3)).toEqual([]);
      expect(events.some((e) => e.kind === 'crashed')).toBe(false);
    }
  });

  test('a car driven at a steep lane is stopped by its access wall; a skateboard too', async () => {
    for (const tier of ['car', 'skateboard'] as const) {
      const h = await riding(tier, BEFORE_LANE, LANE_YAW);
      for (let i = 0; i < seconds(6); i++) {
        h.tick({ forward: 1, yaw: LANE_YAW });
        expect(forbiddenZoneAt(map, tier, h.sim.state.position)).toBeNull();
      }
      const s = h.sim.state;
      expect(s.riding).toBe(tier);
      expect(s.position.z).toBeLessThan(560);
      // the ramp starts north of z0, so a vehicle held at the wall is still on the street
      expect(s.position.y).toBeCloseTo(10, 1);
      // it did get going and is now pinned against the wall
      expect(s.position.z).toBeGreaterThan(BEFORE_LANE.z + 2);
    }
  });

  test('Review Focus 3: hopping the parapet drops the courier 14 m into the band gap; no respawn; landed with fallHeight ≥ 13', async () => {
    // Carrying a Fragile package (accepted and picked up), as the SP4 order tests do.
    const orders = fragileCarried();
    // On L2 above the lane's band gap, facing the parapet at z 620.
    const h = await makeSim({ map, spawn: vec3(100, 24, 624), yaw: SOUTH });
    expect(h.sim.state.grounded).toBe(true);
    const events: SimEvent[] = [];
    let hopped = false;
    for (let i = 0; i < seconds(8); i++) {
      // a running jump hops the 1 m parapet (its 0.3 m top is too narrow to mantle onto and stand)
      const jump = h.sim.state.grounded && h.sim.state.position.z < 621.5 && h.sim.state.position.y > 20;
      events.push(...h.tick({ forward: 1, yaw: SOUTH }, jump ? ['jump'] : []));
      hopped ||= events.some((e) => e.kind === 'jumped');
      if (events.some((e) => e.kind === 'landed' && e.fallHeight > 1)) break;
    }
    expect(hopped).toBe(true);
    expect(events.some((e) => e.kind === 'respawned')).toBe(false);
    const landed = events.filter((e): e is Extract<SimEvent, { kind: 'landed' }> => e.kind === 'landed');
    expect(Math.max(...landed.map((e) => e.fallHeight))).toBeGreaterThanOrEqual(13);
    const s = h.sim.state;
    expect(s.position.y).toBeCloseTo(10, 1);
    expect(s.position.z).toBeGreaterThan(560);
    expect(s.position.z).toBeLessThan(620);
    // The steep lane leads back up: out of the gap onto L1, to the foot of the lane, and up it.
    const until = (pred: (p: PlayerState) => boolean, yaw: number) => {
      for (let i = 0; i < seconds(40) && !pred(h.sim.state); i++) events.push(...h.tick({ forward: 1, yaw }));
      expect(pred(h.sim.state)).toBe(true);
    };
    until((p) => p.position.z < BEFORE_LANE.z, SOUTH);
    until((p) => p.position.x < BEFORE_LANE.x, WEST);
    until((p) => p.position.z > 625, LANE_YAW);
    expect(h.sim.state.position.y).toBeCloseTo(24, 1);
    // The fall broke the Fragile item once; nothing on the way back up breaks it again.
    const broken = orders.sys.onSimEvents(events);
    expect(broken).toEqual([{ kind: 'fragileBroken', orderId: orders.id, reason: 'fall' }]);
    expect(orders.sys.active[0]!.fragileIntact).toBe(false);
    expect(orders.sys.onSimEvents(events)).toEqual([]);
  });
});
