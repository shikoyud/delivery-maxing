import { describe, expect, it } from 'vitest';
import { parsePieceCatalog, type PieceEntry } from '../../src/world/pieces';

const entry = (over: Partial<PieceEntry> = {}): PieceEntry => ({
  id: 'b-test',
  kind: 'building',
  lod0: 'city/buildings/b-test.glb',
  lod1: 'city/buildings/b-test.lod1.glb',
  size: { x: 6, y: 10, z: 7 },
  tris: [1000, 400],
  roofY: 9.5,
  colliders: [{ center: { x: 0, y: 4.75, z: 0 }, size: { x: 5.8, y: 9.5, z: 6.8 } }],
  avgColor: [0.5, 0.4, 0.3],
  ...over,
});

const catalog = (e: PieceEntry) => ({ [e.id]: e });

describe('parsePieceCatalog', () => {
  it('accepts a well-formed catalog and returns equal entries', () => {
    const e = entry();
    expect(parsePieceCatalog(JSON.parse(JSON.stringify(catalog(e))))).toEqual(catalog(e));
  });

  it('accepts a character with no lod1, no roof and no colliders', () => {
    const e = entry({ id: 'c-thief', kind: 'character', lod1: null, tris: [3000, 0], roofY: null, colliders: [] });
    expect(parsePieceCatalog(catalog(e))['c-thief']?.lod1).toBeNull();
  });

  it('parsePieceCatalog rejects an entry with lod1 tris > lod0 tris, a non-positive size, or a collider outside the AABB (±0.5 m)', () => {
    expect(() => parsePieceCatalog(catalog(entry({ tris: [100, 101] })))).toThrow(/b-test/);
    expect(() => parsePieceCatalog(catalog(entry({ size: { x: 6, y: 0, z: 7 } })))).toThrow(/b-test/);
    expect(() => parsePieceCatalog(catalog(entry({ size: { x: -1, y: 10, z: 7 } })))).toThrow(/b-test/);
    // x half-extent 3 + 0.5 tolerance: a collider reaching x = 3.6 is outside
    const out = { center: { x: 1.6, y: 5, z: 0 }, size: { x: 4, y: 2, z: 2 } };
    expect(() => parsePieceCatalog(catalog(entry({ colliders: [out] })))).toThrow(/b-test/);
    // ... and one reaching x = 3.4 is inside the tolerance
    const edge = { center: { x: 1.4, y: 5, z: 0 }, size: { x: 4, y: 2, z: 2 } };
    expect(() => parsePieceCatalog(catalog(entry({ colliders: [edge] })))).not.toThrow();
    // below the base
    const low = { center: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } };
    expect(() => parsePieceCatalog(catalog(entry({ colliders: [low] })))).toThrow(/b-test/);
  });

  it('checks a rotated collider by its rotated extent', () => {
    // 5.8 m long slab rotated 90° about y spans 5.8 m in z (half 2.9 < 3.5 + 0.5) and 0.2 m in x: fine
    const ok = { center: { x: 0, y: 9, z: 0 }, size: { x: 5.8, y: 0.2, z: 0.2 }, rotationDeg: { x: 0, y: 90, z: 0 } };
    expect(() => parsePieceCatalog(catalog(entry({ colliders: [ok] })))).not.toThrow();
    // 9 m slab rotated 90° about y spans 9 m in z: half 4.5 > 4
    const bad = { center: { x: 0, y: 9, z: 0 }, size: { x: 9, y: 0.2, z: 0.2 }, rotationDeg: { x: 0, y: 90, z: 0 } };
    expect(() => parsePieceCatalog(catalog(entry({ colliders: [bad] })))).toThrow(/b-test/);
  });

  it('rejects a key that differs from the entry id, an unknown kind and a non-object', () => {
    expect(() => parsePieceCatalog({ other: entry() })).toThrow(/other/);
    expect(() => parsePieceCatalog(catalog(entry({ kind: 'tree' as PieceEntry['kind'] })))).toThrow(/b-test/);
    expect(() => parsePieceCatalog([])).toThrow();
    expect(() => parsePieceCatalog(catalog(entry({ avgColor: [0.5, 2, 0.3] })))).toThrow(/b-test/);
  });
});
