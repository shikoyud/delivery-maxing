import { describe, expect, it } from 'vitest';
import { vec3 } from '../../src/math/vec3';
import { navDistanceTable, reachablePois, streetDistanceTable } from '../../src/orders/distanceTable';
import type { PoiTableFile } from '../../src/world/poiTable';
import { emptyMap } from '../world/fixtures';

const file: PoiTableFile = {
  version: 1,
  pois: [
    { id: 'a', district: 'downtown', elevated: false, fromHub: 100, toHub: 110, reachable: true },
    { id: 'b', district: 'harbor', elevated: true, fromHub: 200, toHub: 190, reachable: true },
    { id: 'c', district: 'suburbs', elevated: false, fromHub: -1, toHub: 50, reachable: false },
  ],
  between: [
    [0, 120, -1],
    [130, 0, 40],
    [-1, 45, 0],
  ],
  unreachable: [{ id: 'c', reason: 'no path from the HUB' }],
};

describe('navDistanceTable', () => {
  it('reads fromHub, toHub and between (row = from, column = to) by POI id', () => {
    const t = navDistanceTable(file);
    expect(t.fromHub('a')).toBe(100);
    expect(t.toHub('a')).toBe(110);
    expect(t.fromHub('b')).toBe(200);
    expect(t.toHub('b')).toBe(190);
    expect(t.between('a', 'b')).toBe(120);
    expect(t.between('b', 'a')).toBe(130);
    expect(t.between('b', 'c')).toBe(40);
    expect(t.toHub('c')).toBe(50);
  });

  it('navDistanceTable throws on an unknown id and on -1', () => {
    const t = navDistanceTable(file);
    expect(() => t.fromHub('nope')).toThrow(/nope/);
    expect(() => t.toHub('nope')).toThrow(/nope/);
    expect(() => t.between('a', 'nope')).toThrow(/nope/);
    expect(() => t.between('nope', 'a')).toThrow(/nope/);
    expect(() => t.fromHub('c')).toThrow(/c/);
    expect(() => t.between('a', 'c')).toThrow(/a.*c/);
  });
});

describe('streetDistanceTable', () => {
  it('is SP1 |dx|+|dz| from map.hub.center, both ways, and between POIs', () => {
    const map = emptyMap();
    map.hub.center = vec3(10, 0, 10);
    map.pois = [
      { id: 'p1', position: vec3(10, 5, 110), district: 'downtown', kind: 'door' },
      { id: 'p2', position: vec3(-290, 0, 10), district: 'suburbs', kind: 'counter' },
    ];
    const t = streetDistanceTable(map);
    expect(t.fromHub('p1')).toBe(100);
    expect(t.toHub('p1')).toBe(100);
    expect(t.fromHub('p2')).toBe(300);
    expect(t.between('p1', 'p2')).toBe(400);
    expect(t.between('p2', 'p1')).toBe(400);
    expect(() => t.fromHub('nope')).toThrow(/nope/);
    expect(() => t.between('p1', 'nope')).toThrow(/nope/);
  });
});

describe('reachablePois', () => {
  it('keeps only the map POIs the table marks reachable (spec §5.3 Reachability)', () => {
    const map = emptyMap();
    map.pois = ['a', 'b', 'c'].map((id) => ({ id, position: vec3(0, 0, 0), district: 'downtown', kind: 'door' }));
    expect(reachablePois(map, file).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('throws for a map POI the table does not list', () => {
    const map = emptyMap();
    map.pois = [{ id: 'x', position: vec3(0, 0, 0), district: 'downtown', kind: 'door' }];
    expect(() => reachablePois(map, file)).toThrow(/x/);
  });
});
