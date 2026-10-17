import { describe, expect, it } from 'vitest';
import { CatalogIndex, expandGreybox, layoutToMap, parseCatalog, parseCityLayout, type GreyboxSource } from '@dm/shared';
import catalogJson from '../../../map/catalog.json';
import cityJson from '../../../map/city.layout.json';
import greybox from '../../../map/greybox.json';
import { MapProjection } from '../src/ui/map/mapProjection';

describe('MapProjection', () => {
  const p = new MapProjection(400, 200);

  it('maps the map centre to the layer centre', () => {
    expect(p.toLayer({ x: 0, y: 5, z: 0 })).toEqual({ x: 100, y: 100 });
  });

  it('puts north (-z) up and east (+x) right', () => {
    const north = p.toLayer({ x: 0, y: 0, z: -100 });
    const east = p.toLayer({ x: 100, y: 0, z: 0 });
    expect(north.y).toBeLessThan(100);
    expect(north.x).toBe(100);
    expect(east.x).toBeGreaterThan(100);
    expect(east.y).toBe(100);
  });

  it('maps the corners to the layer edges', () => {
    expect(p.toLayer({ x: -200, y: 0, z: -200 })).toEqual({ x: 0, y: 0 });
    expect(p.toLayer({ x: 200, y: 0, z: 200 })).toEqual({ x: 200, y: 200 });
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

  it('the greybox layer is centred on the origin', () => {
    const p = MapProjection.forMap(greyboxMap);
    const h = greyboxMap.size / 2;
    expect(p.toLayer({ x: -h, y: 0, z: -h })).toEqual({ x: 0, y: 0 });
    expect(p.toLayer({ x: h, y: 0, z: h })).toEqual({ x: p.layerPx, y: p.layerPx });
  });

  it('the city layer spans x, z in [0, size] at min(4096, size × 3) px', () => {
    const p = MapProjection.forMap(city);
    expect(p.layerPx).toBe(Math.min(4096, city.size * 3));
    expect(p.scale).toBeCloseTo(p.layerPx / city.size);
    expect(p.toLayer({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0 });
    expect(p.toLayer({ x: city.size, y: 0, z: city.size }).x).toBeCloseTo(p.layerPx);
    expect(p.min).toEqual({ x: 0, z: 0 });
  });
});
