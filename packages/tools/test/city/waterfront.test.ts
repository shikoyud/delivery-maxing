import { expect, test } from 'vitest';
import { cityConfig as cfg, mulberry32, namesConfig, type Rect } from '@dm/shared';
import { readCatalog } from '../../src/city/files';
import { buildWaterfront, shore } from '../../src/city/waterfront';
import { REPO } from '../../src/nav/files';

const cat = readCatalog(REPO);
const wf = buildWaterfront(cfg, mulberry32(5), cat, namesConfig);
const EPS = 1e-6;
const overlaps = (a: Rect, b: Rect): boolean => a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;
const within = (a: Rect, b: Rect): boolean => a.minX >= b.minX - EPS && a.maxX <= b.maxX + EPS && a.minZ >= b.minZ - EPS && a.maxZ <= b.maxZ + EPS;
const of = (asset: string) => wf.lots.filter((l) => l.asset === asset);
const area = (kind: string) => wf.areas.filter((a) => a.kind === kind);

test('the docks: 32 stacked container prop lots in the yard, 2 crane lots, 2 warehouse lots, the station', () => {
  const containers = of('missing/Container_01');
  expect(containers).toHaveLength(32);
  const yard = area('containerYard')[0]!.rect;
  for (const c of containers) {
    expect(c.prop).toBe(true);
    expect(c.stack).toBeGreaterThanOrEqual(1);
    expect(c.stack).toBeLessThanOrEqual(3);
    expect(Number.isInteger(c.stack)).toBe(true);
    expect(within(c.rect, yard)).toBe(true);
  }
  expect(new Set(containers.map((c) => c.stack))).toEqual(new Set([1, 2, 3]));
  expect(of('missing/Crane_01')).toHaveLength(2);
  expect(of('missing/Warehouse_01')).toHaveLength(2);
  expect(of('mega/Station_01')).toHaveLength(1);
  expect(wf.lots.filter((l) => l.district === 'docks' && l.asset.startsWith('mega/Factory_')).length).toBeGreaterThanOrEqual(5);
  const dockLanes = wf.roads.filter((r) => r.kind === 'dockLane');
  expect(dockLanes).toHaveLength(2);
  for (const r of dockLanes) expect(r.rect.maxZ - r.rect.minZ).toBe(6);
  expect(wf.roads.some((r) => r.kind === 'street' && r.rect.minX === 200 && r.rect.maxX === 212)).toBe(true);
  expect(area('rail')).toHaveLength(1);
  expect(area('quay').length).toBe(2);
});

test('the beach: the boardwalk is 380-820 x 200-208, sand strips follow shore(x), bars on the sand, hotels back onto the boardwalk', () => {
  expect(area('boardwalk').map((a) => a.rect)).toEqual([{ minX: 380, minZ: 200, maxX: 820, maxZ: 208 }]);
  const sand = area('sand');
  expect(sand).toHaveLength(44);
  for (const s of sand) {
    expect(s.rect.maxX - s.rect.minX).toBe(10);
    expect(s.rect.maxZ).toBe(200);
    expect(s.rect.minZ).toBeCloseTo(shore((s.rect.minX + s.rect.maxX) / 2, cfg), 9);
    expect(s.y).toBe(cfg.beach.sandY);
  }
  expect(shore(600, cfg)).toBeCloseTo(110 + 70 * Math.sin(Math.PI * 220 / 440), 9);
  const bars = wf.lots.filter((l) => /^trop\/Bar_0[12]$/.test(l.asset));
  expect(bars.length).toBeGreaterThanOrEqual(3);
  for (const b of bars) {
    expect(b.y).toBe(cfg.beach.sandY);
    expect(sand.some((s) => overlaps(b.rect, s.rect))).toBe(true);
    expect(b.rect.maxZ).toBeLessThanOrEqual(200);
    expect(b.rect.minZ).toBeGreaterThan(shore(b.rect.minX, cfg));
  }
  const hotels = wf.lots.filter((l) => l.district === 'beach' && !l.prop && l.y === 2);
  expect(hotels.length).toBeGreaterThan(5);
  for (const h of hotels) {
    expect(h.rect.minZ).toBeGreaterThanOrEqual(208);
    expect(h.rect.maxZ).toBe(255);
    expect(h.facing).toBe('N');
  }
  expect(of('trop/Ferris_wheel_01')).toHaveLength(1);
});

