import { expect, test } from 'vitest';
import { cityConfig as cfg, namesConfig as names } from '@dm/shared';
import { blockColumns, crossStreetXs, districtOf, levelRoads } from '../../src/city/frame';

test('cross streets every 108 m at x = 12 + 108k', () => {
  const xs = crossStreetXs(cfg);
  expect(xs).toHaveLength(11);
  expect(xs).toEqual(Array.from({ length: 11 }, (_, k) => 12 + 108 * k));
  expect(xs[0]).toBe(12);
  expect(xs[1]).toBe(120);
  expect(xs.at(-1)).toBe(1092);
});

test('block columns run between the cross streets, the last one to the east edge street', () => {
  const cols = blockColumns(cfg);
  expect(cols).toHaveLength(11);
  expect(cols[0]).toEqual({ k: 0, x0: 18, x1: 114 });
  expect(cols[1]).toEqual({ k: 1, x0: 126, x1: 222 });
  expect(cols.at(-1)).toEqual({ k: 10, x0: 1098, x1: 1188 });
});

test('districts by level and x (city design section 4)', () => {
  expect(districtOf('L1', 200, cfg)).toBe('industrial');
  expect(districtOf('L1', 500, cfg)).toBe('downtown');
  expect(districtOf('L1', 900, cfg)).toBe('market');
  expect(districtOf('L2', 200, cfg)).toBe('rowhouses');
  expect(districtOf('L2', 600, cfg)).toBe('highstreet');
  expect(districtOf('L2', 1000, cfg)).toBe('apartments');
  expect(districtOf('L3', 600, cfg)).toBe('uptown');
  expect(districtOf('ridge', 600, cfg)).toBe('hillcrest');
  expect(districtOf('L0', 100, cfg)).toBe('docks');
  expect(districtOf('L0', 600, cfg)).toBe('beach');
  expect(districtOf('L0', 1000, cfg)).toBe('harbor');
});

test('L1 roads: the avenue, 11 cross streets, the east edge street and the top street', () => {
  const roads = levelRoads('L1', cfg, names);
  const avenues = roads.filter((r) => r.kind === 'avenue');
  expect(avenues).toHaveLength(1);
  expect(avenues[0]!.rect).toEqual({ minX: 0, minZ: 310, maxX: 1200, maxZ: 325 });
  expect(avenues[0]!.name).toBe('Bayview Avenue');
  const ns = roads.filter((r) => r.kind === 'street' && r.rect.minZ === 325 && r.rect.maxZ === 560);
  expect(ns).toHaveLength(12);
  for (const r of ns) expect(r.rect.maxX - r.rect.minX).toBe(12);
  const cross = ns.filter((r) => r.rect.minX < cfg.eastEdgeStreetX);
  expect(cross.map((r) => (r.rect.minX + r.rect.maxX) / 2)).toEqual(crossStreetXs(cfg));
  expect(cross.map((r) => r.name)).toEqual(names.streets.cross);
  expect(ns.filter((r) => r.rect.minX === 1188 && r.rect.maxX === 1200)).toHaveLength(1);
  const top = roads.filter((r) => r.kind === 'street' && r.rect.minZ === 548 && r.rect.maxZ === 560);
  expect(top).toHaveLength(1);
  expect(top[0]!.rect.minX).toBe(0);
  expect(top[0]!.rect.maxX).toBe(1200);
  expect(roads.every((r) => r.y === 10)).toBe(true);
  expect(new Set(roads.map((r) => r.id)).size).toBe(roads.length);
});

test('each built level names its avenue from the names config', () => {
  expect(levelRoads('L2', cfg, names).find((r) => r.kind === 'avenue')!.name).toBe('Midtown Avenue');
  expect(levelRoads('L3', cfg, names).find((r) => r.kind === 'avenue')!.name).toBe('Uptown Avenue');
});
