import { describe, expect, it } from 'vitest';
import { ordersConfig } from '../../src/config';
import { expressLimit, orderSteps, parLimit, scoreOrder, slotsFor } from '../../src/orders/rules';
import type { Modifier, Order, OrderType } from '../../src/orders/types';
import type { Band } from '../../src/world/distance';

function order(type: OrderType, band: Band | null, modifier: Modifier | null = null): Order {
  return {
    id: 'o1',
    type,
    modifier,
    steps: [],
    band,
    hubDistance: 100,
    routeDistance: 100,
    slots: slotsFor(modifier, ordersConfig),
    expressLimit: null,
    parLimit: 50,
  };
}
const ok = { onTime: true, intact: true, withinPar: false };
const bad = { onTime: false, intact: false, withinPar: false };

describe('scoreOrder', () => {
  it('base points/coins by band: short 1/10, medium 2/20, long 3/30, chain 4/40', () => {
    const cases: [Order, number, number][] = [
      [order('dropoff', 'short'), 1, 10],
      [order('pickup', 'medium'), 2, 20],
      [order('dropoff', 'long'), 3, 30],
      [order('chain', null), 4, 40],
    ];
    for (const [o, points, coins] of cases) {
      expect(scoreOrder(o, ok, ordersConfig)).toEqual({ points, coins, bonuses: [] });
    }
  });

  it('express on time adds +1/+10; late adds nothing', () => {
    const o = order('dropoff', 'short', 'express');
    expect(scoreOrder(o, { onTime: true, intact: true, withinPar: false }, ordersConfig)).toEqual({ points: 2, coins: 20, bonuses: ['express'] });
    expect(scoreOrder(o, { onTime: false, intact: true, withinPar: false }, ordersConfig)).toEqual({ points: 1, coins: 10, bonuses: [] });
  });

  it('fragile intact now adds +2/+20; broken adds nothing', () => {
    const o = order('pickup', 'long', 'fragile');
    expect(scoreOrder(o, { onTime: true, intact: true, withinPar: false }, ordersConfig)).toEqual({ points: 5, coins: 50, bonuses: ['fragile'] });
    expect(scoreOrder(o, { onTime: true, intact: false, withinPar: false }, ordersConfig)).toEqual({ points: 3, coins: 30, bonuses: [] });
  });

  it('within par adds +1/+10 on every type incl. chain; late adds nothing', () => {
    const cases: [Order, number, number][] = [
      [order('dropoff', 'short'), 1, 10],
      [order('pickup', 'medium'), 2, 20],
      [order('dropoff', 'long'), 3, 30],
      [order('chain', null), 4, 40],
    ];
    for (const [o, points, coins] of cases) {
      const base = { onTime: false, intact: false };
      expect(scoreOrder(o, { ...base, withinPar: true }, ordersConfig)).toEqual({ points: points + 1, coins: coins + 10, bonuses: ['par'] });
      expect(scoreOrder(o, { ...base, withinPar: false }, ordersConfig)).toEqual({ points, coins, bonuses: [] });
    }
  });

  it('express on time and within par earns both bonuses', () => {
    const o = order('dropoff', 'short', 'express');
    expect(scoreOrder(o, { onTime: true, intact: true, withinPar: true }, ordersConfig)).toEqual({
      points: 3, coins: 30, bonuses: ['express', 'par'],
    });
    // within par but late for express: par only
    expect(scoreOrder(o, { onTime: false, intact: true, withinPar: true }, ordersConfig)).toEqual({
      points: 2, coins: 20, bonuses: ['par'],
    });
  });

  it('heavy always adds +1/+10', () => {
    const o = order('dropoff', 'medium', 'heavy');
    expect(scoreOrder(o, ok, ordersConfig)).toEqual({ points: 3, coins: 30, bonuses: ['heavy'] });
    expect(scoreOrder(o, bad, ordersConfig)).toEqual({ points: 3, coins: 30, bonuses: ['heavy'] });
  });
});

describe('expressLimit', () => {
  it('uses distanceFactor x route / sprint speed + extra seconds', () => {
    expect(expressLimit(160, 8, ordersConfig)).toBeCloseTo(32, 9); // drop-off 160 m: 1.1 x 160 / 8 + 10
    expect(expressLimit(320, 8, ordersConfig)).toBeCloseTo(54, 9); // pick-up 160 m one-way
  });
});

describe('parLimit', () => {
  it('uses distanceFactor x route / sprint speed + extra seconds', () => {
    expect(parLimit(160, 8, ordersConfig)).toBe(36); // 160 / 8 x 1.3 + 10
    expect(parLimit(320, 8, ordersConfig)).toBe(62);
  });
});

describe('orderSteps', () => {
  it('dropoff [poi], pickup [poi, hub], chain [A, B, hub]', () => {
    expect(orderSteps('dropoff', ['a'])).toEqual([{ kind: 'poi', poiId: 'a' }]);
    expect(orderSteps('pickup', ['a'])).toEqual([{ kind: 'poi', poiId: 'a' }, { kind: 'hub' }]);
    expect(orderSteps('chain', ['a', 'b'])).toEqual([
      { kind: 'poi', poiId: 'a' },
      { kind: 'poi', poiId: 'b' },
      { kind: 'hub' },
    ]);
  });
});

describe('slotsFor', () => {
  it('heavy uses 2 slots; everything else uses 1', () => {
    expect(slotsFor('heavy', ordersConfig)).toBe(2);
    expect(slotsFor('express', ordersConfig)).toBe(1);
    expect(slotsFor('fragile', ordersConfig)).toBe(1);
    expect(slotsFor(null, ordersConfig)).toBe(1);
  });
});
