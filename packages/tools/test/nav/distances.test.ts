import { expect, test } from 'vitest';
import { DistanceTable, vec3, type MapData, type NavRouter, type Poi, type Vec3 } from '@dm/shared';
import { buildDistanceTable, serialize } from '../../src/nav/distances';

const poi = (id: string, x: number, roles: Poi['roles']): Poi => ({ id, position: vec3(x, 0, 0), district: 'downtown', kind: 'door', name: id, roles });

test('a 2-pickup × 3-dropoff table serialises and parses back with the same values, Infinity included', () => {
  const pois = [
    poi('p-food', 0, ['foodPickup']),
    poi('d-1', 100, ['dropoffFood']),
    poi('p-parcels', 10, ['packagePickup']),
    poi('d-café', 250, ['dropoffPackage']),
    poi('d-3', 500, ['dropoffFood', 'dropoffPackage']),
  ];
  const map = { kind: 'city', pois } as unknown as MapData;
  const tiers: string[] = [];
  const router = {
    distance: (tier: string, a: Vec3, b: Vec3) => {
      tiers.push(tier);
      return a.x === 10 && b.x === 500 ? Infinity : Math.abs(a.x - b.x) + 0.25;
    },
  } as unknown as NavRouter;

  const t = buildDistanceTable(map, router);
  expect(t.pickups).toEqual(['p-food', 'p-parcels']);
  expect(t.dropoffs).toEqual(['d-1', 'd-café', 'd-3']);
  expect(new Set(tiers)).toEqual(new Set(['walk']));

  const back = DistanceTable.parse(serialize(t));
  expect(back.pickups).toEqual(t.pickups);
  expect(back.dropoffs).toEqual(t.dropoffs);
  const expected: Record<string, number> = {
    'p-food>d-1': 100.25, 'p-food>d-café': 250.25, 'p-food>d-3': 500.25,
    'p-parcels>d-1': 90.25, 'p-parcels>d-café': 240.25, 'p-parcels>d-3': Infinity,
  };
  for (const [key, v] of Object.entries(expected)) {
    const [p, d] = key.split('>') as [string, string];
    expect(back.get(p, d), key).toBe(v);
    expect(t.get(p, d), key).toBe(v);
  }
  // serialising the parsed table gives the same bytes
  expect(Buffer.from(serialize(back)).equals(Buffer.from(serialize(t)))).toBe(true);
});
