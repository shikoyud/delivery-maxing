import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CatalogIndex, expandGreybox, layoutToMap, parseCatalog, parseCityLayout, type GreyboxSource, type Vec3 } from '@dm/shared';
import catalogJson from '../../../map/catalog.json';
import cityJson from '../../../map/city.layout.json';
import greybox from '../../../map/greybox.json';
import { FUEL_ICON_COLOR, HOSPITAL_ICON_COLOR, VEHICLE_ICON_COLOR } from '../src/ui/minimap';
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

  describe('on the city', () => {
    const city = layoutToMap(parseCityLayout(cityJson), new CatalogIndex(parseCatalog(catalogJson)));
    const player = { x: 600, y: 10, z: 400 };
    const near = (r: { x: number; y: number; w: number; h: number }, c: { x: number; y: number }, d = 8) =>
      Math.abs(r.x + r.w / 2 - c.x) < d && Math.abs(r.y + r.h / 2 - c.y) < d;

    it('the layer draws 4 hospital markers and 6 fuel icons, over tinted levels and roads', () => {
      const rec = recordCanvases(dom.doc);
      const proj = MapProjection.forMap(city, 512);
      const app = createMapApp(city, proj);
      const layerRects = () => rec.rects.length;
      app.render(model(), player, 0);
      expect(layerRects()).toBeGreaterThan(0);
      expect(city.hospitals).toHaveLength(4);
      expect(city.gasStations).toHaveLength(6);
      // A cross is two bars: the horizontal ones count the hospitals.
      expect(rec.rects.filter((r) => r.style === HOSPITAL_ICON_COLOR && r.w > r.h)).toHaveLength(4);
      expect(rec.rects.filter((r) => r.style === FUEL_ICON_COLOR)).toHaveLength(6);
      for (const h of city.hospitals) {
        const c = proj.toCanvas(h.center);
        expect(rec.rects.some((r) => r.style === HOSPITAL_ICON_COLOR && near(r, c)), h.id).toBe(true);
      }
      // The levels are tinted: the ground of L1 (y 10) and L3 (y 38) differ in colour.
      const styles = new Set(rec.rects.map((r) => r.style));
      expect(styles.size).toBeGreaterThan(6);
      // A second render draws the layer again but builds it once.
      const before = rec.rects.length;
      app.render(model(), player, 0);
      expect(rec.rects.length - before).toBeLessThan(before);
    });

    it('a parked car draws a car glyph at its projected spot; a carried skateboard draws nothing', () => {
      const rec = recordCanvases(dom.doc);
      const proj = MapProjection.forMap(city, 512);
      const app = createMapApp(city, proj);
      const carAt = { x: 640, y: 10, z: 380 };
      app.render(model({ parked: [{ tier: 'car', position: carAt }] }), player, 0);
      const c = proj.toCanvas(carAt);
      const glyph = rec.rects.filter((r) => r.style === VEHICLE_ICON_COLOR);
      expect(glyph).toHaveLength(1);
      expect(near(glyph[0]!, c)).toBe(true);
      expect(glyph[0]!.w).toBeGreaterThan(glyph[0]!.h); // the car's body: wider than tall

      const rec2 = recordCanvases(dom.doc);
      const app2 = createMapApp(city, MapProjection.forMap(city, 512));
      app2.render(
        model({ garage: [{ tier: 'skateboard', status: 'carried', position: null, distance: null, fuel: null, summon: 'carried', readyIn: 0 }], parked: [] }),
        player,
        0,
      );
      expect(rec2.rects.some((r) => r.style === VEHICLE_ICON_COLOR)).toBe(false);
    });

    it('pans with the player: the player triangle is at the canvas centre', () => {
      const rec = recordCanvases(dom.doc);
      const proj = MapProjection.forMap(city, 512);
      const app = createMapApp(city, proj);
      app.render(model(), { x: 900, y: 2, z: 200 }, 0);
      expect(proj.toCanvas({ x: 900, y: 2, z: 200 })).toEqual({ x: 256, y: 256 });
      expect(rec.rects.length).toBeGreaterThan(0);
    });
  });
});
