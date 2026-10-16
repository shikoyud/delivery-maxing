import { expect, test } from 'vitest';
import { cityConfig, namesConfig, parseCityLayout } from '@dm/shared';
import { readCatalog } from '../../src/city/files';
import { generateLayout } from '../../src/city/generate';
import { stableStringify } from '../../src/city/stableJson';
import { REPO } from '../../src/nav/files';

const cat = readCatalog(REPO);
const layout = generateLayout(cityConfig, namesConfig, cat);

test('seed 1 twice gives byte-identical output; another seed does not', () => {
  const again = generateLayout(cityConfig, namesConfig, cat);
  expect(stableStringify(again)).toBe(stableStringify(layout));
  const other = generateLayout({ ...cityConfig, seed: 2 }, namesConfig, cat);
  expect(stableStringify(other)).not.toBe(stableStringify(layout));
});

test('the layout passes the schema and has more than 2,000 lots', () => {
  expect(() => parseCityLayout(JSON.parse(stableStringify(layout)))).not.toThrow();
  expect(layout.lots.length).toBeGreaterThan(2000);
  expect(layout.seed).toBe(1);
  expect(layout.levels).toEqual(cityConfig.levels);
  expect(layout.bands).toEqual(cityConfig.bands);
  expect(layout.orderRules).toEqual(cityConfig.orderRules);
});

test('11 cross streets per built level', () => {
  for (const lv of ['L1', 'L2', 'L3'] as const) {
    const { z0, z1 } = cityConfig.levels[lv];
    const cross = layout.roads.filter(
      (r) => r.kind === 'street' && r.rect.minZ === z0 + cityConfig.avenue && r.rect.maxZ === z1 && r.rect.maxX <= cityConfig.eastEdgeStreetX,
    );
    expect(cross).toHaveLength(11);
  }
});

test('ids are unique; lots name a known block; every lot has a fictional name and a unique address', () => {
  for (const key of ['lots', 'roads', 'blocks', 'areas'] as const) {
    const ids = layout[key].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  }
  const blocks = new Set(layout.blocks.map((b) => b.id));
  for (const l of layout.lots) {
    expect(blocks.has(l.block)).toBe(true);
    expect(l.name).not.toBe('');
    expect(l.name).not.toMatch(/^(mega|trop|missing)\//);
    expect(l.address).toMatch(/^\d+ \S.*$/);
  }
  const addresses = layout.lots.map((l) => l.address.replace(/, apt \d+$/, ''));
  expect(new Set(addresses).size).toBe(addresses.length);
  const names = layout.lots.map((l) => l.name);
  expect(new Set(names).size).toBe(names.length);
});

test('every lot sits inside its block and its level', () => {
  const blocks = new Map(layout.blocks.map((b) => [b.id, b]));
  for (const l of layout.lots) {
    const b = blocks.get(l.block)!;
    expect(l.rect.minX).toBeGreaterThanOrEqual(b.rect.minX);
    expect(l.rect.maxX).toBeLessThanOrEqual(b.rect.maxX);
    expect(l.rect.minZ).toBeGreaterThanOrEqual(b.rect.minZ);
    expect(l.rect.maxZ).toBeLessThanOrEqual(b.rect.maxZ);
    expect(l.level).toBe(b.level);
    expect(l.y).toBe(cityConfig.levels[l.level].y);
  }
});
