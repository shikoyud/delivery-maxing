import { describe, expect, it } from 'vitest';
import type { CatalogEntry, Facing, Lot } from '@dm/shared';
import { frontYaw, lotTransform } from '../src/render/city/placement';

const bakery: CatalogEntry = {
  id: 'mega/Bakery_01',
  file: 'megatropolis buildings/Bakery_01.glb',
  category: 'food',
  size: { w: 4.92, h: 6.98, d: 5.54 },
  pivot: { x: 0, z: 0.31, minY: 0 },
  front: '+z',
  use: 'placed',
};
// The catalog's Police_01 is off-centre along z (city design §7.2: "by 5.3 m"); this one along x too, to see both.
const police: CatalogEntry = { ...bakery, id: 'mega/Police_01', size: { w: 20.26, h: 11, d: 10.9 }, pivot: { x: 5.3, z: -2, minY: -0.5 } };

/** A lot of `e`'s footprint (w along the front, d deep) centred on (cx, cz), as the generator's lotRect lays it. */
function lotAt(e: CatalogEntry, facing: Facing, cx: number, y: number, cz: number): Lot {
  const along = facing === 'N' || facing === 'S';
  const hx = (along ? e.size.w : e.size.d) / 2;
  const hz = (along ? e.size.d : e.size.w) / 2;
  return {
    id: 'lot-1', asset: e.id, rect: { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz }, y, facing,
    level: 'L1', district: 'market', block: 'b', name: '', address: '', door: null, upperDoor: null, prop: false, open: false,
  };
}

describe('lotTransform', () => {
  // The layout's facing is the side of the lot the front (and door) is on: S its minZ edge (−z), N +z, E +x, W −x.
  it('a +z-front model facing N is not turned; its bounding-box centre lands on the lot centre, its minY on lot.y', () => {
    const t = lotTransform(lotAt(bakery, 'N', 100, 10, 200), bakery);
    expect(t.rotY).toBeCloseTo(0);
    expect(t.position.x).toBeCloseTo(100);
    expect(t.position.y).toBeCloseTo(10);
    expect(t.position.z).toBeCloseTo(200 - 0.31);
  });

  it('facing S it is turned half round, and the pivot offset with it', () => {
    const t = lotTransform(lotAt(bakery, 'S', 100, 10, 200), bakery);
    expect(Math.abs(t.rotY)).toBeCloseTo(Math.PI);
    expect(t.position.z).toBeCloseTo(200 + 0.31);
    expect(t.position.x).toBeCloseTo(100);
  });

  it('facing E (+x) and W (−x): a quarter turn each way, the pivot rotated too (Police_01 off-centre)', () => {
    const e = lotTransform(lotAt(police, 'E', 50, 2, 80), police);
    expect(e.rotY).toBeCloseTo(Math.PI / 2);
    // rotY π/2 maps model (x, z) to world (z, −x): the pivot (5.3, −2) lands at (−2, −5.3) from the origin
    expect(e.position.x).toBeCloseTo(50 + 2);
    expect(e.position.z).toBeCloseTo(80 + 5.3);
    expect(e.position.y).toBeCloseTo(2.5);
    const w = lotTransform(lotAt(police, 'W', 50, 2, 80), police);
    expect(w.rotY).toBeCloseTo(-Math.PI / 2);
    expect(w.position.x).toBeCloseTo(50 - 2);
    expect(w.position.z).toBeCloseTo(80 - 5.3);
  });

  it('the front axis offsets the turn: a −x front facing N turns a quarter so −x points at +z', () => {
    expect(frontYaw('-x', 'N')).toBeCloseTo(Math.PI / 2);
    expect(frontYaw('+x', 'N')).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(frontYaw('-z', 'N'))).toBeCloseTo(Math.PI);
    // and a model's world-space front after the turn is the facing direction, for every pair
    const dir = { '+z': [0, 1], '-z': [0, -1], '+x': [1, 0], '-x': [-1, 0] } as const;
    const want = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] } as const;
    for (const f of ['+z', '-z', '+x', '-x'] as const) {
      for (const facing of ['N', 'S', 'E', 'W'] as const) {
        const a = frontYaw(f, facing);
        const [x, z] = dir[f];
        // three's rotation about +y: (x, z) → (x cos a + z sin a, −x sin a + z cos a)
        expect(x * Math.cos(a) + z * Math.sin(a)).toBeCloseTo(want[facing][0]);
        expect(-x * Math.sin(a) + z * Math.cos(a)).toBeCloseTo(want[facing][1]);
      }
    }
  });

  it('a model without a pivot or front sits centred, +z front', () => {
    const plain: CatalogEntry = { ...bakery, pivot: undefined, front: undefined } as CatalogEntry;
    const t = lotTransform(lotAt(plain, 'N', 0, 0, 0), plain);
    expect(t.position).toEqual({ x: 0, y: 0, z: 0 });
  });
});
