import { afterEach, beforeEach, describe, expect, it, test } from 'vitest';
import { CatalogIndex, expandGreybox, layoutToMap, parseCatalog, parseCityLayout, type GreyboxSource, type MapData, type Vec3 } from '@dm/shared';
import catalogJson from '../../../map/catalog.json';
import cityJson from '../../../map/city.layout.json';
import greybox from '../../../map/greybox.json';
import { clientConfig } from '../src/clientConfig';
import { MapScreen, wheelZoomFactor } from '../src/ui/map/MapScreen';
import { FUEL_ICON_COLOR, HOSPITAL_ICON_COLOR, VEHICLE_ICON_COLOR } from '../src/ui/minimap';
import { recordCanvases } from './canvasRecorder';
import { fakeEvent, installFakeDom, type FakeEvent } from './fakeDom';
import { model, order } from './phoneFixtures';

const greyboxMap = expandGreybox(greybox as GreyboxSource);
const city = layoutToMap(parseCityLayout(cityJson), new CatalogIndex(parseCatalog(catalogJson)));
const v = (x: number, z: number): Vec3 => ({ x, y: 0, z });
const W = 1600;
const H = 900;
const near = (r: { x: number; y: number; w: number; h: number }, c: { x: number; y: number }, d = 8) =>
  Math.abs(r.x + r.w / 2 - c.x) < d && Math.abs(r.y + r.h / 2 - c.y) < d;

