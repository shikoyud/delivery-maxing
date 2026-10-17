import { describe, expect, it } from 'vitest';
import { GAME_UNITS, RIDE_TIERS, economyConfig, effectiveCapacity, tierOfVehicle, expandGreybox, type GreyboxSource, type MapData, type RideTier } from '@dm/shared';
import greyboxJson from '../../../map/greybox.json';
import cityJson from '../../../map/city.layout.json';
import { MockChain } from '../src/economy/MockChain';
import { capacityLabel, economyActions, mapRowItems, ownedBoxStates, rideOfTier, vehicleTierAfter } from '../src/ui/devPanel';
import { teleportTargets } from '../src/game/mapTargets';

const grey = expandGreybox(greyboxJson as GreyboxSource);
// The city layout's hospitals and gas stations are all the Map row reads.
const city = { kind: 'city', hospitals: cityJson.hospitals, gasStations: cityJson.gasStations } as unknown as MapData;

describe('dev panel Map row', () => {
  it('lists 4 hospitals and 6 gas stations on the city', () => {
    const items = mapRowItems(teleportTargets(city), () => undefined);
    expect(items.filter((i) => i.kind === 'hospital')).toHaveLength(4);
    expect(items.filter((i) => i.kind === 'gas')).toHaveLength(6);
  });

  it('lists 4 hospitals and 2 gas stations on the greybox', () => {
    const items = mapRowItems(teleportTargets(grey), () => undefined);
    expect(items.filter((i) => i.kind === 'hospital')).toHaveLength(4);
    expect(items.filter((i) => i.kind === 'gas')).toHaveLength(2);
  });

  it('clicking an entry calls teleportTo with its id', () => {
    const calls: string[] = [];
    const items = mapRowItems(teleportTargets(city), (id) => void calls.push(id));
    items[0]!.run();
    items[items.length - 1]!.run();
    expect(calls).toEqual(['hospital-bayview-general', 'gas-ridge-fuel']);
    expect(items[0]!.label).toMatch(/^Teleport to /);
  });
});

describe('capacityLabel', () => {
  it('shows the Bag tier, the ride and the capacity they give', () => {
    expect(capacityLabel(2, 'bicycle', effectiveCapacity(2, 'bicycle'))).toBe('Bag 2 × bicycle → 3 slots, 25 kg');
    expect(capacityLabel(0, 'walk', effectiveCapacity(0, 'walk'))).toBe('Bag 0 × walk → 1 slot, 0 kg');
  });
});

describe('dev panel Economy folder (real MockChain)', () => {
  const T0 = 1_760_000_000_000;
  function setup() {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const clock = { t: T0, now() { return this.t; } };
    const chain = new MockChain(storage, economyConfig, clock);
    return { chain, clock, acts: economyActions(chain.dev, GAME_UNITS) };
  }

  it('+100,000 GAME lands in the balance', () => {
    const { chain, acts } = setup();
    const before = chain.balance();
    acts.addGame();
    expect(chain.balance()).toBe(before + 100_000 * GAME_UNITS);
  });

  it('a rate move over 20% is refused and the rate stays; a small one is applied', () => {
    const { chain, acts } = setup();
    const rate = chain.rate()!.usdPerGame;
    expect(acts.setRate(rate * 1.5)).toBe('Rate move over 20% refused');
    expect(chain.rate()!.usdPerGame).toBe(rate);
    expect(acts.setRate(rate * 1.1)).toBeNull();
    expect(chain.rate()!.usdPerGame).toBeCloseTo(rate * 1.1, 12);
  });

  it('Make rate stale ages the rate; Fail next transaction fails the next purchase', async () => {
    const { chain, clock, acts } = setup();
    acts.makeStale();
    expect(clock.t - chain.rate()!.updatedAt).toBeGreaterThanOrEqual(economyConfig.rate.maxAgeSeconds * 1000);
    expect(acts.setRate(economyConfig.mockChain.usdPerGame)).toBeNull();
    expect(clock.t - chain.rate()!.updatedAt).toBeLessThan(economyConfig.rate.maxAgeSeconds * 1000);
    acts.failNext();
    const tx = await chain.purchase('line.vehicle.1', Number.MAX_SAFE_INTEGER, clock.t);
    expect(tx.status).toBe('failed');
  });

  it('Confirm delay changes when a new purchase settles', async () => {
    const { chain, clock, acts } = setup();
    acts.setConfirmSeconds(10);
    await chain.purchase('line.vehicle.1', Number.MAX_SAFE_INTEGER, clock.t);
    chain.tick(clock.t + 9_999);
    expect(chain.history()[0]!.status).toBe('pending');
    chain.tick(clock.t + 10_000);
    expect(chain.history()[0]!.status).toBe('confirmed');
  });

  it('Vault (USD) and the tier sliders change vault() and ownership()', () => {
    const { chain, acts } = setup();
    acts.setVaultUsd(120);
    expect(chain.vault() * chain.rate()!.usdPerGame / GAME_UNITS).toBeCloseTo(120, 3);
    expect(acts.setTier('bag', 2)).toBe(true);
    expect(chain.ownership().lines.bag).toBe(2);
    acts.setTier('bag', 0);
    expect(chain.ownership().lines.bag).toBe(0);
  });

  it('Advance clock 1 day moves a lock one day closer', () => {
    const { chain, clock, acts } = setup();
    chain.lockGame(1000 * GAME_UNITS, clock.t);
    const end = chain.lock()!.unlocksAt;
    acts.advanceDay();
    expect(chain.lock()!.unlocksAt).toBe(end - 86_400_000);
  });
});

describe('Owned boxes', () => {
  const [t1, t2] = RIDE_TIERS.filter((t) => tierOfVehicle(t) >= 1).sort((a, b) => tierOfVehicle(a) - tierOfVehicle(b)) as [RideTier, RideTier];

  it('grant and revoke vehicle tiers on the real chain through vehicleTierAfter', () => {
    const chain = new MockChain(null, economyConfig, { now: () => 0 });
    const apply = (t: RideTier, on: boolean, riding: RideTier | null): boolean => {
      const next = vehicleTierAfter(chain.ownership().lines.vehicle, t, on, riding);
      if (next === null) return false;
      chain.dev.grantTier('vehicle', next);
      return true;
    };
    expect(apply(t2, true, null)).toBe(true);
    expect(chain.ownership().lines.vehicle).toBe(tierOfVehicle(t2)); // owning t2 owns the tiers below
    expect(apply(t2, false, null)).toBe(true);
    expect(chain.ownership().lines.vehicle).toBe(tierOfVehicle(t2) - 1);
    expect(rideOfTier(tierOfVehicle(t1))).toBe(t1);
  });

  it('refuses a revoke while riding that tier or a higher one, and locks that box', () => {
    const chain = new MockChain(null, economyConfig, { now: () => 0 });
    chain.dev.grantTier('vehicle', tierOfVehicle(t2));
    expect(vehicleTierAfter(tierOfVehicle(t2), t1, false, t2)).toBeNull();
    expect(vehicleTierAfter(tierOfVehicle(t2), t2, false, t2)).toBeNull();
    expect(vehicleTierAfter(tierOfVehicle(t2), t2, false, t1)).toBe(tierOfVehicle(t2) - 1);
    const boxes = ownedBoxStates((t) => tierOfVehicle(t) <= chain.ownership().lines.vehicle, t2);
    expect(boxes.find((b) => b.tier === t2)).toMatchObject({ owned: true, locked: true });
    expect(boxes.filter((b) => b.locked)).toHaveLength(1);
  });
});
