import { describe, it, expect } from 'vitest';
import { mulberry32, pickWeighted } from '../../src/util/rng';

describe('rng', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(42),
      b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('mulberry32 values are in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const v = r();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });
  it('pickWeighted never picks zero-weight keys', () => {
    const r = mulberry32(3);
    for (let i = 0; i < 1000; i++) expect(pickWeighted(r, { a: 1, b: 0 })).toBe('a');
  });
  it('pickWeighted follows weights', () => {
    const r = mulberry32(5);
    let a = 0;
    for (let i = 0; i < 4000; i++) if (pickWeighted(r, { a: 3, b: 1 }) === 'a') a++;
    const share = a / 4000;
    expect(share).toBeGreaterThanOrEqual(0.7);
    expect(share).toBeLessThanOrEqual(0.8);
  });
  it('pickWeighted throws when all weights are zero', () => {
    expect(() => pickWeighted(mulberry32(1), { a: 0 })).toThrow();
  });
});
