import { describe, expect, it } from 'vitest';
import { bandFor, buildPoiTable, streetDistance } from '../../src/world/distance';
import { ordersConfig } from '../../src/config';
import { vec3 } from '../../src/math/vec3';
import { emptyMap } from './fixtures';

const b = ordersConfig.bands;

describe('distance', () => {
  it('streetDistance is Manhattan on x/z and ignores y', () => {
    expect(streetDistance(vec3(0, 0, 0), vec3(30, 5, -40))).toBe(70);
  });

  it('bandFor boundaries', () => {
    expect(bandFor(149.9, b)).toBe('short');
    expect(bandFor(150, b)).toBe('medium');
    expect(bandFor(350, b)).toBe('medium');
    expect(bandFor(350.01, b)).toBe('long');
  });

  it('buildPoiTable measures from map.hub.center', () => {
    const map = emptyMap();
    map.hub.center = vec3(10, 0, 10);
    map.pois = [
      { id: 'p1', position: vec3(10, 0, 110), district: 'downtown', kind: 'door' },
      { id: 'p2', position: vec3(210, 0, 110), district: 'harbor', kind: 'mailbox' },
      { id: 'p3', position: vec3(-300, 0, 10), district: 'suburbs', kind: 'counter' },
    ];
    const t = buildPoiTable(map, streetDistance, b);
    expect(t.map((i) => [i.poi.id, i.hubDistance, i.band])).toEqual([
      ['p1', 100, 'short'], ['p2', 300, 'medium'], ['p3', 310, 'medium'],
    ]);
  });
});
