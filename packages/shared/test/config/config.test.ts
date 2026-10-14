import { describe, expect, it } from 'vitest';
import { movementConfig, navConfig, ordersConfig, RIDE_TIERS, ridingConfig, vehiclesConfig } from '../../src/config';

describe('config pins spec values', () => {
  it('movement', () => {
    expect(movementConfig.tickRate).toBe(30);
    expect(movementConfig.run.sprintSpeed).toBe(8);
    expect(movementConfig.speedCap).toBe(12);
    expect(movementConfig.jump).toMatchObject({ height: 1.2, coyoteTime: 0.1, bufferTime: 0.1 });
    expect(movementConfig.mantle.maxHeight).toBe(1.2);
  });
  it('orders', () => {
    expect(ordersConfig.lockout.seconds).toBe(45);
    expect(ordersConfig.offers).toEqual({ maxShown: 3, lifetimeSeconds: 25, minIntervalSeconds: 18, maxIntervalSeconds: 30 });
    expect(ordersConfig.deliveryCooldown).toEqual({ minSeconds: 8, maxSeconds: 10 });
    expect(ordersConfig.prep.foodSeconds).toBeGreaterThan(0);
    expect(ordersConfig.referenceSpeed).toBe(8);
    expect(ordersConfig.express.distanceFactor).toBeLessThan(ordersConfig.par.distanceFactor);
    expect(ordersConfig.fragile.maxFallMeters).toBe(7);
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
    expect(ridingConfig.summon).toMatchObject({ minDistance: 100, cooldownSeconds: 60 });
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
    expect(navConfig).toMatchObject({ walkClimb: 0.8, doorSearchMaxRadius: 120, maxFootLeg: 60, carRoadMaxDoorDistance: 30 });
    expect(navConfig.walkClimb).toBeGreaterThanOrEqual(movementConfig.controller.maxStepHeight);
    expect(navConfig.walkClimb).toBeLessThanOrEqual(movementConfig.mantle.maxHeight);
    expect(navConfig.doorSearchMaxRadius).toBeGreaterThanOrEqual(navConfig.carRoadMaxDoorDistance);
    expect(navConfig.maxFootLeg).toBeGreaterThanOrEqual(navConfig.carRoadMaxDoorDistance);
  });
});
