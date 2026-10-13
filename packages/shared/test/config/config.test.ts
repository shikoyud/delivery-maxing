import { describe, expect, it } from 'vitest';
import { movementConfig, ordersConfig, vehiclesConfig } from '../../src/config';

describe('config pins spec values', () => {
  it('movement', () => {
    expect(movementConfig.tickRate).toBe(30);
    expect(movementConfig.run.sprintSpeed).toBe(8);
    expect(movementConfig.speedCap).toBe(12);
    expect(movementConfig.jump).toMatchObject({ height: 1.2, coyoteTime: 0.1, bufferTime: 0.1 });
    expect(movementConfig.mantle.maxHeight).toBe(1.2);
    expect(movementConfig.board.topSpeed).toBe(12);
  });
  it('orders', () => {
    expect(ordersConfig.lockout.seconds).toBe(45);
    expect(ordersConfig.offers).toEqual({ maxShown: 3, lifetimeSeconds: 20, minIntervalSeconds: 8, maxIntervalSeconds: 15 });
    expect(ordersConfig.referenceSpeed).toBe(8);
    expect(ordersConfig.express.distanceFactor).toBeLessThan(ordersConfig.par.distanceFactor);
    expect(ordersConfig.fragile.maxFallMeters).toBe(7);
  });
  it('vehicles', () => {
    expect(vehiclesConfig.car.maxPackageKg).toBe(150);
    expect(vehiclesConfig.walk.slots).toBe(1);
  });
});
