import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { measureGlb } from '../../src/assets/measure';
import { FIXTURE_PACKS } from '../helpers/fixtures';

describe('measureGlb', () => {
  it('offset box fixture: size 2x3x4, pivot x 1, minY -1.5, 12 tris', async () => {
    const m = await measureGlb(join(FIXTURE_PACKS, 'fixture/offset.glb'));
    expect(m.size).toEqual({ w: 2, h: 3, d: 4 });
    expect(m.pivot).toEqual({ x: 1, z: 0, minY: -1.5 });
    expect(m.tris).toBe(12);
    expect(m.bytes).toBeGreaterThan(100);
  });

  it('box at the origin has pivot 0', async () => {
    const m = await measureGlb(join(FIXTURE_PACKS, 'fixture/box.glb'));
    expect(m.pivot).toEqual({ x: 0, z: 0, minY: -1.5 });
  });
});
