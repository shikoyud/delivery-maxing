import { describe, expect, it } from 'vitest';
import { ordersConfig } from '../../src/config';
import { addEpochPoints, epochIdAt, penalizeEpoch } from '../../src/orders/epoch';

const S = ordersConfig.epoch.seconds;
/** A wall-clock instant inside epoch `id` (ms). */
const inEpoch = (id: number, offsetSeconds = 0): number => (id * S + offsetSeconds) * 1000;

describe('local epoch points (spec §9.4 step 1: 10-minute UTC windows)', () => {
  it('600 s windows: 599.999 s and 600 s are different epochs', () => {
    expect(S).toBe(600);
    expect(epochIdAt(0, S)).toBe(0);
    expect(epochIdAt(599_999, S)).toBe(0);
    expect(epochIdAt(600_000, S)).toBe(1);
    // Aligned to wall-clock boundaries: 12:00:00 UTC starts a window, 12:09:59.999 is still in it.
    const noon = Date.UTC(2026, 9, 13, 12, 0, 0);
    expect(epochIdAt(noon + 599_999, S)).toBe(epochIdAt(noon, S));
    expect(epochIdAt(noon + 600_000, S)).toBe(epochIdAt(noon, S) + 1);
  });

  it('adding within an epoch accumulates', () => {
    const e = addEpochPoints({ id: 7, points: 2 }, inEpoch(7, 30), S, 3);
    expect(e).toEqual({ id: 7, points: 5 });
  });

  it('adding across a boundary resets to n', () => {
    expect(addEpochPoints({ id: 7, points: 9 }, inEpoch(8), S, 3)).toEqual({ id: 8, points: 3 });
    // Several windows later, too; adding 0 just rolls over.
    expect(addEpochPoints({ id: 7, points: 9 }, inEpoch(12, 5), S, 0)).toEqual({ id: 12, points: 0 });
  });

  it('penalize never goes below 0', () => {
    expect(penalizeEpoch({ id: 7, points: 3 }, inEpoch(7, 1), S, 1)).toEqual({ id: 7, points: 2 });
    expect(penalizeEpoch({ id: 7, points: 0 }, inEpoch(7, 1), S, 1)).toEqual({ id: 7, points: 0 });
    expect(penalizeEpoch({ id: 7, points: 1 }, inEpoch(7, 1), S, 5)).toEqual({ id: 7, points: 0 });
    // A settled epoch's points are never touched: the penalty lands on the new (empty) epoch.
    expect(penalizeEpoch({ id: 7, points: 4 }, inEpoch(8), S, 1)).toEqual({ id: 8, points: 0 });
  });

  it('returns a new object (the input is not mutated)', () => {
    const e = { id: 7, points: 2 };
    addEpochPoints(e, inEpoch(7), S, 1);
    penalizeEpoch(e, inEpoch(7), S, 1);
    expect(e).toEqual({ id: 7, points: 2 });
  });
});
