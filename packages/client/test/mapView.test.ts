import { describe, expect, test } from 'vitest';
import type { Vec3 } from '@dm/shared';
import { MapView } from '../src/ui/map/mapView';

const v = (x: number, z: number): Vec3 => ({ x, y: 0, z });
const VIEWPORT = { w: 1600, h: 900 };
const CFG = { minZoom: 1, maxZoom: 6 } as const;
const onScreen = (p: { x: number; y: number }): boolean => p.x >= 0 && p.x <= VIEWPORT.w && p.y >= 0 && p.y <= VIEWPORT.h;

describe('MapView', () => {
  test('fit shows the whole 1,200 m city: both corners on screen', () => {
    const view = new MapView(1200, VIEWPORT, CFG);
    view.zoomAt(3, { x: 100, y: 100 });
    view.fit();
    expect(view.zoom).toBe(1);
    expect(view.center).toEqual({ x: 600, z: 600 });
    const nw = view.toScreen(v(0, 0));
    const se = view.toScreen(v(1200, 1200));
    expect(onScreen(nw)).toBe(true);
    expect(onScreen(se)).toBe(true);
    // Zoom 1 fits the shorter side exactly, centred; north (-z) up, east (+x) right.
    expect(nw.y).toBeCloseTo(0);
    expect(se.y).toBeCloseTo(900);
    expect(nw.x).toBeCloseTo(350);
    expect(se.x).toBeCloseTo(1250);
    expect(view.toScreen(v(600, 600))).toEqual({ x: 800, y: 450 });
  });

  test('zoomAt keeps the world point under the cursor fixed', () => {
    const view = new MapView(1200, VIEWPORT, CFG);
    const cursor = { x: 1000, y: 300 };
    // The world point under the cursor at zoom 1.
    const s = 900 / 1200;
    const world = v(600 + (cursor.x - 800) / s, 600 + (cursor.y - 450) / s);
    expect(view.toScreen(world).x).toBeCloseTo(cursor.x);
    view.zoomAt(2, cursor);
    expect(view.zoom).toBe(2);
    const after = view.toScreen(world);
    expect(after.x).toBeCloseTo(cursor.x);
    expect(after.y).toBeCloseTo(cursor.y);
    view.zoomAt(1.2, { x: 200, y: 700 });
    const w2 = view.toScreen(world); // another zoom elsewhere moves it, but the point under the new cursor holds
    expect(w2.x).not.toBeCloseTo(cursor.x);
  });

  test('zoom is clamped to 1..maxZoom; pan never moves the map fully off screen', () => {
    const view = new MapView(1200, VIEWPORT, CFG);
    view.zoomAt(0.5, { x: 800, y: 450 });
    expect(view.zoom).toBe(1);
    for (let i = 0; i < 20; i++) view.zoomAt(1.2, { x: 800, y: 450 });
    expect(view.zoom).toBe(6);
    // Drag far in every direction: some of the map is always on screen (the view's centre stays on the map).
    for (const [dx, dy] of [
      [1e6, 0],
      [-1e6, 0],
      [0, 1e6],
      [0, -1e6],
      [1e6, 1e6],
    ] as const) {
      view.panBy(dx, dy);
      const nw = view.toScreen(v(0, 0));
      const se = view.toScreen(v(1200, 1200));
      const overlapsX = se.x > 0 && nw.x < VIEWPORT.w;
      const overlapsY = se.y > 0 && nw.y < VIEWPORT.h;
      expect(overlapsX && overlapsY, `${dx},${dy}`).toBe(true);
    }
    // Dragging right moves the map right (the view's centre goes west).
    view.fit();
    view.zoomAt(2, { x: 800, y: 450 });
    const before = view.toScreen(v(600, 600));
    view.panBy(50, -30);
    const after = view.toScreen(v(600, 600));
    expect(after.x - before.x).toBeCloseTo(50);
    expect(after.y - before.y).toBeCloseTo(-30);
  });

  test('a map centred on the origin (the greybox) fits with its own bounds', () => {
    const view = new MapView(400, VIEWPORT, CFG, { x: -200, z: -200 });
    expect(view.center).toEqual({ x: 0, z: 0 });
    expect(view.toScreen(v(-200, -200)).y).toBeCloseTo(0);
    expect(view.toScreen(v(200, 200)).y).toBeCloseTo(900);
  });
});