describe('MapScreen', () => {
  let dom: ReturnType<typeof installFakeDom>;
  let closed: number;
  beforeEach(() => {
    dom = installFakeDom();
    Object.assign(dom.host, { clientWidth: W, clientHeight: H });
    closed = 0;
  });
  afterEach(() => dom.restore());
  const screenFor = (map: MapData): MapScreen =>
    new MapScreen(dom.asHost, map, () => 0, { closeCodes: ['Escape', 'KeyM'], closed: () => void closed++ });

  test('opens fitted to the whole city, not a window around the player (playtest item 2)', () => {
    const rec = recordCanvases(dom.doc);
    const screen = screenFor(city);
    expect(screen.isOpen).toBe(false);
    screen.open();
    expect(screen.isOpen).toBe(true);
    expect(dom.host.byClass('map-screen')[0]!.hidden).toBe(false);
    const player = { x: 100, y: 0, z: 100 };
    screen.render(model(), player, 0);
    expect(screen.view.zoom).toBe(1);
    expect(screen.view.center).toEqual({ x: city.size / 2, z: city.size / 2 });
    const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;
    for (const h of city.hospitals) {
      const c = screen.view.toScreen(h.center);
      expect(inside(c), h.id).toBe(true);
      expect(rec.rects.some((r) => r.style === HOSPITAL_ICON_COLOR && near(r, c)), h.id).toBe(true);
    }
    for (const g of city.gasStations) {
      const c = screen.view.toScreen(g.position);
      expect(inside(c), g.id).toBe(true);
      expect(rec.rects.some((r) => r.style === FUEL_ICON_COLOR && near(r, c)), g.id).toBe(true);
    }
    // Zoomed in and closed, the next open shows the whole city again.
    screen.view.zoomAt(4, { x: 100, y: 100 });
    screen.close();
    expect(closed).toBe(1);
    expect(dom.host.byClass('map-screen')[0]!.hidden).toBe(true);
    screen.open();
    expect(screen.view.zoom).toBe(1);
  });

  test('wheelZoomFactor: a notch in pixels, lines or a page is one step; smaller deltas a fraction', () => {
    const cfg = clientConfig.ui.map;
    expect(wheelZoomFactor(-cfg.wheelPixelsPerStep, 0, cfg)).toBeCloseTo(cfg.wheelStep);
    expect(wheelZoomFactor(cfg.wheelPixelsPerStep, 0, cfg)).toBeCloseTo(1 / cfg.wheelStep);
    expect(wheelZoomFactor(-cfg.wheelLinesPerStep, 1, cfg)).toBeCloseTo(cfg.wheelStep);
    expect(wheelZoomFactor(-1, 2, cfg)).toBeCloseTo(cfg.wheelStep);
    expect(wheelZoomFactor(-cfg.wheelPixelsPerStep / 4, 0, cfg)).toBeCloseTo(cfg.wheelStep ** 0.25);
    expect(wheelZoomFactor(-5000, 0, cfg)).toBeCloseTo(cfg.wheelStep);
  });

  test('M typed in a text field does not close the map; Escape does', () => {
    const screen = screenFor(city);
    screen.open();
    const field = { tagName: 'INPUT' } as unknown as FakeEvent['target'];
    dom.doc.dispatchEvent(fakeEvent('keydown', { code: 'KeyM', target: field }));
    expect(screen.isOpen).toBe(true);
    dom.doc.dispatchEvent(fakeEvent('keydown', { code: 'Escape', target: field }));
    expect(screen.isOpen).toBe(false);
  });

  test('the legend lists You, Orders, Offers, Hospitals, Gas stations, Your vehicles', () => {
    screenFor(city);
    const items = dom.host.byClass('map-legend-item').map((e) => e.textContent);
    expect(items).toEqual(['You', 'Orders', 'Offers', 'Hospitals', 'Gas stations', 'Your vehicles']);
  });

  it('the wheel zooms toward the cursor by ui.map.wheelStep; a drag pans; Esc and M close it', () => {
    recordCanvases(dom.doc);
    const screen = screenFor(city);
    screen.open();
    screen.render(model(), v(600, 600), 0);
    const canvas = dom.host.byClass('map-screen-canvas')[0]!;
    const wheel = (deltaY: number): FakeEvent => ({ ...fakeEvent('wheel'), deltaY, clientX: 1000, clientY: 300 }) as FakeEvent;
    const under = screen.view.toWorld({ x: 1000, y: 300 });
    canvas.dispatchEvent(wheel(-100));
    expect(screen.view.zoom).toBeCloseTo(clientConfig.ui.map.wheelStep);
    const p = screen.view.toScreen({ x: under.x, y: 0, z: under.z });
    expect(p.x).toBeCloseTo(1000);
    expect(p.y).toBeCloseTo(300);
    canvas.dispatchEvent(wheel(100));
    expect(screen.view.zoom).toBeCloseTo(1);
    // A trackpad's small deltas zoom by a fraction of a step; a huge delta by one step at most.
    for (let i = 0; i < 10; i++) canvas.dispatchEvent(wheel(-10));
    expect(screen.view.zoom).toBeCloseTo(clientConfig.ui.map.wheelStep);
    canvas.dispatchEvent(wheel(-1000));
    expect(screen.view.zoom).toBeCloseTo(clientConfig.ui.map.wheelStep ** 2);
    const before = screen.view.toScreen(v(600, 600));
    canvas.dispatchEvent({ ...fakeEvent('mousedown'), button: 0, clientX: 500, clientY: 500 } as FakeEvent);
    dom.doc.dispatchEvent({ ...fakeEvent('mousemove'), clientX: 540, clientY: 470 } as FakeEvent);
    dom.doc.dispatchEvent({ ...fakeEvent('mouseup'), button: 0 } as FakeEvent);
    dom.doc.dispatchEvent({ ...fakeEvent('mousemove'), clientX: 900, clientY: 900 } as FakeEvent); // released: no pan
    const after = screen.view.toScreen(v(600, 600));
    expect(after.x - before.x).toBeCloseTo(40);
    expect(after.y - before.y).toBeCloseTo(-30);

    const esc = fakeEvent('keydown', { code: 'Escape' });
    dom.doc.dispatchEvent(esc);
    expect(screen.isOpen).toBe(false);
    expect(closed).toBe(1);
    expect(esc.propagationStopped).toBe(true);
    screen.open();
    dom.doc.dispatchEvent(fakeEvent('keydown', { code: 'KeyM' }));
    expect(screen.isOpen).toBe(false);
    expect(closed).toBe(2);
    // Closed, the keys pass through to the game (M opens it there).
    const m = fakeEvent('keydown', { code: 'KeyM' });
    dom.doc.dispatchEvent(m);
    expect(m.propagationStopped).toBe(false);
  });

  it('draws the car route solid and the foot leg dashed', () => {
    const rec = recordCanvases(dom.doc);
    const screen = screenFor(greyboxMap);
    screen.open();
    const drive = [v(0, 0), v(40, 0), v(40, -60)];
    const footLeg: [Vec3, Vec3] = [v(40, -60), v(52, -60)];
    screen.render(model({ orders: [order('a', { target: v(52, -60), route: { drive, footLeg, length: 112 } })] }), v(0, 0), 0);
    const px = (ps: Vec3[]) => ps.map((p) => screen.view.toScreen(p));
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
    const screen = screenFor(greyboxMap);
    screen.open();
    screen.render(model({ orders: [order('a', { target: v(52, -60) })] }), v(0, 0), 0);
    expect(rec.strokes.some((s) => s.points.length === 2 && s.dash.length === 0)).toBe(true);
    expect(greyboxMap.gasStations.length).toBeGreaterThan(0);
    for (const g of greyboxMap.gasStations) {
      const c = screen.view.toScreen(g.position);
      const hit = rec.rects.some((r) => r.style === FUEL_ICON_COLOR && near(r, c));
      expect(hit, g.id).toBe(true);
    }
  });

  it('closed, render draws nothing', () => {
    const rec = recordCanvases(dom.doc);
    const screen = screenFor(city);
    screen.render(model(), v(600, 600), 0);
    expect(rec.rects).toHaveLength(0);
  });

  describe('on the city', () => {
    const player = { x: 600, y: 10, z: 400 };

    it('draws 4 hospital markers and 6 fuel icons over tinted levels and roads; the layer is built once at min(4096, size × 3) px', () => {
      const rec = recordCanvases(dom.doc);
      const screen = screenFor(city);
      screen.open();
      screen.render(model(), player, 0);
      expect(rec.rects.length).toBeGreaterThan(0);
      expect(city.hospitals).toHaveLength(4);
      expect(city.gasStations).toHaveLength(6);
      // A cross is two bars: the horizontal ones count the hospitals.
      expect(rec.rects.filter((r) => r.style === HOSPITAL_ICON_COLOR && r.w > r.h)).toHaveLength(4);
      expect(rec.rects.filter((r) => r.style === FUEL_ICON_COLOR)).toHaveLength(6);
      // The levels are tinted: the ground of L1 (y 10) and L3 (y 38) differ in colour.
      const styles = new Set(rec.rects.map((r) => r.style));
      expect(styles.size).toBeGreaterThan(6);
      expect(screen.layerPx).toBe(Math.min(4096, city.size * 3));
      // A second render draws the markers again but builds the layer once.
      const before = rec.rects.length;
      screen.render(model(), player, 0);
      expect(rec.rects.length - before).toBeLessThan(before);
    });

    it('markers keep their pixel size at every zoom', () => {
      const rec = recordCanvases(dom.doc);
      const screen = screenFor(city);
      screen.open();
      screen.render(model(), player, 0);
      const crossAt = () => rec.rects.filter((r) => r.style === HOSPITAL_ICON_COLOR && r.w > r.h).at(-1)!.w;
      const w1 = crossAt();
      screen.view.zoomAt(clientConfig.ui.map.maxZoom, { x: W / 2, y: H / 2 });
      screen.render(model(), player, 0);
      expect(crossAt()).toBe(w1);
    });

    it('a parked car draws a car glyph at its projected spot; a carried skateboard draws nothing', () => {
      const rec = recordCanvases(dom.doc);
      const screen = screenFor(city);
      screen.open();
      const carAt = { x: 640, y: 10, z: 380 };
      screen.render(model({ parked: [{ tier: 'car', position: carAt }] }), player, 0);
      const c = screen.view.toScreen(carAt);
      const glyph = rec.rects.filter((r) => r.style === VEHICLE_ICON_COLOR);
      expect(glyph).toHaveLength(1);
      expect(near(glyph[0]!, c)).toBe(true);
      expect(glyph[0]!.w).toBeGreaterThan(glyph[0]!.h); // the car's body: wider than tall

      const rec2 = recordCanvases(dom.doc);
      const screen2 = screenFor(city);
      screen2.open();
      screen2.render(
        model({ garage: [{ tier: 'skateboard', status: 'carried', position: null, distance: null, fuel: null, summon: 'carried', readyIn: 0, owned: true, active: false, fuelText: null, range: '' }], parked: [] }),
        player,
        0,
      );
      expect(rec2.rects.some((r) => r.style === VEHICLE_ICON_COLOR)).toBe(false);
    });
  });
});
