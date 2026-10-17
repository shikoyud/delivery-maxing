import { describe, it, expect } from 'vitest';
import { mulberry32, pickIndexWeighted, pickWeighted } from '../../src/util/rng';

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
  it('pickIndexWeighted: one draw, the index whose cumulative weight passes it; zero weights never picked', () => {
    const at = (x: number) => () => x;
    // weights 1, 0, 3 over a total of 4: [0, 0.25) -> 0, [0.25, 1) -> 2
    expect(pickIndexWeighted(at(0), [1, 0, 3])).toBe(0);
    expect(pickIndexWeighted(at(0.249), [1, 0, 3])).toBe(0);
    expect(pickIndexWeighted(at(0.25), [1, 0, 3])).toBe(2);
    expect(pickIndexWeighted(at(0.999), [1, 0, 3])).toBe(2);
    expect(pickIndexWeighted(at(0.999), [2, 1, 0])).toBe(1);
    let draws = 0;
    pickIndexWeighted(() => (draws++, 0.5), [1, 1]);
    expect(draws).toBe(1);
    expect(() => pickIndexWeighted(at(0.5), [0, 0])).toThrow();
  });
  it('pickWeighted draws the same as pickIndexWeighted over its keys', () => {
    const a = mulberry32(9);
    const b = mulberry32(9);
    const keys = ['x', 'y', 'z'] as const;
    for (let i = 0; i < 200; i++) expect(pickWeighted(a, { x: 2, y: 0, z: 5 })).toBe(keys[pickIndexWeighted(b, [2, 0, 5])]);
  });
});
