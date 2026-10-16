import { expect, test } from 'vitest';
import { baySlot, cityConfig as cfg, namesConfig, type Lot, type Rect, type Vec3 } from '@dm/shared';
import { readCatalog } from '../../src/city/files';
import { generateLayout } from '../../src/city/generate';
import { specialBlocks } from '../../src/city/landmarks';
import { REPO } from '../../src/nav/files';

const cat = readCatalog(REPO);
const layout = generateLayout(cfg, namesConfig, cat);
const inside = (p: Vec3, r: Rect): boolean => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;
const lotsAt = (p: Vec3): Lot[] => layout.lots.filter((l) => Math.abs(l.y - p.y) < 20 && inside(p, l.rect));
const avenueOf = (y: number) => layout.roads.find((r) => r.kind === 'avenue' && r.y === y)!;

test('specialBlocks is keyed "<level>:<k>:<row>" exactly as the prototype SPECIAL table', () => {
  expect([...specialBlocks(cfg).keys()].sort()).toEqual(
    ['L1:1:0', 'L1:9:0', 'L2:8:0', 'L3:1:0', 'L1:0:1', 'L1:10:1', 'L2:5:1', 'L3:7:1', 'L1:5:0', 'L1:4:1', 'L2:3:1', 'L3:5:0', 'L2:6:2', 'L2:2:0'].sort(),
  );
});

test('four hospitals with the design names on their levels, mega/Hospital_01 on a 27 x 27 hospitalLot facing the avenue', () => {
  expect(layout.hospitals.map((h) => [h.name, h.center.y])).toEqual([
    ['Bayview General', 10],
    ['Harbor Clinic', 10],
    ['Midtown Medical', 24],
    ['Uptown Hospital', 38],
  ]);
  // west / east as design section 2.2
  const [bg, hc, mm, uh] = layout.hospitals;
  expect(bg!.center.x).toBeLessThan(400);
  expect(hc!.center.x).toBeGreaterThan(800);
  expect(mm!.center.x).toBeGreaterThan(800);
  expect(uh!.center.x).toBeLessThan(400);
  for (const h of layout.hospitals) {
    expect(h.safeRadius).toBe(18);
    const lot = layout.lots.find((l) => l.name === h.name)!;
    expect(lot.asset).toBe('mega/Hospital_01');
    expect(lot.facing).toBe('S');
    expect(lot.rect.minZ).toBe(avenueOf(h.center.y).rect.maxZ);
    expect(h.center.x).toBeCloseTo((lot.rect.minX + lot.rect.maxX) / 2, 9);
    expect(h.center.z).toBeCloseTo((lot.rect.minZ + lot.rect.maxZ) / 2, 9);
    const area = layout.areas.find((a) => a.kind === 'hospitalLot' && inside(h.center, a.rect))!;
    expect([area.rect.maxX - area.rect.minX, area.rect.maxZ - area.rect.minZ]).toEqual([27, 27]);
  }
});

test('each hospital spawns within 3 m of its door facing the avenue; its bay is on the avenue-side sidewalk, along the avenue', () => {
  for (const h of layout.hospitals) {
    const lot = layout.lots.find((l) => l.name === h.name)!;
    const door = { x: (lot.rect.minX + lot.rect.maxX) / 2, z: lot.rect.minZ };
    expect(Math.hypot(h.spawn.x - door.x, h.spawn.z - door.z)).toBeLessThanOrEqual(3);
    expect(h.spawn.y).toBe(h.center.y);
    // forward is (-sin yaw, -cos yaw): facing the avenue is facing south (-z)
    expect(-Math.cos(h.spawnYaw)).toBeCloseTo(-1, 9);
    expect(lotsAt(h.spawn)).toEqual([]);

    const ave = avenueOf(h.center.y);
    const area = layout.areas.find((a) => a.kind === 'hospitalLot' && inside(h.center, a.rect))!;
    expect(h.bay.y).toBe(h.center.y);
    expect(h.bay.x).toBeCloseTo(area.rect.maxX + cfg.hospital.bayOffset, 9);
    expect(h.bay.z).toBeCloseTo(ave.rect.maxZ - cfg.hospital.bayBack, 9);
    // Decision 6: parked vehicles point along the avenue (east-west), so cos(bayYaw) = 0
    expect(Math.abs(Math.cos(h.bayYaw))).toBeLessThan(1e-6);
    for (let i = 0; i < 4; i++) {
      const p = baySlot(h, i).position;
      expect(inside(p, ave.rect)).toBe(true);
      expect(lotsAt(p)).toEqual([]);
    }
  }
});

