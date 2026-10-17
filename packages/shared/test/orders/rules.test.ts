import { describe, expect, it } from 'vitest';
import { ordersConfig } from '../../src/config';
import { expressLimit, maxPointsFor, scoreOrder, timeLimit, weightClassFor } from '../../src/orders/rules';
import type { Order } from '../../src/orders/types';

const wc = ordersConfig.weightClasses;

function order(over: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    kind: 'package',
    pickupPoiId: 'a',
    dropoffPoiId: 'b',
    item: 'parcel',
    weightKg: 30,
    weightClass: 'large',
    modifier: null,
    band: 'short',
    distance: 100,
    timeLimit: 50,
    expressLimit: null,
    ...over,
  };
}
const all = { inTime: true, expressOnTime: true, intact: true };

describe('weightClassFor', () => {
  it('splits at 10, 25, 50', () => {
    expect(weightClassFor(10, wc)).toBe('small');
    expect(weightClassFor(10.5, wc)).toBe('medium');
    expect(weightClassFor(25, wc)).toBe('medium');
    expect(weightClassFor(50, wc)).toBe('large');
    expect(weightClassFor(51, wc)).toBe('bulky');
  });
});

describe('time limits', () => {
  it('food hot = d/8*1.3+20, package par = d/8*1.3+10, express = d/8*1.1+10', () => {
    expect(timeLimit('food', 400, ordersConfig)).toBeCloseTo(85, 9);
    expect(timeLimit('package', 400, ordersConfig)).toBeCloseTo(75, 9);
    expect(expressLimit(400, ordersConfig)).toBeCloseTo(65, 9);
  });
});

describe('scoreOrder', () => {
  it('medium bulky package in time: (2*3)=6 pts + 1 par = 7 pts, 60+10 coins', () => {
    const o = order({ band: 'medium', weightClass: 'bulky', weightKg: 100 });
    expect(scoreOrder(o, { inTime: true, expressOnTime: false, intact: false }, ordersConfig)).toEqual({
      points: 7, coins: 70, bonuses: ['par'],
    });
  });
  it('weight multiplier rounds: short medium-class package = round(1*1.5) = 2 pts', () => {
    const o = order({ band: 'short', weightClass: 'medium', weightKg: 20 });
    expect(scoreOrder(o, { inTime: false, expressOnTime: false, intact: false }, ordersConfig)).toEqual({
      points: 2, coins: 15, bonuses: [],
    });
  });
  it('food scores hot bonus, never express or fragile', () => {
    const o = order({ kind: 'food', weightKg: null, weightClass: null, modifier: 'express', band: 'long' });
    expect(scoreOrder(o, all, ordersConfig)).toEqual({ points: 4, coins: 40, bonuses: ['hot'] });
    const late = { inTime: false, expressOnTime: false, intact: true };
    expect(scoreOrder({ ...o, modifier: 'fragile' }, late, ordersConfig)).toEqual({ points: 3, coins: 30, bonuses: [] });
  });
  it('package express on time and fragile intact add their bonuses', () => {
    const ex = order({ weightClass: 'small', modifier: 'express' });
    expect(scoreOrder(ex, all, ordersConfig)).toEqual({ points: 3, coins: 30, bonuses: ['par', 'express'] });
    expect(scoreOrder(ex, { ...all, expressOnTime: false }, ordersConfig).bonuses).toEqual(['par']);
    const fr = order({ weightClass: 'small', modifier: 'fragile' });
    expect(scoreOrder(fr, all, ordersConfig)).toEqual({ points: 4, coins: 40, bonuses: ['par', 'fragile'] });
    expect(scoreOrder(fr, { ...all, intact: false }, ordersConfig).bonuses).toEqual(['par']);
  });
});

describe('maxPointsFor', () => {
  it('is what scoreOrder gives the perfect delivery, for every kind and modifier', () => {
    const cases: Order[] = [
      order({ band: 'long', modifier: 'fragile' }),
      order({ modifier: 'express', weightClass: 'medium', weightKg: 20 }),
      order({ band: 'medium', weightClass: 'bulky', weightKg: 100 }),
      order({ kind: 'food', weightKg: null, weightClass: null, modifier: 'express', band: 'medium' }),
    ];
    expect(cases.map((o) => maxPointsFor(o, ordersConfig))).toEqual([9, 4, 7, 3]);
    for (const o of cases) expect(maxPointsFor(o, ordersConfig)).toBe(scoreOrder(o, all, ordersConfig).points);
  });
});
