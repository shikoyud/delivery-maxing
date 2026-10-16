import { expect, test } from 'vitest';
import { cityConfig, namesConfig, parseCityLayout, type Rect } from '@dm/shared';
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

test('ids are unique; lots name a known block; every lot but a prop has a fictional name and a unique address', () => {
  for (const key of ['lots', 'roads', 'blocks', 'areas', 'hospitals', 'gasStations', 'curvedRoads'] as const) {
    const ids = layout[key].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  }
  const blocks = new Set(layout.blocks.map((b) => b.id));
  const named = layout.lots.filter((l) => !l.prop);
  for (const l of layout.lots) {
    expect(blocks.has(l.block)).toBe(true);
    if (l.prop) {
      // containers, cranes, silos and the Ferris wheel are scenery, not addresses
      expect([l.name, l.address]).toEqual(['', '']);
      continue;
    }
    expect(l.name).not.toBe('');
    expect(l.name).not.toMatch(/^(mega|trop|missing)\//);
    expect(l.address).toMatch(/^\d+ \S.*$/);
  }
  const addresses = named.map((l) => l.address.replace(/, apt \d+$/, ''));
  expect(new Set(addresses).size).toBe(addresses.length);
  const names = named.map((l) => l.name);
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
    // beach bars and the Ferris wheel stand on the sand, below the promenade
    const onSand = l.district === 'beach' && l.rect.maxZ <= cityConfig.beach.boardwalkZ0;
    expect(l.y).toBe(onSand ? cityConfig.beach.sandY : cityConfig.levels[l.level].y);
  }
});

test('the slope bands: 11 switchbacks, 10 steep lanes, 31 staircases; a band gap per switchback and lane; walk-ups in B and C', () => {
  const count = (k: string) => layout.connectors.filter((c) => c.kind === k).length;
  expect([count('switchback'), count('steepLane'), count('stairs')]).toEqual([11, 10, 31]);
  expect(layout.areas.filter((a) => a.kind === 'bandGap')).toHaveLength(21);
  const slope = layout.lots.filter((l) => l.district === 'slope');
  expect(slope.length).toBeGreaterThan(20);
  expect(new Set(slope.map((l) => l.level))).toEqual(new Set(['L1', 'L2']));
  for (const l of slope) {
    expect(l.upperDoor!.y).toBe(l.level === 'L1' ? 24 : 38);
    expect(l.block).toMatch(/^block-band-[BC]-\d+$/);
  }
});

const EPS = 1e-6;
const overlaps = (a: Rect, b: Rect): boolean => a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;

test('about 2,500 lots and 82 +- 10 blocks with alleys', () => {
  expect(layout.lots.length).toBeGreaterThanOrEqual(2300);
  expect(layout.lots.length).toBeLessThanOrEqual(2900);
  const alleyBlocks = layout.blocks.filter((b) => b.alley).length;
  expect(alleyBlocks).toBeGreaterThanOrEqual(72);
  expect(alleyBlocks).toBeLessThanOrEqual(92);
  expect(layout.hospitals).toHaveLength(4);
  expect(layout.gasStations).toHaveLength(6);
  expect(layout.curvedRoads).toHaveLength(1);
});

test('no two lots overlap (a sweep over every lot rect) and no lot overlaps a road rect', () => {
  const sweep = (rects: { id: string; rect: Rect }[], others: { id: string; rect: Rect }[] | null): string[] => {
    // sweep along x: every rect is checked against those whose x-range is still open
    type Ev = { x: number; open: boolean; i: number; mine: boolean };
    const evs: Ev[] = [];
    const all = others ? [...rects.map((r) => ({ ...r, mine: true })), ...others.map((r) => ({ ...r, mine: false }))] : rects.map((r) => ({ ...r, mine: true }));
    all.forEach((r, i) => evs.push({ x: r.rect.minX + EPS, open: true, i, mine: r.mine }, { x: r.rect.maxX - EPS, open: false, i, mine: r.mine }));
    evs.sort((a, b) => a.x - b.x || (a.open ? 1 : -1));
    const active = new Set<number>();
    const hits: string[] = [];
    for (const e of evs) {
      if (!e.open) {
        active.delete(e.i);
        continue;
      }
      const a = all[e.i]!;
      for (const j of active) {
        const b = all[j]!;
        if (others && a.mine === b.mine) continue;
        if (overlaps(a.rect, b.rect)) hits.push(`${a.id} / ${b.id}`);
      }
      active.add(e.i);
    }
    return hits;
  };
  // lots on different levels never share z, so a plain 2D sweep is enough
  expect(sweep(layout.lots, null)).toEqual([]);
  // the same for lots against roads, level by level (a road and a lot overlap only at one height)
  for (const y of new Set(layout.lots.map((l) => l.y))) {
    const roads = layout.roads.filter((r) => Math.abs(r.y - y) < 2);
    expect(sweep(layout.lots.filter((l) => l.y === y), roads)).toEqual([]);
  }
});

test('every lot lies inside its level z range or a slope band', () => {
  const ranges = [...Object.values(cityConfig.levels), ...Object.values(cityConfig.bands)];
  for (const l of layout.lots) {
    const ok = ranges.some((r) => l.rect.minZ >= r.z0 - EPS && l.rect.maxZ <= r.z1 + EPS);
    expect(ok, l.id).toBe(true);
    const lv = cityConfig.levels[l.level];
    const inLevel = l.rect.minZ >= lv.z0 - EPS && l.rect.maxZ <= lv.z1 + EPS;
    expect(inLevel || l.district === 'slope', l.id).toBe(true);
  }
});
