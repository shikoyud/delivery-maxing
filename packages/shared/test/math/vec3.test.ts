import { describe, expect, it } from 'vitest';
import {
  add, clampHorizontal, closestOnSegment, dot, horizontalLength, length, lerpVec3, normalize, scale, sub, vec3,
} from '../../src/math/vec3';

describe('vec3', () => {
  it('basic ops', () => {
    expect(add(vec3(1, 2, 3), vec3(4, 5, 6))).toEqual(vec3(5, 7, 9));
    expect(sub(vec3(4, 5, 6), vec3(1, 2, 3))).toEqual(vec3(3, 3, 3));
    expect(scale(vec3(1, 2, 3), 2)).toEqual(vec3(2, 4, 6));
    expect(dot(vec3(1, 2, 3), vec3(4, 5, 6))).toBe(32);
    expect(length(vec3(2, 3, 6))).toBe(7);
    expect(horizontalLength(vec3(3, 100, 4))).toBe(5);
    expect(lerpVec3(vec3(0, 0, 0), vec3(10, 20, 30), 0.5)).toEqual(vec3(5, 10, 15));
  });
  it('normalize gives unit length and zero stays zero', () => {
    expect(length(normalize(vec3(3, 4, 12)))).toBeCloseTo(1, 12);
    expect(normalize(vec3(0, 0, 0))).toEqual(vec3(0, 0, 0));
  });
  it('clampHorizontal caps x/z length and keeps y', () => {
    const c = clampHorizontal(vec3(30, 5, 40), 10);
    expect(c.x).toBeCloseTo(6, 12);
    expect(c.y).toBe(5);
    expect(c.z).toBeCloseTo(8, 12);
    expect(clampHorizontal(vec3(3, 1, 4), 10)).toEqual(vec3(3, 1, 4));
  });
  it('closestOnSegment projects, and clamps to the ends', () => {
    const a = vec3(0, 0, 0);
    const b = vec3(10, 0, 0);
    const mid = closestOnSegment(vec3(4, 3, 0), a, b);
    expect(mid.s).toBeCloseTo(4, 12);
    expect(mid.point).toEqual(vec3(4, 0, 0));
    expect(mid.dist).toBeCloseTo(3, 12);
    const past = closestOnSegment(vec3(15, 0, 0), a, b);
    expect(past.s).toBeCloseTo(10, 12);
    expect(past.point).toEqual(b);
    expect(past.dist).toBeCloseTo(5, 12);
    const before = closestOnSegment(vec3(-2, 0, 0), a, b);
    expect(before.s).toBe(0);
    expect(before.point).toEqual(a);
  });
  it('closestOnSegment handles a degenerate segment', () => {
    const r = closestOnSegment(vec3(1, 0, 0), vec3(0, 0, 0), vec3(0, 0, 0));
    expect(r.s).toBe(0);
    expect(r.dist).toBe(1);
  });
});
