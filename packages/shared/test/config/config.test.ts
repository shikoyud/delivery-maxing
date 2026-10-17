import { describe, expect, it } from 'vitest';
import { cityConfig, movementConfig, namesConfig, navConfig, ordersConfig, RIDE_TIERS, ridingConfig, vehiclesConfig, worldConfig } from '../../src/config';

describe('config pins spec values', () => {
  it('two-wheelers back up at walking pace, the skateboard does not (Decision 3)', () => {
    expect(ridingConfig.rides.bicycle.reverseSpeed).toBe(2);
    expect(ridingConfig.rides.motorbike.reverseSpeed).toBe(2.5);
    expect(ridingConfig.rides.skateboard.reverseSpeed).toBe(0);
    expect(ridingConfig.rides.car.reverseSpeed).toBe(6);
  });
  it('movement', () => {
    expect(movementConfig.tickRate).toBe(30);
    expect(movementConfig.run.sprintSpeed).toBe(8);
    expect(movementConfig.speedCap).toBe(12);
    expect(movementConfig.jump).toMatchObject({ height: 1.2, coyoteTime: 0.1, bufferTime: 0.1 });
    expect(movementConfig.mantle.maxHeight).toBe(1.2);
  });
  it('the pickup deadline is 3 minutes with a 3 minute lockout (shiko, 2026-10-17)', () => {
    expect(ordersConfig.pickupDeadline).toEqual({ seconds: 180, lockoutSeconds: 180 });
  });
  it('orders', () => {
    expect(ordersConfig.lockout.seconds).toBe(45);
    expect(ordersConfig.offers).toEqual({ maxShown: 3, lifetimeSeconds: 25, minIntervalSeconds: 18, maxIntervalSeconds: 30, maxPathQueries: 8 });
    expect(ordersConfig.deliveryCooldown).toEqual({ minSeconds: 8, maxSeconds: 10 });
    expect(ordersConfig.prep.foodSeconds).toBeGreaterThan(0);
    expect(ordersConfig.referenceSpeed).toBe(8);
    expect(ordersConfig.express.distanceFactor).toBeLessThan(ordersConfig.par.distanceFactor);
    expect(ordersConfig.fragile.maxFallMeters).toBe(7);
  });
  it('navmesh budget: per-tier cell sizes and a 10 MB gzipped total (Decision 13)', () => {
    expect(navConfig.cellSizeByTier).toEqual({ walk: 0.3, skateboard: 0.4, bicycle: 0.4, motorbike: 0.5, car: 0.6 });
    expect(navConfig.maxNavMeshMB).toBe(10);
  });
  it('world', () => {
    expect(worldConfig).toEqual({ chunkSize: 100, physics: { loadRadius: 150, unloadRadius: 220 } });
  });
  it('vehicles', () => {
    expect(vehiclesConfig.car.maxPackageKg).toBe(150);
    expect(vehiclesConfig.walk.slots).toBe(1);
  });
  it('riding config: four rides, fuel only on motorbike and car (spec §4.2, §4.4)', () => {
    expect(RIDE_TIERS).toEqual(['skateboard', 'bicycle', 'motorbike', 'car']);
    expect(ridingConfig.rides.motorbike.fuel).toEqual({ rangeMeters: 6000, fullTankCoins: 40 });
    expect(ridingConfig.rides.car.fuel).toEqual({ rangeMeters: 5000, fullTankCoins: 80 });
    expect(ridingConfig.rides.skateboard.fuel).toBeNull();
    expect(ridingConfig.rides.bicycle.fuel).toBeNull();
    expect(ridingConfig.riding.emptyTankSpeed).toBe(3);
    expect(ridingConfig.riding.mountReachHeight).toBe(1.5);
    expect(ridingConfig.summon).toMatchObject({ minDistance: 100, cooldownSeconds: 60 });
  });
  it('only the skateboard jumps (Decision 10)', () => {
    expect(ridingConfig.rides.skateboard.jumpHeight).toBe(0.8);
    for (const t of ['bicycle', 'motorbike', 'car'] as const) expect(ridingConfig.rides[t].jumpHeight).toBeNull();
  });
  it('the camera-relative turn-first keys are gone (Decision 7)', () => {
    expect('backInputDot' in ridingConfig.riding).toBe(false);
    expect('turnFirstMaxReverse' in ridingConfig.riding).toBe(false);
    expect('backOutSeconds' in ridingConfig.riding).toBe(false);
  });
  it('access table matches spec §4.3', () => {
    expect(ridingConfig.access).toEqual({
      walk: ['alley', 'steepLane', 'stairs', 'path'],
      skateboard: ['alley', 'path'],
      bicycle: ['alley', 'steepLane', 'path'],
      motorbike: ['alley', 'steepLane'],
      car: [],
    });
  });
  it('top speeds are the spec caps', () => {
    expect(RIDE_TIERS.map((t) => vehiclesConfig[t].topSpeed)).toEqual([12, 16, 22, 28]);
  });
  it('Fragile crash threshold is 10 m/s', () => {
    expect(ordersConfig.fragile.crashSpeed).toBe(10);
  });
  it('nav: walk climb under the mantle height, door search and foot leg limits', () => {
    expect(navConfig).toMatchObject({ walkClimb: 1.0, doorSearchMaxRadius: 120, maxFootLeg: 60, carRoadMaxDoorDistance: 30 });
    expect(navConfig.walkClimb).toBeGreaterThanOrEqual(movementConfig.controller.maxStepHeight);
    // the walk mesh never takes a ledge the courier cannot mantle; a parapet (1 m) is not crossed whatever the climb,
    // because its top is unwalkable (geometry.ts ROOFED)
    expect(navConfig.walkClimb).toBeLessThan(movementConfig.mantle.maxHeight);
    expect(navConfig.gapFloorBlocker.height).toBeGreaterThan(0);
    expect(navConfig.doorSearchMaxRadius).toBeGreaterThanOrEqual(navConfig.carRoadMaxDoorDistance);
    expect(navConfig.maxFootLeg).toBeGreaterThanOrEqual(navConfig.carRoadMaxDoorDistance);
  });

  it('city: levels, bands and POI caps from the city design', () => {
    expect(cityConfig.size).toBe(1200);
    expect(cityConfig.levels.L2).toEqual({ y: 24, z0: 620, z1: 820 });
    expect(cityConfig.bands.B).toEqual({ z0: 560, z1: 620, y0: 10, y1: 24 });
    expect(cityConfig.pois).toEqual({ foodPickupCap: 100, packagePickupCap: 60, target: 800, doorSpacing: 12 });
    expect(cityConfig.orderRules.bands).toEqual({ shortMax: 350, mediumMax: 800 });
    expect(cityConfig.steepLane).toMatchObject({ gradePct: 14, width: 6 });
    expect(cityConfig.switchback.gradePct).toBe(9);
    expect(cityConfig.stairs.width).toBe(4);
  });
  it('names: enough fictional words, five avenues, eleven cross streets', () => {
    expect(namesConfig.first.length).toBeGreaterThanOrEqual(60);
    expect(namesConfig.surnames.length).toBeGreaterThanOrEqual(80);
    expect(namesConfig.kinds.bakery).toEqual(['Bakery', '& Co. Bakery', 'Bakehouse']);
    expect(namesConfig.streets.avenues).toEqual(['Harbor Road', 'Bayview Avenue', 'Midtown Avenue', 'Uptown Avenue', 'Hillcrest Drive']);
    expect(namesConfig.streets.cross).toHaveLength(11);
    expect(namesConfig.streets.quay).toBe('Quay Street');
    expect(new Set(namesConfig.first).size).toBe(namesConfig.first.length);
    expect(new Set(namesConfig.surnames).size).toBe(namesConfig.surnames.length);
  });
  it('names: no real delivery-app or marketplace names anywhere', () => {
    const banned = /amazon|grab|shopee|uber|doordash|deliveroo|foodpanda/i;
    const words: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') words.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => (words.push(k), walk(x)));
    };
    walk(namesConfig);
    expect(words.length).toBeGreaterThan(200);
    expect(words.filter((w) => banned.test(w))).toEqual([]);
  });
});
