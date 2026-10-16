import { expect, test } from 'vitest';
import { mulberry32, namesConfig, type Lot, type Road } from '@dm/shared';
import { readCatalog } from '../../src/city/files';
import { Namer } from '../../src/city/names';
import { REPO } from '../../src/nav/files';

const cat = readCatalog(REPO);
const namer = (seed = 1) => new Namer(namesConfig, mulberry32(seed));

const road: Road = { id: 'road-test', kind: 'street', rect: { minX: 0, minZ: 100, maxX: 1200, maxZ: 112 }, y: 10, name: 'Market Street' };
const lotAt = (x0: number, x1: number, z0: number, z1: number): Pick<Lot, 'rect'> => ({ rect: { minX: x0, minZ: z0, maxX: x1, maxZ: z1 } });

test('a bakery is named "<word> Bakery", "<word> & Co. Bakery" or "<word> Bakehouse"', () => {
  const n = namer();
  for (let i = 0; i < 50; i++) expect(n.business(cat.get('mega/Bakery_01'))).toMatch(/^.+ (Bakery|& Co\. Bakery|Bakehouse)$/);
});

test('500 businesses in a row are unique, even of one kind', () => {
  const n = namer(2);
  const bakeries = Array.from({ length: 500 }, () => n.business(cat.get('mega/Bakery_01')));
  expect(new Set(bakeries).size).toBe(500);
  const mixed = new Set<string>();
  const ids = cat.placedBuildings().filter((e) => !e.duplicateOf).map((e) => e.id);
  for (let i = 0; i < 500; i++) mixed.add(n.business(cat.get(ids[i % ids.length]!)));
  expect(mixed.size).toBe(500);
  for (const name of [...bakeries, ...mixed]) expect(name).not.toMatch(/^(mega|trop|missing)\//);
});

test('500 households are unique', () => {
  const n = namer(3);
  expect(new Set(Array.from({ length: 500 }, () => n.household())).size).toBe(500);
});

test('every placed building gets a name: a business, or a household for homes', () => {
  const n = namer(4);
  for (const e of cat.placedBuildings()) {
    const name = n.lotName(e);
    expect(name.length).toBeGreaterThan(3);
  }
  expect(n.isHousehold(cat.get('mega/House_01'))).toBe(true);
  expect(n.isHousehold(cat.get('mega/Hotel_01'))).toBe(false);
  expect(n.isHousehold(cat.get('mega/Bakery_01'))).toBe(false);
});

test('addresses count from the west end in steps of 2: odd on the south side, even on the north', () => {
  const n = namer(5);
  const south = [lotAt(10, 18, 80, 100), lotAt(18, 25, 80, 100), lotAt(300, 310, 80, 100)].map((l) => n.address(l, road));
  const north = [lotAt(10, 18, 112, 130), lotAt(18, 25, 112, 130), lotAt(300, 310, 112, 130)].map((l) => n.address(l, road));
  const num = (a: string): number => Number(/^(\d+) Market St$/.exec(a)![1]);
  expect(south.map(num).every((v) => v % 2 === 1)).toBe(true);
  expect(north.map(num).every((v) => v % 2 === 0)).toBe(true);
  for (const side of [south, north]) {
    const ns = side.map(num);
    expect(ns[0]).toBeLessThan(ns[1]!);
    expect(ns[1]).toBeLessThan(ns[2]!);
  }
});

test('residential blocks over 2 floors get an apartment number', () => {
  const n = namer(6);
  const lot = lotAt(10, 18, 80, 100);
  expect(n.address(lot, road, cat.get('mega/House_01'))).toMatch(/^\d+ Market St, apt \d+$/);
  expect(n.address(lot, road, cat.get('mega/House_09'))).toMatch(/^\d+ Market St$/);
  expect(n.address(lot, road, cat.get('mega/Bakery_01'))).toMatch(/^\d+ Market St$/);
});
