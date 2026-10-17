import { vec3 } from '../../src/math/vec3';
import { CatalogIndex } from '../../src/world/catalog';
import type { CityLayout } from '../../src/world/cityLayout';
import { testHospital, testOrderRules } from './fixtures';

export const cityCatalogFixture = (): CatalogIndex =>
  new CatalogIndex({
    version: 1,
    packs: {},
    entries: [
      {
        id: 'mega/Bakery_01', file: null, category: 'food', size: { w: 4.92, h: 6.98, d: 5.54 }, use: 'placed', front: '+z',
        poi: { roles: ['foodPickup', 'dropoffPackage'], items: 'bread and pastries' },
      },
      { id: 'mega/House_05', file: null, category: 'residential', size: { w: 8, h: 14.7, d: 9 }, use: 'placed', front: '+z', poi: { roles: ['dropoffFood'] } },
      { id: 'mega/Tree_01', file: null, category: 'prop', size: { w: 2, h: 5, d: 2 }, use: 'prop' },
    ],
  });

/** One block, a few lots, a road of each kind, one connector of each kind, areas, a hospital and a gas station. */
export const cityLayoutFixture = (): CityLayout => ({
  version: 1,
  seed: 1,
  size: 1200,
  levels: {
    L0: { y: 2, z0: 0, z1: 270 },
    L1: { y: 10, z0: 310, z1: 560 },
    L2: { y: 24, z0: 620, z1: 820 },
    L3: { y: 38, z0: 880, z1: 1040 },
    ridge: { y: 54, z0: 1070, z1: 1180 },
  },
  bands: {
    A: { z0: 270, z1: 310, y0: 2, y1: 10 },
    B: { z0: 560, z1: 620, y0: 10, y1: 24 },
    C: { z0: 820, z1: 880, y0: 24, y1: 38 },
    D: { z0: 1040, z1: 1070, y0: 38, y1: 48 },
  },
  blocks: [{ id: 'blk-1', rect: { minX: 100, minZ: 320, maxX: 160, maxZ: 380 }, level: 'L1', district: 'downtown', alley: true }],
  lots: [
    {
      id: 'lot-bakery', asset: 'mega/Bakery_01', rect: { minX: 100, minZ: 320, maxX: 105, maxZ: 326 }, y: 10, facing: 'S', level: 'L1',
      district: 'downtown', block: 'blk-1', name: 'Crumb & Co', address: '12 Bayview Ave', door: vec3(102, 10, 319), upperDoor: null, prop: false, open: false,
    },
    {
      id: 'lot-house', asset: 'mega/House_05', rect: { minX: 110, minZ: 320, maxX: 118, maxZ: 329 }, y: 10, facing: 'S', level: 'L1',
      district: 'downtown', block: 'blk-1', name: '14 Bayview Ave', address: '14 Bayview Ave', door: vec3(114, 10, 319),
      upperDoor: { position: vec3(114, 24, 330), y: 24 }, prop: false, open: false,
    },
    {
      id: 'lot-tree', asset: 'mega/Tree_01', rect: { minX: 120, minZ: 320, maxX: 122, maxZ: 322 }, y: 10, facing: 'S', level: 'L1',
      district: 'downtown', block: 'blk-1', name: 'Tree', address: '', door: null, upperDoor: null, prop: true, open: false,
    },
    {
      id: 'lot-open', asset: 'mega/Bakery_01', rect: { minX: 130, minZ: 320, maxX: 135, maxZ: 326 }, y: 10, facing: 'S', level: 'L1',
      district: 'downtown', block: 'blk-1', name: 'Empty', address: '', door: null, upperDoor: null, prop: false, open: true,
    },
  ],
  roads: [
    { id: 'road-ave', kind: 'avenue', rect: { minX: 0, minZ: 300, maxX: 1200, maxZ: 315 }, y: 10, name: 'Bayview Avenue' },
    { id: 'road-alley', kind: 'alley', rect: { minX: 128, minZ: 320, maxX: 132, maxZ: 380 }, y: 10, name: null },
  ],
  curvedRoads: [{ id: 'hillcrest-drive', polyline: [vec3(100, 54, 1100), vec3(200, 55, 1120)], width: 10 }],
  connectors: [
    { id: 'sw-1', kind: 'switchback', band: 'A', x: 50, z0: 270, z1: 310, y0: 2, y1: 10, legLength: 40 },
    { id: 'sl-1', kind: 'steepLane', band: 'B', x: 200, z0: 560, z1: 620, y0: 10, y1: 24 },
    { id: 'st-1', kind: 'stairs', band: 'A', x: 300, z0: 270, z1: 310, y0: 2, y1: 10 },
  ],
  areas: [
    { id: 'park-1', kind: 'park', rect: { minX: 400, minZ: 320, maxX: 460, maxZ: 380 }, y: 10, district: 'downtown' },
    { id: 'sand-1', kind: 'sand', rect: { minX: 400, minZ: 170, maxX: 410, maxZ: 200 }, y: 1, district: 'beach' },
    { id: 'pier-1', kind: 'pier', rect: { minX: 900, minZ: 60, maxX: 906, maxZ: 120 }, y: 2, district: 'harbor' },
  ],
  hospitals: [testHospital('h-1', vec3(10, 10, 10), 'Bayview General')],
  gasStations: [{ id: 'gas-1', name: 'Fuel Stop', position: vec3(20, 10, 20), pumps: [vec3(21, 10, 20)] }],
  orderRules: testOrderRules(),
});