test('Old Harbor: the pier is 12 m wide, the lighthouse lot is on the breakwater, Quay Street, the alley, three rows', () => {
  const pier = area('pier');
  expect(pier).toHaveLength(1);
  expect(pier[0]!.rect.maxX - pier[0]!.rect.minX).toBe(12);
  expect(pier[0]!.rect).toEqual({ minX: 995, minZ: 30, maxX: 1007, maxZ: 120 });
  const lighthouse = of('trop/Lighthouse_01');
  expect(lighthouse).toHaveLength(1);
  const breakwater = area('breakwater');
  expect(breakwater.some((b) => within(lighthouse[0]!.rect, b.rect))).toBe(true);
  expect(lighthouse[0]!.y).toBe(breakwater[0]!.y);
  expect(area('marina')).toHaveLength(1);
  const quay = wf.roads.find((r) => r.name === 'Quay Street')!;
  expect(quay.rect).toEqual({ minX: 820, minZ: 170, maxX: 1200, maxZ: 182 });
  expect(wf.roads.some((r) => r.kind === 'alley' && r.rect.minX === cfg.harbor.x0 && r.rect.maxX === cfg.harbor.x1)).toBe(true);
  expect(wf.lots.filter((l) => l.district === 'harbor').length).toBeGreaterThan(80);
});

test('Old Harbor: a 12 m car passage at each end links Quay Street to Harbor Road (no lot, no alley across it)', () => {
  const passages: Rect[] = [
    { minX: 820, maxX: cfg.harbor.x0, minZ: 170, maxZ: 255 },
    { minX: cfg.harbor.x1, maxX: 1200, minZ: 170, maxZ: 255 },
  ];
  for (const p of passages) {
    expect(p.maxX - p.minX).toBe(12);
    expect(wf.lots.filter((l) => overlaps(l.rect, p)).map((l) => l.id)).toEqual([]);
    expect(wf.roads.filter((r) => r.kind === 'alley' && overlaps(r.rect, p)).map((r) => r.id)).toEqual([]);
  }
});

test('Harbor Road runs the full width at z 255-270; the docks gas station', () => {
  const hr = wf.roads.find((r) => r.name === 'Harbor Road')!;
  expect(hr.kind).toBe('avenue');
  expect(hr.rect).toEqual({ minX: 0, minZ: 255, maxX: 1200, maxZ: 270 });
  expect(hr.y).toBe(2);
  expect(wf.gasStation.name).toBe('Dockside Fuel');
  expect(wf.gasStation.pumps).toHaveLength(2);
});

test('waterfront lots never overlap each other or a road, and every one fronts a road for its address or is a prop', () => {
  const { lots, roads } = wf;
  for (let i = 0; i < lots.length; i++) {
    for (let j = i + 1; j < lots.length; j++) expect(overlaps(lots[i]!.rect, lots[j]!.rect), `${lots[i]!.id} / ${lots[j]!.id}`).toBe(false);
    for (const r of roads) expect(overlaps(lots[i]!.rect, r.rect), `${lots[i]!.id} on ${r.id}`).toBe(false);
    expect(lots[i]!.rect.maxZ).toBeLessThanOrEqual(cfg.levels.L0.z1);
    if (!lots[i]!.prop) expect(wf.fronts.get(lots[i]!.id)?.name, lots[i]!.id).toBeTruthy();
  }
  expect(new Set(lots.map((l) => l.id)).size).toBe(lots.length);
  for (const l of lots) expect(wf.blocks.some((b) => b.id === l.block && within(l.rect, b.rect))).toBe(true);
});
