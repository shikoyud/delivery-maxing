import { expect, test } from 'vitest';
import { cityConfig as cfg, lotSize, mulberry32, type Rect } from '@dm/shared';
import { fillBlock, levelBlocks, type BlockPlan } from '../../src/city/blocks';
import { readCatalog } from '../../src/city/files';
import { PALETTES } from '../../src/city/palettes';
import { REPO } from '../../src/nav/files';

const cat = readCatalog(REPO);
const EPS = 1e-6;
const overlaps = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;

const byColumn = (blocks: BlockPlan[]): Map<number, BlockPlan[]> => {
  const m = new Map<number, BlockPlan[]>();
  for (const b of blocks) m.set(b.k, [...(m.get(b.k) ?? []), b]);
  for (const col of m.values()) col.sort((a, b) => a.row - b.row);
  return m;
};

test('L1 rows start at the avenue and are 48 m deep downtown and 30 m elsewhere, the remainder in the last row', () => {
  const blocks = levelBlocks('L1', cfg);
  const cols = byColumn(blocks);
  expect(cols.size).toBe(11);
  for (const col of cols.values()) {
    expect(col[0]!.rect.minZ).toBe(325);
    expect(col.at(-1)!.rect.maxZ).toBe(548);
    for (let i = 0; i < col.length; i++) {
      const b = col[i]!;
      expect(b.row).toBe(i);
      if (i < col.length - 1) {
        expect(b.rect.maxZ - b.rect.minZ).toBe(b.district === 'downtown' ? 48 : 30);
        expect(col[i + 1]!.rect.minZ - b.rect.maxZ).toBe(cfg.street);
      } else {
        expect(b.rect.maxZ - b.rect.minZ).toBeGreaterThanOrEqual(30);
      }
    }
  }
  expect(blocks.some((b) => b.district === 'downtown')).toBe(true);
  expect(blocks.filter((b) => b.district === 'downtown' && b.rect.maxZ - b.rect.minZ === 48).every((b) => !b.alley)).toBe(true);
  expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  expect(blocks[0]!.id).toBe('block-L1-0-0');
});

test('every third block is open in Uptown, never in Downtown or Market', () => {
  const up = levelBlocks('L3', cfg);
  expect(up.every((b) => b.district === 'uptown')).toBe(true);
  for (const b of up) expect(b.open !== null).toBe((b.k + b.row) % 3 === 0);
  expect(up.filter((b) => b.open).length).toBeGreaterThan(5);
  expect(new Set(up.filter((b) => b.open).map((b) => b.open))).toEqual(new Set(['park', 'sports', 'parking', 'plaza']));
  const l1 = levelBlocks('L1', cfg);
  expect(l1.filter((b) => b.district !== 'industrial').every((b) => b.open === null)).toBe(true);
});

test('fillBlock of a market block: two rows facing the streets, an alley between, lots sized by the catalog', () => {
  const block = levelBlocks('L1', cfg).find((b) => b.district === 'market' && b.alley && b.rect.maxZ - b.rect.minZ === 30)!;
  const { lots, roads, areas } = fillBlock(block, PALETTES.market, mulberry32(7), cat, cfg);
  expect(areas).toEqual([]);
  expect(roads).toHaveLength(1);
  const alley = roads[0]!;
  expect(alley.kind).toBe('alley');
  expect(alley.rect.maxZ - alley.rect.minZ).toBe(cfg.alley);
  expect(alley.rect.minX).toBe(block.rect.minX);
  expect(alley.rect.maxX).toBe(block.rect.maxX);
  const bottom = lots.filter((l) => l.rect.minZ === block.rect.minZ);
  const top = lots.filter((l) => l.rect.maxZ === block.rect.maxZ);
  expect(bottom.length).toBeGreaterThan(5);
  expect(top.length).toBeGreaterThan(5);
  expect(bottom.length + top.length).toBe(lots.length);
  expect(bottom.every((l) => l.facing === 'S')).toBe(true);
  expect(top.every((l) => l.facing === 'N')).toBe(true);
  for (const l of lots) {
    const size = lotSize(cat.get(l.asset));
    expect(l.rect.maxX - l.rect.minX).toBe(size.w);
    expect(l.rect.maxZ - l.rect.minZ).toBe(size.d);
    expect(l.rect.minX).toBeGreaterThanOrEqual(block.rect.minX);
    expect(l.rect.maxX).toBeLessThanOrEqual(block.rect.maxX);
    expect(overlaps(l.rect, alley.rect)).toBe(false);
    expect(l.block).toBe(block.id);
    expect(l.district).toBe('market');
    expect(l.level).toBe('L1');
    expect(l.y).toBe(10);
    expect(l.id).toMatch(/^lot-L1-\d+-\d+-\d+$/);
  }
  for (let i = 0; i < lots.length; i++) for (let j = i + 1; j < lots.length; j++) expect(overlaps(lots[i]!.rect, lots[j]!.rect)).toBe(false);
  // wall to wall: what is left at the east end of each row is narrower than the narrowest lot that would fit
  for (const row of [bottom, top]) expect(block.rect.maxX - Math.max(...row.map((l) => l.rect.maxX))).toBeLessThan(cfg.blockFill.minGap + 10);
});

test('a dense Downtown block has no alley and its two rows back onto each other', () => {
  const block = levelBlocks('L1', cfg).find((b) => b.district === 'downtown' && !b.alley)!;
  const { lots, roads } = fillBlock(block, PALETTES.downtown, mulberry32(3), cat, cfg);
  expect(roads).toEqual([]);
  expect(lots.length).toBeGreaterThan(4);
  for (const l of lots) expect(l.rect.maxZ - l.rect.minZ).toBeLessThanOrEqual(24);
});

test('an open sports block is an area with the two courts as open lots', () => {
  const block = levelBlocks('L3', cfg).find((b) => b.open === 'sports')!;
  const { lots, roads, areas } = fillBlock(block, PALETTES.uptown, mulberry32(1), cat, cfg);
  expect(roads).toEqual([]);
  expect(areas).toEqual([{ id: `area-${block.id.slice('block-'.length)}`, kind: 'sports', rect: block.rect, y: 38, district: 'uptown' }]);
  expect(lots.map((l) => l.asset)).toEqual(['mega/FootballPlayground_01', 'mega/BasketballPlayground_01']);
  expect(lots.every((l) => l.open)).toBe(true);
  expect(overlaps(lots[0]!.rect, lots[1]!.rect)).toBe(false);
});
