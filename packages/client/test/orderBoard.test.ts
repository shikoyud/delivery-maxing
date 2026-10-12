import { describe, expect, it } from 'vitest';
import { ordersConfig, type Order } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { acceptBlockedReason, cardBonusLines, cardFacts, refreshGuardLeft } from '../src/ui/orderBoard';
import { pointsText } from '../src/ui/hudModel';

const order = { slots: 1 } as Order;
const guard = clientConfig.ui.boardRefreshGuardSeconds;

describe('Order Board refresh guard (R28)', () => {
  it('boardRefreshGuardSeconds is configured (0.75 s)', () => {
    expect(guard).toBe(0.75);
  });

  it('refreshGuardLeft counts down from a refresh and is 0 with no refresh or after the window', () => {
    expect(refreshGuardLeft(null, 10, guard)).toBe(0);
    expect(refreshGuardLeft(10, 10, guard)).toBeCloseTo(guard, 9);
    expect(refreshGuardLeft(10, 10.5, guard)).toBeCloseTo(guard - 0.5, 9);
    expect(refreshGuardLeft(10, 10 + guard, guard)).toBe(0);
    expect(refreshGuardLeft(10, 20, guard)).toBe(0);
  });

  it('an accept inside the guard window is refused with a visible reason; outside it is allowed', () => {
    expect(acceptBlockedReason('ok', order, 0, refreshGuardLeft(10, 10.2, guard))).toBe('New orders · wait');
    expect(acceptBlockedReason('ok', order, 0, refreshGuardLeft(10, 11, guard))).toBeNull();
    expect(acceptBlockedReason('ok', order, 0)).toBeNull();
    // Other reasons still win (they are about the order, not the timing).
    expect(acceptBlockedReason('no_slots', order, 0, 0.5)).toBe('Needs 1 free slot');
  });
});

describe('points copy (R29b)', () => {
  it('"1 pt" and "N pts"', () => {
    expect(pointsText(1)).toBe('1 pt');
    expect(pointsText(2)).toBe('2 pts');
    expect(pointsText(0)).toBe('0 pts');
    expect(pointsText(-1)).toBe('-1 pts');
  });
});

describe('board card par (spec 3.2)', () => {
  const card = (over: Partial<Order>): Order =>
    ({ id: 'o', type: 'dropoff', modifier: null, band: 'short', routeDistance: 100, slots: 1, expressLimit: null, parLimit: 75, ...over }) as Order;

  it('shows the par time as m:ss among the facts', () => {
    expect(cardFacts(card({})).filter((f) => f.startsWith('Par'))).toEqual(['Par 1:15']);
    expect(cardFacts(card({ parLimit: 125.2 }))).toContain('Par 2:06');
  });

  it('lists the par bonus on its own line, from config', () => {
    const lines = cardBonusLines(card({}), ordersConfig).map((l) => l.text);
    expect(lines).toEqual([`+${pointsText(ordersConfig.points.withinPar)} · +${ordersConfig.coins.withinPar} coins within par`]);
    expect(lines[0]).toBe('+1 pt · +10 coins within par');
  });

  it('Express keeps its own line besides the par line; Fragile likewise; Heavy adds none', () => {
    const express = cardBonusLines(card({ modifier: 'express', expressLimit: 60 }), ordersConfig).map((l) => l.text);
    expect(express).toHaveLength(2);
    expect(express[0]).toMatch(/coins if on time$/);
    expect(express[1]).toMatch(/coins within par$/);
    expect(cardBonusLines(card({ modifier: 'fragile' }), ordersConfig)[0]!.text).toMatch(/coins if intact$/);
    expect(cardBonusLines(card({ modifier: 'heavy' }), ordersConfig)).toHaveLength(1);
  });
});
