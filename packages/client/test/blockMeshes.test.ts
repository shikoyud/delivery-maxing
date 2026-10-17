import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CatalogIndex, parseCatalog, type CityLayout, type CityMap, type Lot } from '@dm/shared';
import { buildBlockMeshes } from '../src/render/city/blockMeshes';

const cat = new CatalogIndex(
  parseCatalog({
    version: 1,
    packs: {},
    entries: [
      { id: 'mega/Pizza_01', file: 'x.glb', category: 'food', size: { w: 7, h: 8, d: 7 }, use: 'placed' },
      { id: 'mega/Office_01', file: 'y.glb', category: 'office', size: { w: 8, h: 8, d: 10 }, use: 'placed' },
      { id: 'mega/Bench_01', file: 'z.glb', category: 'prop', size: { w: 2, h: 1, d: 1 }, use: 'prop' },
    ],
  }),
);

let n = 0;
function lot(block: string, asset: string, x: number, z: number, extra: Partial<Lot> = {}): Lot {
  return {
    id: `lot-${n++}`,
    asset,
    rect: { minX: x, maxX: x + 7, minZ: z, maxZ: z + 7 },
    y: 10,
    facing: 'S',
    level: 'L1',
    district: 'market',
    block,
    name: '',
    address: '',
    door: null,
    upperDoor: null,
    prop: false,
    open: false,
    ...extra,
  };
}

const lots = [
  lot('blk-a', 'mega/Pizza_01', 0, 0),
  lot('blk-a', 'mega/Office_01', 10, 0),
  lot('blk-a', 'mega/Bench_01', 20, 0, { prop: true }),
  lot('blk-a', 'mega/Office_01', 30, 0, { open: true }),
  lot('blk-b', 'mega/Office_01', 0, 100),
  lot('', 'mega/Office_01', 0, 200, { district: 'docks' }),
];
const layout = {
  version: 1,
  seed: 1,
  size: 1200,
  levels: {},
  bands: {},
  blocks: [
    { id: 'blk-a', rect: { minX: 0, maxX: 40, minZ: 0, maxZ: 10 }, level: 'L1', district: 'market', alley: false },
    { id: 'blk-b', rect: { minX: 0, maxX: 40, minZ: 100, maxZ: 110 }, level: 'L1', district: 'market', alley: false },
  ],
  lots,
  roads: [],
  curvedRoads: [],
  connectors: [],
  areas: [],
  hospitals: [],
  gasStations: [],
  orderRules: { bands: { shortMax: 350, mediumMax: 800 }, foodDropoff: { min: 150, max: 800 }, packageDropoff: { min: 150, max: 800 }, maxPickupDistance: 400 },
} as unknown as CityLayout;

const triangles = (m: THREE.Mesh): number => (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;

describe('buildBlockMeshes', () => {
  const map = { kind: 'city', layout, size: 1200, chunkSize: 100, solids: [] } as unknown as CityMap;
  const meshes = buildBlockMeshes(map, cat);

  it('one merged mesh per block, plus "<district>-free" for lots without a block', () => {
    expect([...meshes.keys()].sort()).toEqual(['blk-a', 'blk-b', 'docks-free']);
    for (const [id, m] of meshes) {
      expect(m.userData.blockId).toBe(id);
      expect(m.castShadow).toBe(true);
    }
  });

  it('6 × 2 = 12 triangles per lot box: the prop lot is drawn, the open lot is not', () => {
    expect(triangles(meshes.get('blk-a')!)).toBe(3 * 12);
    expect(triangles(meshes.get('blk-b')!)).toBe(12);
  });

  it('each box spans its lot rect and the catalog height from the lot y', () => {
    const g = meshes.get('blk-b')!.geometry;
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect([b.min.x, b.min.y, b.min.z]).toEqual([0, 10, 100]);
    expect([b.max.x, b.max.y, b.max.z]).toEqual([7, 18, 107]);
  });

  it('a food lot and an office lot get different colours', () => {
    const color = meshes.get('blk-a')!.geometry.getAttribute('color');
    const food = new THREE.Color().fromBufferAttribute(color as THREE.BufferAttribute, 0).getHex();
    const office = new THREE.Color().fromBufferAttribute(color as THREE.BufferAttribute, 24).getHex();
    expect(food).not.toBe(office);
  });
});
