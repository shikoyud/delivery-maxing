import { describe, expect, it } from 'vitest';
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
