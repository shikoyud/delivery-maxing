import { describe, expect, it } from 'vitest';
import type { Solid, Vec3 } from '@dm/shared';
import { solidsToTriangles } from '../../src/nav/geometry';

const corners = (positions: Float32Array, from: number, n: number): string[] => {
  const out: string[] = [];
  for (let i = from; i < from + n; i++) {
    out.push([0, 1, 2].map((k) => positions[i * 3 + k]!.toFixed(3)).join(','));
  }
  return out.sort();
};

/** The face normal of triangle t (not normalised), by the right-hand rule as recast computes it. */
const normalOf = (positions: Float32Array, indices: Uint32Array, t: number): Vec3 => {
  const p = (k: number): Vec3 => {
    const i = indices[t * 3 + k]!;
    return { x: positions[i * 3]!, y: positions[i * 3 + 1]!, z: positions[i * 3 + 2]! };
  };
  const [a, b, c] = [p(0), p(1), p(2)];
  const e0 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const e1 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  return { x: e0.y * e1.z - e0.z * e1.y, y: e0.z * e1.x - e0.x * e1.z, z: e0.x * e1.y - e0.y * e1.x };
};

describe('solidsToTriangles', () => {
  it('emits 8 corners and 12 triangles per box', () => {
    const solids: Solid[] = [
      { id: 'a', kind: 'ground', center: { x: 0, y: -0.5, z: 0 }, size: { x: 10, y: 1, z: 10 } },
      { id: 'b', kind: 'building', center: { x: 20, y: 3, z: 0 }, size: { x: 4, y: 6, z: 4 } },
    ];
    const { positions, indices } = solidsToTriangles(solids);
    expect(positions.length).toBe(2 * 8 * 3);
    expect(indices.length).toBe(2 * 12 * 3);
    expect(Math.max(...indices)).toBe(15);
    expect(corners(positions, 8, 8)).toEqual(
      [18, 22].flatMap((x) => [0, 6].flatMap((y) => [-2, 2].map((z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`)))
        .sort(),
    );
  });

  it('solidsToTriangles of a 90°-rotated box matches its rotated corners', () => {
    // 2 × 4 × 6 turned 90° about y: its x and z extents swap (x half 3, z half 1)
    const s: Solid = { id: 'r', kind: 'building', center: { x: 1, y: 2, z: 3 }, size: { x: 2, y: 4, z: 6 }, rotationDeg: { x: 0, y: 90, z: 0 } };
    const { positions } = solidsToTriangles([s]);
    const expected = [-2, 4].flatMap((x) => [0, 4].flatMap((y) => [2, 4].map((z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`)));
    expect(corners(positions, 0, 8)).toEqual(expected.sort());
  });

  it('every face points outwards, so a box top is walkable and a tilted slab top leans by its angle', () => {
    const flat: Solid = { id: 'f', kind: 'building', center: { x: 0, y: 1, z: 0 }, size: { x: 2, y: 2, z: 2 }, rotationDeg: { x: 0, y: 90, z: 0 } };
    const tilted: Solid = { id: 't', kind: 'ramp', center: { x: 0, y: 1, z: 0 }, size: { x: 4, y: 0.5, z: 4 }, rotationDeg: { x: 30, y: 0, z: 0 } };
    for (const s of [flat, tilted]) {
      const { positions, indices } = solidsToTriangles([s]);
      const ups: number[] = [];
      for (let t = 0; t < 12; t++) {
        const n = normalOf(positions, indices, t);
        // Outward: from the box centre towards the triangle's first corner
        const i = indices[t * 3]!;
        const out = { x: positions[i * 3]! - s.center.x, y: positions[i * 3 + 1]! - s.center.y, z: positions[i * 3 + 2]! - s.center.z };
        expect(n.x * out.x + n.y * out.y + n.z * out.z).toBeGreaterThan(0);
        const len = Math.hypot(n.x, n.y, n.z);
        ups.push(n.y / len);
      }
      const top = Math.max(...ups);
      const angle = s.rotationDeg!.x;
      expect(top).toBeCloseTo(Math.cos((angle * Math.PI) / 180), 5);
    }
  });

  it('a chute faces nothing up (the courier only ever slides down it), a ramp of the same slope does', () => {
    const slab = (kind: Solid['kind']): Solid => ({ id: kind, kind, center: { x: 0, y: 2, z: 0 }, size: { x: 4, y: 0.6, z: 20 }, rotationDeg: { x: 15, y: 0, z: 0 } });
    const ups = (s: Solid): number => {
      const { positions, indices } = solidsToTriangles([s]);
      return [...Array(12).keys()].filter((t) => normalOf(positions, indices, t).y > 0).length;
    };
    // The top and, tilted 15° about x, one end face
    expect(ups(slab('ramp'))).toBe(4);
    expect(ups(slab('chute'))).toBe(0);
    expect(ups({ ...slab('ramp'), surface: 'chute' })).toBe(0);
  });
});
