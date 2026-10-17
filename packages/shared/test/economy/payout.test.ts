import { expect, test } from 'vitest';
import { economyConfig, ordersConfig, type VehicleTier } from '../../src/config';
import { payoutRange, rollPayoutUsd } from '../../src/economy/payout';
import { maxPointsFor } from '../../src/orders/rules';
import type { Order } from '../../src/orders/types';

const TIERS: VehicleTier[] = ['walk', 'skateboard', 'bicycle', 'motorbike', 'car'];

test('a perfect car order with luck 1 rolls the top of the range; a worst one with luck 0 the bottom', () => {
  expect(rollPayoutUsd({ tier: 'car', points: 7, maxPoints: 7, luck: 1, boost: 1 }, economyConfig)).toBe(600_000);
  expect(rollPayoutUsd({ tier: 'car', points: 0, maxPoints: 7, luck: 0, boost: 1 }, economyConfig)).toBe(50_000);
});

test('quality weighs 0.6 and luck 0.4: half quality, half luck is the middle of the range', () => {
  const { minMicro, maxMicro } = payoutRange('motorbike', economyConfig);
  expect(rollPayoutUsd({ tier: 'motorbike', points: 3, maxPoints: 6, luck: 0.5, boost: 1 }, economyConfig)).toBe((minMicro + maxMicro) / 2);
  // all quality, no luck: 60% up the range; no quality, all luck: 40%
  expect(rollPayoutUsd({ tier: 'motorbike', points: 6, maxPoints: 6, luck: 0, boost: 1 }, economyConfig)).toBe(30_000 + 0.6 * 270_000);
  expect(rollPayoutUsd({ tier: 'motorbike', points: 0, maxPoints: 6, luck: 1, boost: 1 }, economyConfig)).toBe(30_000 + 0.4 * 270_000);
  // maxPoints 0 counts as quality 0; quality and luck are clamped to [0, 1]
  expect(rollPayoutUsd({ tier: 'walk', points: 0, maxPoints: 0, luck: 0, boost: 1 }, economyConfig)).toBe(5_000);
  expect(rollPayoutUsd({ tier: 'walk', points: 9, maxPoints: 7, luck: 2, boost: 1 }, economyConfig)).toBe(30_000);
});

test('the boost multiplies the roll; every tier’s minimum is above the tier below’s minimum and so is its maximum', () => {
  expect(rollPayoutUsd({ tier: 'car', points: 7, maxPoints: 7, luck: 1, boost: 1.3 }, economyConfig)).toBe(780_000);
  expect(rollPayoutUsd({ tier: 'bicycle', points: 0, maxPoints: 7, luck: 0, boost: 1.15 }, economyConfig)).toBe(23_000);
  expect(TIERS.map((t) => payoutRange(t, economyConfig))).toEqual([
    { minMicro: 5_000, maxMicro: 30_000 },
    { minMicro: 10_000, maxMicro: 60_000 },
    { minMicro: 20_000, maxMicro: 120_000 },
    { minMicro: 30_000, maxMicro: 300_000 },
    { minMicro: 50_000, maxMicro: 600_000 },
  ]);
  for (let i = 1; i < TIERS.length; i++) {
    const lo = payoutRange(TIERS[i - 1]!, economyConfig);
    const hi = payoutRange(TIERS[i]!, economyConfig);
    expect(hi.minMicro).toBeGreaterThan(lo.minMicro);
    expect(hi.maxMicro).toBeGreaterThan(lo.maxMicro);
  }
});

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1', kind: 'package', pickupPoiId: 'a', dropoffPoiId: 'b', item: 'parcel', weightKg: 30, weightClass: 'large',
  modifier: null, band: 'long', distance: 900, timeLimit: 150, expressLimit: null, ...over,
});

test('maxPointsFor: a long Fragile package of 30 kg (Large) is 3 × 2 + 1 (par) + 2 (fragile) = 9', () => {
  expect(maxPointsFor(order({ modifier: 'fragile' }), ordersConfig)).toBe(9);
});
