import { describe, expect, it } from 'vitest';
import { cityAssetUrl, parseMapKind } from '../src/game/mapLoader';

describe('parseMapKind', () => {
  it('defaults to the city (Task 15), accepts city and greybox, rejects anything else', () => {
    expect(parseMapKind(null)).toBe('city');
    expect(parseMapKind('city')).toBe('city');
    expect(parseMapKind('greybox')).toBe('greybox');
    expect(() => parseMapKind('moon')).toThrow(/moon/);
  });
});

describe('cityAssetUrl', () => {
  it('resolves a catalog path (relative to assets/) to a bundled URL, and throws for unknown files', () => {
    expect(cityAssetUrl('city/buildings/b-4story.glb')).toMatch(/b-4story.*\.glb/);
    expect(cityAssetUrl('city/buildings/b-4story.lod1.glb')).toMatch(/b-4story\.lod1.*\.glb/);
    expect(cityAssetUrl('city/parts/p-balcony.glb')).toMatch(/p-balcony.*\.glb/);
    expect(() => cityAssetUrl('city/buildings/nope.glb')).toThrow(/nope\.glb/);
  });
});
