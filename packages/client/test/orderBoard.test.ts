import { describe, expect, it } from 'vitest';
import type { Order } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { acceptBlockedReason, refreshGuardLeft } from '../src/ui/orderBoard';
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
