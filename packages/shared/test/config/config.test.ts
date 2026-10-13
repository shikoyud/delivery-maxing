import { describe, expect, it } from 'vitest';
import { movementConfig, ordersConfig, worldConfig } from '../../src/config';

describe('config pins spec values', () => {
  it('movement', () => {
    expect(movementConfig.tickRate).toBe(30);
    expect(movementConfig.run.sprintSpeed).toBe(8);
    expect(movementConfig.speedCap).toBe(18);
    expect(movementConfig.jump).toMatchObject({ height: 1.2, coyoteTime: 0.1, bufferTime: 0.1 });
    expect(movementConfig.mantle.maxHeight).toBe(1.5);
    expect(movementConfig.wallRun.maxTime).toBe(1.5);
    expect(movementConfig.boostOrb).toMatchObject({ speedMultiplier: 1.4, duration: 3, respawnTime: 30 });
    expect(movementConfig.board.topSpeed).toBe(12);
  });
  it('orders', () => {
    expect(ordersConfig.board).toEqual({ size: 6, refreshSeconds: 60, cancelCooldownSeconds: 30 });
    expect(ordersConfig.points).toEqual({ short: 1, medium: 2, long: 3, chain: 4, expressOnTime: 1, fragileIntact: 2, heavy: 1, withinPar: 1 });
    expect(ordersConfig.coins).toEqual({ short: 10, medium: 20, long: 30, chain: 40, expressOnTime: 10, fragileIntact: 20, heavy: 10, withinPar: 10 });
    expect(ordersConfig.bands).toEqual({ city: { shortMax: 500, mediumMax: 1200 }, greybox: { shortMax: 150, mediumMax: 350 } });
    expect(ordersConfig.express).toEqual({ distanceFactor: 1.1, extraSeconds: 10 });
    // Express keeps its own tighter timer (spec §3.2): tighter than par, with the same extra seconds.
    expect(ordersConfig.express.distanceFactor).toBeLessThan(ordersConfig.par.distanceFactor);
    expect(ordersConfig.express.extraSeconds).toBeLessThanOrEqual(ordersConfig.par.extraSeconds);
    expect(ordersConfig.par).toEqual({ distanceFactor: 1.3, extraSeconds: 10 });
    expect(ordersConfig.fragile.maxFallMeters).toBe(7);
    // Spec §5.3: ≥ 40% elevated; plan Task 14: ≥ 20 POIs per band and ≥ 140 reachable
    expect(ordersConfig.poiChecks).toEqual({ minReachable: 140, minElevatedShare: 0.4, minPerBand: 20 });
    expect(ordersConfig.heavy).toEqual({ slots: 2, jumpHeightMultiplier: 0.9 });
    expect(ordersConfig.backpack.baseSlots).toBe(1);
  });
  it('world', () => {
    expect(worldConfig.chunkSize).toBe(100);
    expect(worldConfig.physics).toEqual({ loadRadius: 150, unloadRadius: 220 });
    // Plan Task 14: cs 0.4, ch 0.2, tile 64; links reach 0.6 m; a path counts within 1 m of its target
    expect(worldConfig.nav).toMatchObject({ cellSize: 0.4, cellHeight: 0.2, tileSize: 64, linkRadius: 0.6, reachTolerance: 1 });
  });
});
