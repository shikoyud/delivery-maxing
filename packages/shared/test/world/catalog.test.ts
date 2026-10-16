import { describe, expect, it } from 'vitest';
import catalogJson from '../../../../map/catalog.json';
import { CatalogIndex, lotSize, parseCatalog } from '../../src/world/catalog';

describe('catalog', () => {
  it('map/catalog.json parses: 939 entries, 8 missing, every placed building has a front axis', () => {
    const cat = parseCatalog(catalogJson);
    expect(cat.entries).toHaveLength(939);
    expect(cat.entries.filter((e) => e.status === 'missing').map((e) => e.id)).toEqual([
      'missing/PostOffice_01',
      'missing/Warehouse_01',
      'missing/School_01',
      'missing/Skateboard_01',
      'missing/Bicycle_01',
      'missing/Motorbike_01',
      'missing/Container_01',
      'missing/Crane_01',
    ]);
    const buildings = new CatalogIndex(cat).placedBuildings();
    expect(buildings.length).toBeGreaterThan(100);
    for (const e of buildings) expect(e.front).toBeDefined();
  });

  it('normalises the plural categories vehicles/props', () => {
    const cat = parseCatalog(catalogJson);
    expect(cat.entries.some((e) => (e.category as string) === 'vehicles' || (e.category as string) === 'props')).toBe(false);
  });

  it('indexes by id and category', () => {
    const idx = new CatalogIndex(parseCatalog(catalogJson));
    expect(idx.has('mega/Bakery_01')).toBe(true);
    expect(idx.has('nope')).toBe(false);
    expect(idx.get('mega/Bakery_01').category).toBe('food');
    expect(() => idx.get('nope')).toThrow(/nope/);
    expect(idx.byCategory('food').length).toBe(22);
  });

  it('lotSize rounds up to 0.5 m: Bakery_01 4.92 x 5.54 -> 5 x 6', () => {
    const e = new CatalogIndex(parseCatalog(catalogJson)).get('mega/Bakery_01');
    expect(lotSize(e)).toEqual({ w: 5, d: 6 });
    expect(lotSize({ ...e, size: { w: 5, h: 1, d: 5.01 } })).toEqual({ w: 5, d: 5.5 });
  });

  it('lotSize swaps w and d for a model whose front is ±x (its frontage is its z extent)', () => {
    const e = new CatalogIndex(parseCatalog(catalogJson)).get('mega/Bakery_01');
    expect(lotSize({ ...e, front: '+x' })).toEqual({ w: 6, d: 5 });
    expect(lotSize({ ...e, front: '-x' })).toEqual({ w: 6, d: 5 });
    expect(lotSize({ ...e, front: '-z' })).toEqual({ w: 5, d: 6 });
  });

  it('parseCatalog rejects an unknown front or status, naming the entry', () => {
    const entry = { id: 'mega/Bad_01', file: 'x.glb', category: 'food', use: 'placed', size: { w: 1, h: 1, d: 1 } };
    expect(() => parseCatalog({ version: 1, packs: {}, entries: [{ ...entry, front: 'z' }] })).toThrow(/Bad_01.*front/);
    expect(() => parseCatalog({ version: 1, packs: {}, entries: [{ ...entry, status: 'gone' }] })).toThrow(/Bad_01.*status/);
    for (const front of ['+z', '-z', '+x', '-x']) expect(parseCatalog({ version: 1, packs: {}, entries: [{ ...entry, front }] }).entries[0]!.front).toBe(front);
  });

  it('parseCatalog rejects an entry without size', () => {
    const bad = { version: 1, packs: {}, entries: [{ id: 'mega/Airport_01', file: 'x.glb', category: 'landmark', use: 'unused' }] };
    expect(() => parseCatalog(bad)).toThrow(/Airport_01.*size|size.*Airport_01/);
  });
});
