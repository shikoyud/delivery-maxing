import { expect, test } from 'vitest';
import { cosmeticsConfig, economyConfig } from '../../src/config';
import { fuelCanCoins, nextTier, shopCatalog, shopItem, tierOfVehicle, vehicleOfTier } from '../../src/economy/catalog';
import { LINES, type LineTiers, type ShopItem } from '../../src/economy/types';

const catalog = shopCatalog(economyConfig, cosmeticsConfig);
const none: LineTiers = { vehicle: 0, bag: 0, shoes: 0, dispatcher: 0 };

test('the catalog has 4 + 5 + 5 + 5 line tiers, 6 premium skins, the lockout skip, 24 cosmetics and the fuel can', () => {
  const count = (k: ShopItem['kind']): number => catalog.filter((i) => i.kind === k).length;
  expect(LINES).toEqual(['vehicle', 'bag', 'shoes', 'dispatcher']);
  for (const [line, n] of [['vehicle', 4], ['bag', 5], ['shoes', 5], ['dispatcher', 5]] as const) {
    expect(catalog.filter((i) => i.kind === 'line' && i.line === line).map((i) => i.id)).toEqual(
      Array.from({ length: n }, (_, k) => `line.${line}.${k + 1}`),
    );
  }
  expect(count('skin')).toBe(6);
  expect(count('lockoutSkip')).toBe(1);
  expect(count('cosmetic')).toBe(24);
  expect(count('fuelCan')).toBe(1);
  expect(catalog).toHaveLength(19 + 6 + 1 + 24 + 1);
  expect(new Set(catalog.map((i) => i.id)).size).toBe(catalog.length);
  // USD as micro-USD integers; GAME items in GAME, cosmetics and the fuel can in Coins
  expect(shopItem('line.vehicle.4')).toMatchObject({ kind: 'line', line: 'vehicle', tier: 4, currency: 'game', usdMicro: 25_000_000, label: 'Car' });
  expect(shopItem('line.bag.5')).toMatchObject({ usdMicro: 15_000_000 });
  expect(shopItem('skin.vehicle.neon')).toMatchObject({ kind: 'skin', currency: 'game', usdMicro: 3_000_000, slot: 'vehicle', finish: 'neon' });
  expect(shopItem('lockoutSkip')).toMatchObject({ currency: 'game', usdMicro: 500_000 });
  // a can is 1.5 × the pump price of a quarter tank (Decision 5): motorbike 15, car 30; the item shows the cheapest
  expect([fuelCanCoins('motorbike'), fuelCanCoins('car'), fuelCanCoins('bicycle')]).toEqual([15, 30, null]);
  expect(shopItem('fuelCan')).toMatchObject({ currency: 'coins', coins: 15 });
  for (const slot of ['outfit', 'vehicle', 'bag', 'phone'] as const) {
    const items = catalog.filter((i) => i.kind === 'cosmetic' && i.slot === slot);
    expect(items).toHaveLength(6);
    // the first (the SP5 look) is free; the rest cost 50–200 Coins
    expect(items[0]).toMatchObject({ currency: 'coins', coins: 0 });
    for (const i of items.slice(1)) {
      if (i.currency !== 'coins') throw new Error(i.id);
      expect(i.coins).toBeGreaterThanOrEqual(50);
      expect(i.coins).toBeLessThanOrEqual(200);
    }
  }
  expect(cosmeticsConfig.outfit[0]!.color).toBe(0x1f9e93);
  expect(() => shopItem('line.vehicle.5')).toThrow();
  expect(() => shopItem('nope')).toThrow();
});

test('nextTier returns the next unowned tier of a line, null when maxed; prices rise along every line', () => {
  expect(nextTier('vehicle', none)?.id).toBe('line.vehicle.1');
  expect(nextTier('bag', { ...none, bag: 2 })?.id).toBe('line.bag.3');
  expect(nextTier('vehicle', { ...none, vehicle: 4 })).toBeNull();
  expect(nextTier('dispatcher', { ...none, dispatcher: 5 })).toBeNull();
  for (const line of LINES) {
    const prices = catalog.flatMap((i) => (i.kind === 'line' && i.line === line ? [i.usdMicro] : []));
    for (let k = 1; k < prices.length; k++) expect(prices[k]).toBeGreaterThan(prices[k - 1]!);
  }
  expect(vehicleOfTier(0)).toBe('walk');
  expect(vehicleOfTier(1)).toBe('skateboard');
  expect(vehicleOfTier(4)).toBe('car');
  expect(tierOfVehicle('motorbike')).toBe(3);
  expect(() => vehicleOfTier(5)).toThrow();
});

test('cosmetic ids are pinned: renaming an item in cosmetics.json changes its id and orphans saved wardrobes', () => {
  expect(catalog.filter((i) => i.kind === 'cosmetic').map((i) => i.id)).toEqual([
    'cosmetic.outfit.teal', 'cosmetic.outfit.coral', 'cosmetic.outfit.sky', 'cosmetic.outfit.lime', 'cosmetic.outfit.plum', 'cosmetic.outfit.charcoal',
    'cosmetic.vehicle.factory', 'cosmetic.vehicle.cherry', 'cosmetic.vehicle.ocean', 'cosmetic.vehicle.sunflower', 'cosmetic.vehicle.mint', 'cosmetic.vehicle.midnight',
    'cosmetic.bag.cardboard', 'cosmetic.bag.crimson', 'cosmetic.bag.navy', 'cosmetic.bag.olive', 'cosmetic.bag.lavender', 'cosmetic.bag.snow',
    'cosmetic.phone.slate', 'cosmetic.phone.rose', 'cosmetic.phone.aqua', 'cosmetic.phone.lemon', 'cosmetic.phone.grape', 'cosmetic.phone.pearl',
  ]);
});

const BRANDS = ['amazon', 'grab', 'shopee', 'uber', 'doordash', 'deliveroo', 'postmates', 'gojek', 'foodpanda', 'shopeefood', 'uber eats', 'swiggy', 'zomato', 'just eat', 'fedex', 'ups', 'dhl', 'pump.fun', 'solana'];

test('no label names a real brand (the §16 list)', () => {
  const names = [...catalog.map((i) => i.label), ...(['outfit', 'vehicle', 'bag', 'phone'] as const).flatMap((s) => cosmeticsConfig[s].map((c) => c.name))];
  for (const label of names) {
    for (const b of BRANDS) expect(new RegExp(`\\b${b.replace('.', '\\.')}\\b`, 'i').test(label), `${label} names ${b}`).toBe(false);
  }
});
