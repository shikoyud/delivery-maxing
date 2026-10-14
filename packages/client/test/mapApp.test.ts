import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expandGreybox, type GreyboxSource, type Vec3 } from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { FUEL_ICON_COLOR } from '../src/ui/minimap';
import { createMapApp } from '../src/ui/phone/mapApp';
import { MapProjection } from '../src/ui/phone/mapProjection';
import { recordCanvases } from './canvasRecorder';
import { installFakeDom } from './fakeDom';
import { model, order } from './phoneFixtures';

const map = expandGreybox(greybox as GreyboxSource);
const v = (x: number, z: number): Vec3 => ({ x, y: 0, z });

describe('Map app', () => {
  let dom: ReturnType<typeof installFakeDom>;
  beforeEach(() => {
    dom = installFakeDom();
  });
  afterEach(() => dom.restore());

  it('Map app draws the car route solid and the foot leg dashed', () => {
    const rec = recordCanvases(dom.doc);
    const proj = new MapProjection(map.size, 512);
    const app = createMapApp(map, proj);
    const drive = [v(0, 0), v(40, 0), v(40, -60)];
    const footLeg: [Vec3, Vec3] = [v(40, -60), v(52, -60)];
    app.render(model({ orders: [order('a', { target: v(52, -60), route: { drive, footLeg, length: 112 } })] }), v(0, 0), 0);
    const px = (ps: Vec3[]) => ps.map((p) => proj.toCanvas(p));
    const solid = rec.strokes.find((s) => s.points.length === 3);
    expect(solid).toBeDefined();
    expect(solid!.points).toEqual(px(drive));
    expect(solid!.dash).toEqual([]);
    const dashed = rec.strokes.find((s) => s.dash.length > 0);
    expect(dashed).toBeDefined();
    expect(dashed!.points).toEqual(px(footLeg));
    // No straight player-to-door line when the order has a route.
    expect(rec.strokes.some((s) => s.points.length === 2 && s.dash.length === 0)).toBe(false);
  });

  it('without a route the stop gets a straight line; gas stations show as fuel icons', () => {
    const rec = recordCanvases(dom.doc);
    const proj = new MapProjection(map.size, 512);
    const app = createMapApp(map, proj);
    app.render(model({ orders: [order('a', { target: v(52, -60) })] }), v(0, 0), 0);
    expect(rec.strokes.some((s) => s.points.length === 2 && s.dash.length === 0)).toBe(true);
    expect(map.gasStations.length).toBeGreaterThan(0);
    for (const g of map.gasStations) {
      const c = proj.toCanvas(g.position);
      const hit = rec.rects.some((r) => r.style === FUEL_ICON_COLOR && Math.abs(r.x + r.w / 2 - c.x) < 8 && Math.abs(r.y + r.h / 2 - c.y) < 8);
      expect(hit, g.id).toBe(true);
    }
  });
});
