import { describe, expect, it } from 'vitest';
import { CatalogIndex, expandGreybox, layoutToMap, parseCatalog, parseCityLayout, type GreyboxSource } from '@dm/shared';
import catalogJson from '../../../map/catalog.json';
import cityJson from '../../../map/city.layout.json';
import greybox from '../../../map/greybox.json';
import { clientConfig } from '../src/clientConfig';
import { MapProjection } from '../src/ui/phone/mapProjection';

describe('MapProjection', () => {
  const p = new MapProjection(400, 200);

  it('maps the map centre to the canvas centre', () => {
    expect(p.toCanvas({ x: 0, y: 5, z: 0 })).toEqual({ x: 100, y: 100 });
  });

  it('puts north (-z) up and east (+x) right', () => {
    const north = p.toCanvas({ x: 0, y: 0, z: -100 });
    const east = p.toCanvas({ x: 100, y: 0, z: 0 });
    expect(north.y).toBeLessThan(100);
    expect(north.x).toBe(100);
    expect(east.x).toBeGreaterThan(100);
    expect(east.y).toBe(100);
  });

  it('maps the corners to the canvas edges', () => {
    expect(p.toCanvas({ x: -200, y: 0, z: -200 })).toEqual({ x: 0, y: 0 });
    expect(p.toCanvas({ x: 200, y: 0, z: 200 })).toEqual({ x: 200, y: 200 });
  });

  it('scales lengths uniformly and exposes a draw order', () => {
    expect(p.scale).toBe(0.5);
    expect(p.drawOrder[0]).toBe('ground');
    expect(p.drawOrder[p.drawOrder.length - 1]).toBe('player');
  });
});

describe('MapProjection.forMap', () => {
  const greyboxMap = expandGreybox(greybox as GreyboxSource);
  const city = layoutToMap(parseCityLayout(cityJson), new CatalogIndex(parseCatalog(catalogJson)));

  it('the greybox projection maps the map corners to the canvas corners (whole-map scale, no pan)', () => {
    const p = MapProjection.forMap(greyboxMap, 512);
    const h = greyboxMap.size / 2;
    expect(p.panned).toBe(false);
    expect(p.toCanvas({ x: -h, y: 0, z: -h })).toEqual({ x: 0, y: 0 });
    expect(p.toCanvas({ x: h, y: 0, z: h })).toEqual({ x: 512, y: 512 });
    p.pan({ x: 100, y: 0, z: 50 }); // ignored: the whole greybox fits
    expect(p.toCanvas({ x: h, y: 0, z: h })).toEqual({ x: 512, y: 512 });
  });

  it('the city projection maps a point 250 m east of the player to the right edge of the canvas', () => {
    const p = MapProjection.forMap(city, 512);
    expect(p.panned).toBe(true);
    expect(p.scale).toBeCloseTo(512 / clientConfig.ui.mapWindowMeters);
    expect(clientConfig.ui.mapWindowMeters).toBe(500);
    const player = { x: 600, y: 10, z: 400 };
    p.pan(player);
    expect(p.toCanvas(player)).toEqual({ x: 256, y: 256 });
    const east = p.toCanvas({ x: player.x + 250, y: 10, z: player.z });
    expect(east.x).toBeCloseTo(512);
    expect(east.y).toBeCloseTo(256);
    expect(p.toCanvas({ x: player.x, y: 0, z: player.z - 250 }).y).toBeCloseTo(0); // north up
  });

  it('the whole-map layer is drawn at the window scale and offset by the pan', () => {
    const p = MapProjection.forMap(city, 512);
    p.pan({ x: 600, y: 10, z: 400 });
    expect(p.layerPx).toBe(Math.ceil(city.size * p.scale));
    const q = { x: 700, y: 0, z: 300 };
    const l = p.toLayer(q);
    const c = p.toCanvas(q);
    expect(l.x - p.layerOffset.x).toBeCloseTo(c.x);
    expect(l.y - p.layerOffset.y).toBeCloseTo(c.y);
    expect(p.toLayer({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0 }); // the city spans x, z in [0, size]
  });
});
