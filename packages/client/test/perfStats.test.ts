import { describe, expect, it } from 'vitest';
import { legSeconds, PerfRecorder, summarize, viewpointAt, type FrameRender } from '../src/game/perf';

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

describe('viewpointAt', () => {
  const stop = (x: number, z: number, tx: number, tz: number) => ({ feet: { x, y: 7, z }, target: { x: tx, y: 1, z: tz } });
  // Three viewpoints; a 30 s run gives each 10 s.
  const route = [stop(0, 0, 100, 0), stop(500, 500, 500, 600), stop(-300, 0, -300, 4)];

  it('splits the run equally across the route entries', () => {
    expect(viewpointAt(route, 12, 30, 0).index).toBe(0);
    expect(viewpointAt(route, 12, 30, 9.99).index).toBe(0);
    expect(viewpointAt(route, 12, 30, 10).index).toBe(1);
    expect(viewpointAt(route, 12, 30, 19.99).index).toBe(1);
    expect(viewpointAt(route, 12, 30, 25).index).toBe(2);
    expect(viewpointAt(route, 12, 30, 30).index).toBe(2);
  });

  it('starts each viewpoint at its own feet and glides toward its target at the speed, keeping the height', () => {
    const start = viewpointAt(route, 12, 30, 10);
    expect(start.feet).toEqual({ x: 500, y: 7, z: 500 });
    expect(start.target).toEqual(route[1]!.target);
    const later = viewpointAt(route, 12, 30, 12.5); // 2.5 s into entry 1: 30 m toward +z
    expect(later.feet.x).toBeCloseTo(500, 9);
    expect(later.feet.y).toBe(7);
    expect(later.feet.z).toBeCloseTo(530, 9);
    expect(later.done).toBe(false);
  });

  it('never glides past the target', () => {
    const p = viewpointAt(route, 12, 30, 29); // entry 2's target is 4 m away
    expect(p.feet.x).toBeCloseTo(-300, 9);
    expect(p.feet.z).toBeCloseTo(4, 9);
  });

  it('is done at the end of the run and stays on the last entry', () => {
    const end = viewpointAt(route, 12, 30, 30);
    expect(end.done).toBe(true);
    expect(viewpointAt(route, 12, 30, 45)).toEqual(end);
  });

  it('shares are seconds / entries (60 s over 8 entries is 7.5 s each)', () => {
    expect(legSeconds(60, 8)).toBe(7.5);
    expect(legSeconds(5, 8)).toBe(0.625);
  });
});

describe('PerfRecorder', () => {
  const render = (calls = 10, triangles = 100, cityMs = 1) => () => ({ calls, triangles, cityMs });
  // 2 viewpoints, 1 s warm-up, 2 frames skipped after each teleport; frames of 20 ms.
  const make = () => new PerfRecorder(2, 1000, 2);

  it('leaves out the warm-up and the first 2 frames after each teleport, and splits the rest per viewpoint', () => {
    const rec = make();
    // Each call is { viewpoint placed, ms until the next call, what the renderer reports about the frame before }.
    const calls: { vp: number; ms: number; r: () => FrameRender }[] = [
      ...Array.from({ length: 50 }, () => ({ vp: 0, ms: 20, r: render() })), // calls 0-49: t = 0 … 980, the warm-up
      ...Array.from({ length: 11 }, () => ({ vp: 0, ms: 20, r: render(12, 500, 2) })), // calls 50-60 on viewpoint 0
      { vp: 1, ms: 20, r: render(12, 500, 2) }, // call 61: teleports, but reports viewpoint 0's last frame
      { vp: 1, ms: 20, r: render(99, 9999, 99) }, // call 62: the frame right after the jump (skipped)
      { vp: 1, ms: 40, r: render(99, 9999, 99) }, // call 63: the second frame after the jump (skipped)
      ...Array.from({ length: 6 }, () => ({ vp: 1, ms: 40, r: render(30, 700, 5) })), // calls 64-69: 40 ms frames
    ];
    let t = 0;
    for (const c of calls) {
      rec.frame(t, c.vp, c.r);
      t += c.ms;
    }
    const r = rec.result();
    // Call 50 (t = 1000) still reports a warm-up frame (it began at 980); calls 51-61 report counted frames of 20 ms.
    expect(r.perViewpoint[0]).toEqual({ p50: 20, p95: 20, p99: 20, max: 20, frames: 11 });
    // Calls 64-69 report six 40 ms frames; calls 62 and 63 (the jump) are left out.
    expect(r.perViewpoint[1]).toEqual({ p50: 40, p95: 40, p99: 40, max: 40, frames: 6 });
    expect(r.overall).toEqual({ p50: 20, p95: 40, p99: 40, max: 40, frames: 17 });
    expect(rec.measured).toBe(17);
    expect(r.maxCalls).toBe(30);
    expect(r.maxTriangles).toBe(700);
    expect(r.cityUpdateP95).toBe(5);
  });

  it('counts nothing before the warm-up has passed, and a viewpoint with no frames summarises to zeros', () => {
    const rec = make();
    for (let i = 0; i < 10; i++) rec.frame(i * 20, 0, render());
    const r = rec.result();
    expect(r.overall.frames).toBe(0);
    expect(r.perViewpoint[1]).toEqual({ p50: 0, p95: 0, p99: 0, max: 0, frames: 0 });
    expect(rec.measured).toBe(0);
  });
});
