import { describe, expect, it } from 'vitest';
import { vec3 } from '../../src/math/vec3';
import { chunkOf, chunksOverlapping, chunksWithin, solidRect } from '../../src/world/chunks';

describe('chunk maths', () => {
  it('chunkOf(-0.01, 0, 100) is "-1,0"; chunkOf(99.99, 199.99, 100) is "0,1"', () => {
    expect(chunkOf(-0.01, 0, 100)).toBe('-1,0');
    expect(chunkOf(99.99, 199.99, 100)).toBe('0,1');
  });

  it('chunksWithin radius 150 around (50,0,50) with size 100 returns the chunks whose square lies within 150 m (the 3×3 block plus the four tips)', () => {
    const got = chunksWithin(vec3(50, 0, 50), 150, 100);
    const want: string[] = [];
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        // (±2, ±1) is 150 m + 50 m off the centre: hypot(150, 50) > 150, so it is out; the 5×5 corners likewise
        if ((Math.abs(cx) <= 1 && Math.abs(cz) <= 1) || (Math.abs(cx) + Math.abs(cz) === 2 && (cx === 0 || cz === 0))) {
          want.push(`${cx},${cz}`);
        }
      }
    }
    expect(got).toHaveLength(13);
    expect([...got].sort()).toEqual(want.sort());
  });

  it('chunksWithin agrees with a brute-force nearest-point distance for an off-grid centre', () => {
    const c = vec3(-37.3, 4, 161.9);
    const r = 130;
    const size = 64;
    const want: string[] = [];
    for (let cx = -12; cx <= 12; cx++) {
      for (let cz = -12; cz <= 12; cz++) {
        const dx = Math.max(cx * size - c.x, 0, c.x - (cx + 1) * size);
        const dz = Math.max(cz * size - c.z, 0, c.z - (cz + 1) * size);
        if (Math.hypot(dx, dz) <= r) want.push(`${cx},${cz}`);
      }
    }
    expect([...chunksWithin(c, r, size)].sort()).toEqual(want.sort());
  });

  it('chunksWithin ignores the centre height', () => {
    expect([...chunksWithin(vec3(50, 99, 50), 10, 100)]).toEqual(['0,0']);
  });

  it('solidRect of a 10×1×2 box rotated 90° about y is 2 × 10', () => {
    const r = solidRect({ id: 's', kind: 'prop', center: vec3(5, 0, -3), size: vec3(10, 1, 2), rotationDeg: vec3(0, 90, 0) });
    expect(r.maxX - r.minX).toBeCloseTo(2, 9);
    expect(r.maxZ - r.minZ).toBeCloseTo(10, 9);
    expect((r.minX + r.maxX) / 2).toBeCloseTo(5, 9);
    expect((r.minZ + r.maxZ) / 2).toBeCloseTo(-3, 9);
  });

  it('solidRect of an unrotated box is its footprint, and a 45° y-rotation widens it', () => {
    const plain = solidRect({ id: 's', kind: 'prop', center: vec3(0, 0, 0), size: vec3(4, 1, 2) });
    expect(plain).toEqual({ minX: -2, minZ: -1, maxX: 2, maxZ: 1 });
    const diag = solidRect({ id: 's', kind: 'prop', center: vec3(0, 0, 0), size: vec3(4, 1, 2), rotationDeg: vec3(0, 45, 0) });
    expect(diag.maxX - diag.minX).toBeCloseTo((4 + 2) * Math.SQRT1_2, 9);
  });

  it('a 20 m box straddling x = 0 overlaps chunks -1,0 and 0,0', () => {
    const rect = { minX: -10, minZ: 10, maxX: 10, maxZ: 20 };
    expect([...chunksOverlapping(rect, 100)].sort()).toEqual(['-1,0', '0,0']);
  });

  it('a rect ending exactly on a chunk edge does not overlap the next chunk', () => {
    expect([...chunksOverlapping({ minX: 10, minZ: 10, maxX: 100, maxZ: 20 }, 100)]).toEqual(['0,0']);
  });
});
