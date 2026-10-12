import { describe, expect, it } from 'vitest';
import { SlotColorAssigner } from '../src/ui/slotColors';

describe('SlotColorAssigner (R29d)', () => {
  it('assigns the lowest free index at accept and keeps it while the order is active', () => {
    const a = new SlotColorAssigner();
    a.sync(['A', 'B', 'C']);
    expect([a.indexOf('A'), a.indexOf('B'), a.indexOf('C')]).toEqual([0, 1, 2]);
    // A completes: B and C keep their colours (not shifted by list position).
    a.sync(['B', 'C']);
    expect([a.indexOf('B'), a.indexOf('C')]).toEqual([1, 2]);
    // A new order takes the lowest free index (A's old 0).
    a.sync(['B', 'C', 'D']);
    expect(a.indexOf('D')).toBe(0);
    expect([a.indexOf('B'), a.indexOf('C')]).toEqual([1, 2]);
    a.sync(['C', 'D', 'E']);
    expect(a.indexOf('E')).toBe(1);
  });

  it('indexOf an unknown order is 0 and sync forgets removed orders', () => {
    const a = new SlotColorAssigner();
    expect(a.indexOf('nope')).toBe(0);
    a.sync(['A', 'B']);
    a.sync([]);
    a.sync(['C']);
    expect(a.indexOf('C')).toBe(0);
  });
});