test('six gas stations at the design locations, each with 2 pumps 4 m apart under an open canopy lot, and a kiosk', () => {
  const gs = layout.gasStations;
  expect(gs.map((g) => g.name).sort()).toEqual(['Bayview Fuel', 'Dockside Fuel', 'Harbor Pumps', 'Midtown Gas', 'Ridge Fuel', 'Uptown Fuel']);
  const at = (name: string) => gs.find((g) => g.name === name)!.position;
  expect([at('Dockside Fuel').y, at('Dockside Fuel').x < 380]).toEqual([2, true]);
  expect([at('Bayview Fuel').y, at('Bayview Fuel').x < 400]).toEqual([10, true]);
  expect([at('Harbor Pumps').y, at('Harbor Pumps').x > 800]).toEqual([10, true]);
  expect([at('Midtown Gas').y, at('Midtown Gas').x > 400 && at('Midtown Gas').x < 800]).toEqual([24, true]);
  expect([at('Uptown Fuel').y, at('Uptown Fuel').x > 600]).toEqual([38, true]);
  expect(at('Ridge Fuel').y).toBe(48);
  expect(new Set(gs.map((g) => g.id)).size).toBe(6);
  for (const g of gs) {
    expect(g.pumps).toHaveLength(2);
    const [a, b] = g.pumps as [Vec3, Vec3];
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(cfg.gasStation.pumpSpacing, 9);
    const canopy = layout.lots.find((l) => l.asset === 'mega/Gas_Station_02' && inside(g.position, l.rect))!;
    expect(canopy.open).toBe(true);
    expect(canopy.name).toBe(g.name);
    for (const p of g.pumps) {
      expect(p.y).toBe(g.position.y);
      expect(inside(p, canopy.rect)).toBe(true);
      // on the car mesh: no solid lot stands on a pump
      expect(lotsAt(p).filter((l) => !l.open)).toEqual([]);
    }
    const lot = layout.areas.find((x) => x.kind === 'gasLot' && inside(g.position, x.rect))!;
    expect([lot.rect.maxX - lot.rect.minX, lot.rect.maxZ - lot.rect.minZ]).toEqual([18, 15]);
    const kiosk = layout.lots.filter((l) => l.asset === 'mega/SmallMarket_01' && l.rect.minX >= lot.rect.minX && l.rect.maxX <= lot.rect.maxX && l.rect.minZ >= lot.rect.minZ && l.rect.maxZ <= lot.rect.maxZ);
    expect(kiosk).toHaveLength(1);
  }
});

test('City Hall, Police, Fire Station and Church use the design ids; School and Post Office are missing/ placeholders', () => {
  const by = (name: string) => layout.lots.filter((l) => l.name === name);
  expect(by('City Hall').map((l) => [l.asset, l.district])).toEqual([['mega/CityHall_01', 'downtown']]);
  expect(by('Police Station').map((l) => [l.asset, l.district])).toEqual([['mega/Police_01', 'downtown']]);
  expect(by('Fire Station').map((l) => [l.asset, l.district])).toEqual([['mega/FireStation_01', 'rowhouses']]);
  expect(by('Church').map((l) => [l.asset, l.district, l.y])).toEqual([['mega/Church_01', 'uptown', 38]]);
  expect(by('School').map((l) => l.asset)).toEqual(['missing/School_01']);
  expect(by('Post Office').map((l) => l.asset)).toEqual(['missing/PostOffice_01']);
  // each on a plaza, centred on its block's front
  for (const name of ['City Hall', 'Police Station', 'Fire Station', 'Church', 'School', 'Post Office']) {
    const l = by(name)[0]!;
    const block = layout.blocks.find((b) => b.id === l.block)!;
    expect((l.rect.minX + l.rect.maxX) / 2).toBeCloseTo((block.rect.minX + block.rect.maxX) / 2, 6);
    expect(l.rect.minZ).toBe(block.rect.minZ);
    expect(layout.areas.some((a) => a.kind === 'plaza' && a.rect.minX === block.rect.minX && a.rect.minZ === block.rect.minZ)).toBe(true);
  }
});
