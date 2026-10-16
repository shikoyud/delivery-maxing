import { describe, expect, it } from 'vitest';
import { worldConfig } from '../../src/config';
import { layoutToMap } from '../../src/world/cityMap';
import { cityCatalogFixture, cityLayoutFixture } from './cityFixtures';

const build = () => layoutToMap(cityLayoutFixture(), cityCatalogFixture());

describe('layoutToMap', () => {
  it('a lot becomes a building solid of catalog height on its level', () => {
    const s = build().solids.find((x) => x.id === 'lot-bakery')!;
    expect(s.kind).toBe('building');
    expect(s.center.y).toBeCloseTo(10 + 3.49, 6);
    expect(s.size.y).toBeCloseTo(6.98, 6);
    expect(s.size.x).toBe(5);
    expect(s.size.z).toBe(6);
    expect(s.center.x).toBe(102.5);
    expect(s.center.z).toBe(323);
  });

  it('a prop lot is a prop solid and an open lot has none', () => {
    const m = build();
    expect(m.solids.find((x) => x.id === 'lot-tree')!.kind).toBe('prop');
    expect(m.solids.some((x) => x.id === 'lot-open')).toBe(false);
  });

  it('each level has ground; L0 ground stops at the water in three rects', () => {
    const g = build().solids.filter((x) => x.kind === 'ground');
    expect(g.filter((x) => x.id.startsWith('ground-L0'))).toHaveLength(3);
    const docks = g.find((x) => x.id === 'ground-L0-docks')!;
    expect(docks.center.x - docks.size.x / 2).toBe(0);
    expect(docks.center.x + docks.size.x / 2).toBe(380);
    expect(docks.center.z - docks.size.z / 2).toBe(110);
    expect(docks.center.y + docks.size.y / 2).toBe(2);
    const beach = g.find((x) => x.id === 'ground-L0-beach')!;
    expect(beach.center.z - beach.size.z / 2).toBe(200);
    const harbor = g.find((x) => x.id === 'ground-L0-harbor')!;
    expect(harbor.center.z - harbor.size.z / 2).toBe(120);
    expect(harbor.center.x + harbor.size.x / 2).toBe(1200);
    const l1 = g.find((x) => x.id === 'ground-L1')!;
    expect(l1.center.y + l1.size.y / 2).toBe(10);
    expect(g.map((x) => x.id)).toEqual(expect.arrayContaining(['ground-L2', 'ground-L3', 'ground-ridge']));
  });

  it('sand and pier areas are terrain solids topped at their y', () => {
    const m = build();
    for (const [id, top] of [['sand-1', 1], ['pier-1', 2]] as const) {
      const s = m.solids.find((x) => x.id === id)!;
      expect(s.kind).toBe('terrain');
      expect(s.center.y + s.size.y / 2).toBeCloseTo(top, 6);
    }
  });

  it('an alley road becomes an alley zone, a park area a path zone, a steep lane a chain of rects', () => {
    const z = build().accessZones;
    const alley = z.find((x) => x.kind === 'alley')!;
    expect(alley.rect).toEqual({ minX: 128, minZ: 320, maxX: 132, maxZ: 380 });
    expect(alley.minY).toBe(10);
    expect(alley.maxY).toBe(10);
    expect(z.find((x) => x.kind === 'path' && x.id.includes('park-1'))).toBeDefined();
    expect(z.some((x) => x.id.includes('road-ave'))).toBe(false);
    const lane = z.filter((x) => x.kind === 'steepLane');
    expect(lane.length).toBeGreaterThan(1);
    expect(Math.min(...lane.map((x) => x.minY))).toBe(10);
    expect(Math.max(...lane.map((x) => x.maxY))).toBe(24);
    expect(Math.min(...lane.map((x) => x.rect.minZ))).toBe(560);
    expect(Math.max(...lane.map((x) => x.rect.maxZ))).toBe(620);
    const stairs = z.filter((x) => x.kind === 'stairs');
    expect(stairs).toHaveLength(1);
    expect(stairs[0]!.minY).toBe(2);
    expect(stairs[0]!.maxY).toBe(10);
  });

  it('a lot with poi roles becomes a door POI with its name and address; an upper door is food-only', () => {
    const pois = build().pois;
    const p = pois.find((x) => x.id === 'lot-bakery')!;
    expect(p).toMatchObject({ kind: 'door', name: 'Crumb & Co', address: '12 Bayview Ave', lotId: 'lot-bakery', district: 'downtown' });
    expect(p.roles).toEqual(['foodPickup', 'dropoffPackage']);
    expect(p.items).toEqual(['bread and pastries']);
    expect(pois.some((x) => x.id === 'lot-tree' || x.id === 'lot-open')).toBe(false);
    const upper = pois.find((x) => x.id === 'lot-house-upper')!;
    expect(upper.roles).toEqual(['dropoffFood']);
    expect(upper.upper).toBe(true);
    expect(upper.position.y).toBe(24);
  });

  it('copies hospitals, gas stations and order rules', () => {
    const l = cityLayoutFixture();
    const m = layoutToMap(l, cityCatalogFixture());
    expect(m.hospitals).toEqual(l.hospitals);
    expect(m.gasStations).toEqual(l.gasStations);
    expect(m.orderRules).toEqual(l.orderRules);
  });

  it('kind is city and chunkSize is worldConfig.chunkSize', () => {
    const m = build();
    expect(m.kind).toBe('city');
    expect(m.chunkSize).toBe(worldConfig.chunkSize);
    expect(m.size).toBe(1200);
    expect(m.layout.version).toBe(1);
  });
});
