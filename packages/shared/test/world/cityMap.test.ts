import { describe, expect, it } from 'vitest';
import { vec3 } from '../../src/math/vec3';
import { cityConfig, worldConfig } from '../../src/config';
import { zoneAt } from '../../src/world/access';
import { layoutToMap } from '../../src/world/cityMap';
import { steepLaneGeometry } from '../../src/world/terrainSolids';
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
    // y 10 -> 24 at 14% = 100 m of ramp; the chain follows the deck's centre line from z0 to z1 in 6 m steps
    const g = steepLaneGeometry({ x: 200, z0: 560, z1: 620, y0: 10, y1: 24 }, cityConfig.steepLane);
    expect(lane).toHaveLength(Math.ceil((60 / g.dz) / 6));
    const first = lane[0]!;
    const last = lane[lane.length - 1]!;
    expect(first.rect.minZ).toBe(560);
    expect(first.minY).toBe(10);
    expect(last.rect.maxZ).toBe(620);
    expect(last.maxY).toBe(24);
    for (let i = 1; i < lane.length; i++) {
      expect(lane[i]!.rect.minX).toBeLessThanOrEqual(lane[i - 1]!.rect.maxX);
      expect(lane[i]!.rect.minZ).toBeLessThanOrEqual(lane[i - 1]!.rect.maxZ);
    }
    // Every point of the deck between z0 and z1, edges included, is in a steep-lane zone at its height.
    const m = build();
    for (let s = -10; s <= g.run + g.flat; s += 0.5) {
      for (let t = -3; t <= 3; t += 1) {
        const p = vec3(g.start.x + s * g.dx - t * g.dz, 10 + (14 * Math.min(g.run, Math.max(0, s))) / g.run, g.start.z + s * g.dz + t * g.dx);
        if (p.z < 560 || p.z > 620 || s < 0) continue;
        expect(zoneAt(m, p)?.kind, `s ${s} t ${t}`).toBe('steepLane');
      }
    }
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

  it('an upper door gives a food-only POI even when the asset has no poi roles', () => {
    const l = cityLayoutFixture();
    l.lots.push({ ...l.lots[2]!, id: 'lot-slope', prop: false, door: null, upperDoor: { position: vec3(1, 24, 1), y: 24 } });
    const pois = layoutToMap(l, cityCatalogFixture()).pois;
    expect(pois.find((x) => x.id === 'lot-slope-upper')!.roles).toEqual(['dropoffFood']);
    expect(pois.some((x) => x.id === 'lot-slope')).toBe(false);
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

  it('reads config/city.json, and a city config override changes the output', () => {
    const base = build();
    const stairsOf = (m: ReturnType<typeof build>) => m.accessZones.find((z) => z.kind === 'stairs')!.rect;
    expect(stairsOf(base).maxX - stairsOf(base).minX).toBe(cityConfig.stairs.width);
    const city = {
      ...cityConfig,
      stairs: { ...cityConfig.stairs, width: 6 },
      steepLane: { ...cityConfig.steepLane, zoneStep: 12 },
      terrain: { ...cityConfig.terrain, slabThickness: 2, terrainThickness: 5 },
    };
    const m = layoutToMap(cityLayoutFixture(), cityCatalogFixture(), { world: worldConfig, city });
    expect(stairsOf(m).maxX - stairsOf(m).minX).toBe(6);
    const lanes = (x: ReturnType<typeof build>) => x.accessZones.filter((z) => z.kind === 'steepLane').length;
    expect(lanes(m)).toBeLessThan(lanes(base));
    expect(m.solids.find((x) => x.id === 'ground-L1')!.size.y).toBe(2);
    expect(base.solids.find((x) => x.id === 'ground-L1')!.size.y).toBe(1);
    expect(m.solids.find((x) => x.id === 'sand-1')!.size.y).toBe(5);
  });
});
