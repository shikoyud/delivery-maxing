import { describe, expect, it } from 'vitest';
import { namesConfig } from '../../src/config';
import { vec3 } from '../../src/math/vec3';
import { dropoffText, itemPhrase, orderText, pickupText } from '../../src/orders/orderText';
import type { Order } from '../../src/orders/types';
import { mulberry32 } from '../../src/util/rng';
import type { Poi } from '../../src/world/mapTypes';

const poi = (over: Partial<Poi>): Poi => ({
  id: 'p',
  position: vec3(0, 10, 0),
  district: 'market',
  kind: 'door',
  name: 'Crumb & Co. Bakery',
  address: '14 Market St',
  roles: ['foodPickup'],
  ...over,
});
const bakery = poi({});
const market = poi({ name: 'Bayside Market', address: '3 Harbor Rd', roles: ['packagePickup'] });
const flat = poi({ name: 'J. Hartley', address: '7 Uptown Ave, apt 4', roles: ['dropoffFood', 'dropoffPackage'] });

describe('pickupText / dropoffText', () => {
  it('a bakery pickup is the spec sentence', () => {
    expect(pickupText(bakery, '2 baguettes and a sourdough', null)).toBe('Pick up 2 baguettes and a sourdough from Crumb & Co. Bakery, 14 Market St.');
  });

  it('a package adds its weight after the item', () => {
    expect(pickupText(market, 'a grocery box', 12)).toBe('Pick up a grocery box (12 kg) from Bayside Market, 3 Harbor Rd.');
  });

  it('the dropoff names the address, not the household', () => {
    expect(dropoffText(flat)).toBe('Deliver to 7 Uptown Ave, apt 4');
    expect(dropoffText(flat)).not.toContain('Hartley');
  });

  it('a POI without an address (the greybox) falls back to its name', () => {
    const corner = poi({ name: 'Corner Deli', address: undefined });
    expect(pickupText(corner, 'noodles', null)).toBe('Pick up noodles from Corner Deli.');
    expect(dropoffText(poi({ name: 'Harbor Books', address: undefined }))).toBe('Deliver to Harbor Books');
  });

  it('orderText puts an order into both lines', () => {
    const order = { kind: 'package', item: 'a grocery box', weightKg: 12 } as Order;
    expect(orderText(order, market, flat)).toEqual({
      pickup: 'Pick up a grocery box (12 kg) from Bayside Market, 3 Harbor Rd.',
      dropoff: 'Deliver to 7 Uptown Ave, apt 4',
    });
  });
});

describe('itemPhrase', () => {
  it('turns "bread and pastries" into a quantity and concrete items', () => {
    const rng = mulberry32(3);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = itemPhrase('bread and pastries', rng);
      seen.add(s);
      expect(s).toMatch(/^(a|an|\d+) [a-z ]+( and (a|an|\d+) [a-z ]+)?$/);
      expect(s).not.toContain('bread and pastries');
    }
    expect(seen.size).toBeGreaterThan(5);
    expect([...seen].some((s) => s.includes(' and '))).toBe(true);
  });

  it('every pickup phrase of the catalog has a table entry with a singular and plural for each item', () => {
    for (const [phrase, entry] of Object.entries(namesConfig.items.phrases)) {
      expect(entry.things.length, phrase).toBeGreaterThan(0);
      expect(entry.max, phrase).toBeGreaterThanOrEqual(1);
      for (const t of entry.things) expect(t, phrase).toHaveLength(2);
    }
    for (const p of ['bread and pastries', 'grocery boxes', 'car parts', 'pizzas', 'snacks and drinks', 'industrial goods', 'rail parcels']) {
      expect(namesConfig.items.phrases[p], p).toBeDefined();
    }
  });

  it('a phrase with no table entry is used as it is, without drawing from the rng', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    expect(itemPhrase('noodles', rng)).toBe('noodles');
    expect(calls).toBe(0);
  });

  it('never yields a catalog id', () => {
    const rng = mulberry32(9);
    for (const p of Object.keys(namesConfig.items.phrases)) {
      for (let i = 0; i < 20; i++) expect(itemPhrase(p, rng)).not.toMatch(/^(mega|trop|missing)\//);
    }
  });
});
