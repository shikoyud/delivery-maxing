import { expect, test } from 'vitest';
import { economyConfig } from '../../src/config';
import { shopItem } from '../../src/economy/catalog';
import { splitPurchase } from '../../src/economy/split';

test('every line sends 20% (floor) to the vault; skins and the skip burn everything', () => {
  for (const id of ['line.vehicle.3', 'line.bag.1', 'line.shoes.5', 'line.dispatcher.2']) {
    expect(splitPurchase(shopItem(id), 50_000_000_000, economyConfig)).toEqual({ burned: 40_000_000_000, vault: 10_000_000_000 });
    expect(splitPurchase(shopItem(id), 41_666_666_667, economyConfig)).toEqual({ burned: 33_333_333_334, vault: 8_333_333_333 });
  }
  expect(splitPurchase(shopItem('skin.outfit.gold'), 12_500_000_000, economyConfig)).toEqual({ burned: 12_500_000_000, vault: 0 });
  expect(splitPurchase(shopItem('lockoutSkip'), 2_083_333_334, economyConfig)).toEqual({ burned: 2_083_333_334, vault: 0 });
  expect(() => splitPurchase(shopItem('fuelCan'), 15, economyConfig)).toThrow();
});
