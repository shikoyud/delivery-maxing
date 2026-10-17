import { describe, expect, it } from 'vitest';
import cosmeticsJson from '../../../../config/cosmetics.json';
import economyJson from '../../../../config/economy.json';
import {
  assertRiding,
  cityConfig,
  cosmeticsConfig,
  economyConfig,
  loadCosmetics,
  loadEconomy,
  movementConfig,
  namesConfig,
  navConfig,
  ordersConfig,
  RIDE_TIERS,
  ridingConfig,
  vehiclesConfig,
  worldConfig,
} from '../../src/config';

describe('config pins spec values', () => {
  it('two-wheelers back up at walking pace, the skateboard does not (Decision 3)', () => {
    expect(ridingConfig.rides.bicycle.reverseSpeed).toBe(2);
    expect(ridingConfig.rides.motorbike.reverseSpeed).toBe(2.5);
    expect(ridingConfig.rides.skateboard.reverseSpeed).toBe(0);
    expect(ridingConfig.rides.car.reverseSpeed).toBe(6);
  });
  it('bay slots are long enough for the car (Decision 13)', () => {
    const car = ridingConfig.rides.car.collider;
    expect(ridingConfig.bays.minGap).toBe(1);
    expect(ridingConfig.bays.spacing).toBeGreaterThanOrEqual(2 * (car.halfLength + car.radius) + ridingConfig.bays.minGap);
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
    expect('maxShown' in ordersConfig.offers).toBe(false); // the Dispatcher tier sets it (economy.json)
    expect(ordersConfig.offers).toEqual({ lifetimeSeconds: 25, minIntervalSeconds: 18, maxIntervalSeconds: 30, maxPathQueries: 8 });
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
  it('vehicle caps: slots 2/2/3/4/6 and kg 10/10/25/50/150 (spec §3.3 rev. 3)', () => {
    const tiers = ['walk', 'skateboard', 'bicycle', 'motorbike', 'car'] as const;
    expect(tiers.map((t) => vehiclesConfig[t].slotCap)).toEqual([2, 2, 3, 4, 6]);
    expect(tiers.map((t) => vehiclesConfig[t].kgCap)).toEqual([10, 10, 25, 50, 150]);
    expect('slots' in vehiclesConfig.car).toBe(false);
    expect('maxPackageKg' in vehiclesConfig.car).toBe(false);
  });
  it('economy: spec §3.3, §3.6, §6 values, USD loaded as micro-USD integers', () => {
    const e = economyConfig;
    expect(e.lines.vehicle.usdMicro).toEqual([2, 5, 12, 25].map((d) => d * 1e6));
    expect(e.lines.bag.usdMicro).toEqual([1, 2, 4, 8, 15].map((d) => d * 1e6));
    expect(e.lines.bag.slots).toEqual([1, 2, 3, 4, 5, 6]);
    expect(e.lines.bag.kg).toEqual([0, 10, 25, 50, 100, 150]);
    expect(e.lines.shoes).toEqual({ usdMicro: [1, 2, 3, 4, 5].map((d) => d * 1e6), sprintPerTier: 0.035 });
    expect(e.lines.dispatcher).toMatchObject({ usdMicro: [1, 3, 6, 10, 15].map((d) => d * 1e6), maxShown: [3, 3, 4, 4, 5, 5], longWeightPerTier: 0.3, modifierWeightPerTier: 0.2 });
    expect(e.lines.dispatcher.intervalScale).toEqual([1, 0.9, 0.8, 0.7, 0.6, 0.5]);
    expect(e.skinUsdMicro).toBe(3_000_000);
    expect(e.lockoutSkipUsdMicro).toBe(500_000);
    expect(e.split.linePool).toBe(0.2);
    expect(e.rate).toEqual({ maxAgeSeconds: 900, maxMove: 0.2 });
    expect(e.slippage).toBe(0.02);
    expect(e.payout.ranges.motorbike).toEqual([30_000, 300_000]);
    expect(e.payout.ranges.walk).toEqual([5_000, 30_000]);
    expect([e.payout.qualityWeight, e.payout.luckWeight]).toEqual([0.6, 0.4]);
    expect(e.lock).toEqual({ days: 7, withdrawWindowHours: 24, maxBoost: 0.3, fullBoostUsdMicro: 100_000_000 });
    expect(e.fuelCan).toEqual({ tank: 0.25, markup: 1.5 });
    expect(e.mockChain).toEqual({ wallet: 'DEV-WALLET', startGameUnits: 600_000 * 1_000_000, vaultUsdMicro: 50_000_000, usdPerGame: 0.00024, confirmSeconds: 2 });
    for (const m of [...e.lines.vehicle.usdMicro, e.skinUsdMicro, ...e.payout.ranges.car]) expect(Number.isInteger(m)).toBe(true);
  });
  it('cosmetics: six per slot, colours parsed, Gold, Chrome and Neon for the outfit and the paint', () => {
    for (const slot of ['outfit', 'vehicle', 'bag', 'phone'] as const) expect(cosmeticsConfig[slot]).toHaveLength(6);
    expect(cosmeticsConfig.premiumFinishes).toEqual(['gold', 'chrome', 'neon']);
    expect(cosmeticsConfig.premiumSlots).toEqual(['outfit', 'vehicle']);
    expect(cosmeticsConfig.vehicle[0]!.color).toBeNull(); // factory paint: each ride keeps its own colours
    expect(typeof cosmeticsConfig.bag[1]!.color).toBe('number');
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

describe('config is validated at load', () => {
  type EconomyJson = typeof economyJson;
  type CosmeticsJson = typeof cosmeticsJson;
  const econ = (edit: (j: EconomyJson) => void): (() => unknown) => () => {
    const j = structuredClone(economyJson);
    edit(j);
    return loadEconomy(j);
  };
  const cos = (edit: (j: CosmeticsJson) => void): (() => unknown) => () => {
    const j = structuredClone(cosmeticsJson);
    edit(j);
    return loadCosmetics(j);
  };

  it('the shipped files pass', () => {
    expect(econ(() => {})).not.toThrow();
    expect(cos(() => {})).not.toThrow();
    expect(() => assertRiding(ridingConfig)).not.toThrow();
  });

  it('economy: table lengths follow the price lists', () => {
    expect(econ((j) => j.lines.vehicle.usd.push(40))).toThrow(/vehicle/);
    expect(econ((j) => j.lines.bag.slots.pop())).toThrow(/bag\.slots/);
    expect(econ((j) => j.lines.bag.kg.push(200))).toThrow(/bag\.kg/);
    expect(econ((j) => j.lines.dispatcher.maxShown.pop())).toThrow(/dispatcher\.maxShown/);
    expect(econ((j) => j.lines.dispatcher.intervalScale.push(0.4))).toThrow(/dispatcher\.intervalScale/);
  });

  it('economy: payout ranges, roll weights, split, rate and lock days', () => {
    expect(econ((j) => (j.payout.ranges.car = [0.6, 0.05]))).toThrow(/payout\.ranges\.car/);
    expect(econ((j) => (j.payout.ranges.walk = [-0.01, 0.03]))).toThrow(/payout\.ranges\.walk/);
    expect(econ((j) => (j.payout.luckWeight = 0.5))).toThrow(/luckWeight/);
    expect(econ((j) => (j.split.linePool = 1.2))).toThrow(/split/);
    expect(econ((j) => (j.split.linePool = -0.1))).toThrow(/split/);
    expect(econ((j) => (j.mockChain.usdPerGame = 0))).toThrow(/usdPerGame/);
    // a 0-day lock would renew forever in one tick
    expect(econ((j) => (j.lock.days = 0))).toThrow(/lock\.days/);
  });

  it('economy: the mock wallet starts with startGame whole GAME, loaded as base units', () => {
    expect(loadEconomy(structuredClone(economyJson)).mockChain.startGameUnits).toBe(economyJson.mockChain.startGame * 1_000_000);
  });

  it('cosmetics: #rrggbb colours (null only for factory paint), the first of each slot free, unique names', () => {
    expect(cos((j) => (j.outfit[2]!.color = 'blue'))).toThrow(/outfit.*colou?r/);
    expect(cos((j) => (j.bag[1]!.color = '#12345'))).toThrow(/bag.*colou?r/);
    expect(cos((j) => (j.phone[0]!.coins = 10))).toThrow(/phone.*free/);
    expect(cos((j) => (j.vehicle[3]!.name = 'cherry'))).toThrow(/vehicle.*cherry/);
  });

  it('riding: a bay slot fits the longest collider plus bays.minGap', () => {
    const r = structuredClone(ridingConfig);
    r.bays.spacing = 5.3; // car 4.4 + 1
    expect(() => assertRiding(r)).toThrow(/bays\.spacing/);
    r.bays.spacing = 5.4;
    expect(() => assertRiding(r)).not.toThrow();
  });
});
