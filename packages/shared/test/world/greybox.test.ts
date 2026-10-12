import { describe, expect, it } from 'vitest';
import { expandGreybox } from '../../src/world/greybox';
import greyboxJson from '../../../../map/greybox.json';
import type { GreyboxSource } from '../../src/world/mapTypes';
import { greyboxFixture } from './fixtures';

const buildings = (src: GreyboxSource) => expandGreybox(src).solids.filter((s) => s.kind === 'building');

describe('expandGreybox', () => {
  it('is deterministic for a seed', () => {
    const src = greyboxFixture();
    expect(expandGreybox(src)).toEqual(expandGreybox(src));
  });

  it('adds a ground slab whose top is y = 0 and spans size x size', () => {
    const g = expandGreybox(greyboxFixture()).solids.find((s) => s.id === 'ground');
    expect(g).toBeDefined();
    expect(g!.center.y + g!.size.y / 2).toBe(0);
    expect(g!.size.x).toBe(400);
    expect(g!.size.z).toBe(400);
  });

  it('generates buildings with heights rounded to 0.5 m within range', () => {
    const b = buildings(greyboxFixture());
    expect(b.length).toBeGreaterThan(10);
    for (const s of b) {
      expect(s.size.y % 0.5).toBe(0);
      expect(s.size.y).toBeGreaterThanOrEqual(10);
      expect(s.size.y).toBeLessThanOrEqual(40);
      expect(s.center.y - s.size.y / 2).toBe(0);
    }
  });

  it('never places a generated building over a reserved rect', () => {
    for (const s of buildings(greyboxFixture())) {
      const overlaps =
        s.center.x + s.size.x / 2 > -40 && s.center.x - s.size.x / 2 < 40 &&
        s.center.z + s.size.z / 2 > -40 && s.center.z - s.size.z / 2 < 40;
      expect(overlaps).toBe(false);
    }
  });

  it('keeps generated buildings inside block interiors (never on roads)', () => {
    const half = 6; // roadWidth / 2
    for (const s of buildings(greyboxFixture())) {
      for (const [c, h] of [[s.center.x, s.size.x / 2], [s.center.z, s.size.z / 2]] as const) {
        const lo = c - h;
        const hi = c + h;
        // roads are centred on multiples of 50; footprint must stay clear of them
        const road = Math.round(c / 50) * 50;
        expect(Math.min(Math.abs(lo - road), Math.abs(hi - road))).toBeGreaterThanOrEqual(half - 1e-9);
        expect(Math.floor((lo + 1e-9) / 50)).toBe(Math.floor((hi - 1e-9) / 50));
      }
    }
  });

  it('keeps hand-placed solids and features unchanged', () => {
    const src = greyboxFixture();
    const out = expandGreybox(src);
    expect(out.solids).toContainEqual(src.solids[0]);
    expect(out.zipLines).toEqual(src.zipLines);
    expect(out.checkpoints).toEqual(src.checkpoints);
    expect(out.hub).toEqual(src.hub);
    expect(out.size).toBe(src.size);
  });

  it('has unique ids', () => {
    const ids = expandGreybox(greyboxFixture()).solids.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('expands map/greybox.json without error into buildings in every district', () => {
    // The city's content (POIs, features, layout) is covered by greyboxContent.test.ts.
    const src = greyboxJson as unknown as GreyboxSource;
    const out = expandGreybox(src);
    expect(out.solids.filter((s) => s.id === 'ground')).toHaveLength(1);
    for (const d of src.districts) {
      const inD = buildings(src).filter(
        (s) => /^b-/.test(s.id) && s.center.x >= d.rect.minX && s.center.x <= d.rect.maxX && s.center.z >= d.rect.minZ && s.center.z <= d.rect.maxZ,
      );
      expect(inD.length, d.district).toBeGreaterThan(0);
      for (const s of inD) {
        expect(s.size.y).toBeGreaterThanOrEqual(d.heightMin);
        expect(s.size.y).toBeLessThanOrEqual(d.heightMax);
      }
    }
  });
});
