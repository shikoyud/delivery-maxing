import { describe, expect, it } from 'vitest';
import { movementConfig, ordersConfig, thievesConfig, worldConfig } from '../../src/config';

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
    // Spec §5.3 selection rules (plan assumption 10): 40 m spread, 3 min reuse, the last 6 accepted POIs' districts
    expect(ordersConfig.selection).toEqual({ spreadMeters: 40, reuseSeconds: 180, districtWindow: 6 });
    // Spec §5.3: Chain weighted higher than SP1's 2
    expect(ordersConfig.mix.typeWeights).toEqual({ dropoff: 5, pickup: 4, chain: 4 });
    expect(ordersConfig.heavy).toEqual({ slots: 2, jumpHeightMultiplier: 0.9 });
    expect(ordersConfig.backpack.baseSlots).toBe(1);
  });
  it('world', () => {
    expect(worldConfig.chunkSize).toBe(100);
    expect(worldConfig.physics).toEqual({ loadRadius: 150, unloadRadius: 220 });
    // Plan Task 14: cs 0.4, ch 0.2; links reach 0.6 m; a path counts within 1 m of its target. Tiles are 640 voxels
    // (256 m), not the plan's 64: Detour joins an off-mesh link only to neighbouring tiles and the crane zips run 250 m
    expect(worldConfig.nav).toMatchObject({ cellSize: 0.4, cellHeight: 0.2, tileSize: 640, linkRadius: 0.6, reachTolerance: 1, maxNavMeshMB: 6 });
  });
  it('thieves', () => {
    // Spec §7.3: 15 m trigger, chase between run (5.5) and sprint (8), 10 s chase, 20 s robbed cooldown, 1 point penalty
    expect(thievesConfig).toMatchObject({ triggerRadius: 15, chaseSpeed: 7, maxChaseSeconds: 10, robbedCooldownSeconds: 20, penaltyPoints: 1 });
    expect(thievesConfig.chaseSpeed).toBeGreaterThan(movementConfig.run.runSpeed);
    expect(thievesConfig.chaseSpeed).toBeLessThan(movementConfig.run.sprintSpeed);
    expect(thievesConfig.perDistrict).toEqual({ downtown: 4, harbor: 3, hillside: 3, suburbs: 3 });
    expect(thievesConfig.longStreetExtra).toBe(4);
    expect(thievesConfig.pinnedShare).toBe(0.5);
  });
});
