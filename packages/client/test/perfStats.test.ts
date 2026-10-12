import { describe, expect, it } from 'vitest';
import { routeAt, routeLength, summarize } from '../src/game/perf';

describe('summarize', () => {
  it('summarize([10×16.6, 1×40]) has p50 16.6, p99 40, frames 11', () => {
    const s = summarize([...Array<number>(10).fill(16.6), 40]);
    expect(s.p50).toBe(16.6);
    expect(s.p99).toBe(40);
    expect(s.frames).toBe(11);
    expect(s.max).toBe(40);
  });

  it('uses nearest-rank percentiles on unsorted input (and leaves the input alone)', () => {
    const times = Array.from({ length: 100 }, (_, i) => 100 - i); // 100 … 1
    const s = summarize(times);
    expect(s.p50).toBe(50);
    expect(s.p95).toBe(95);
    expect(s.p99).toBe(99);
    expect(s.max).toBe(100);
    expect(times[0]).toBe(100);
  });

  it('one frame is every percentile; no frames is all zeros', () => {
    expect(summarize([7])).toEqual({ p50: 7, p95: 7, p99: 7, max: 7, frames: 1 });
    expect(summarize([])).toEqual({ p50: 0, p95: 0, p99: 0, max: 0, frames: 0 });
  });
});

describe('routeAt', () => {
  const stop = (x: number, z: number, tx: number) => ({ feet: { x, y: 0, z }, target: { x: tx, y: 1, z: 0 } });
  const route = [stop(0, 0, 10), stop(30, 0, 20), stop(30, 40, 30)];

  it('moves along the first leg looking at its target', () => {
    const p = routeAt(route, 15);
    expect(p.feet).toEqual({ x: 15, y: 0, z: 0 });
    expect(p.target.x).toBe(10);
    expect(p.done).toBe(false);
  });

  it('carries on into the next leg with that leg\'s target', () => {
    const p = routeAt(route, 50);
    expect(p.feet).toEqual({ x: 30, y: 0, z: 20 });
    expect(p.target.x).toBe(20);
  });

  it('past the last stop it stays there and reports done', () => {
    const p = routeAt(route, 71);
    expect(p.feet).toEqual({ x: 30, y: 0, z: 40 });
    expect(p.done).toBe(true);
  });

  it('a one-stop route is done at once', () => {
    expect(routeAt([stop(5, 5, 0)], 0).done).toBe(true);
  });

  it('routeLength adds up the straight legs, heights included', () => {
    expect(routeLength(route)).toBe(70);
    expect(routeLength([{ feet: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } }, { feet: { x: 0, y: 3, z: 4 }, target: { x: 0, y: 0, z: 0 } }])).toBe(5);
  });
});
