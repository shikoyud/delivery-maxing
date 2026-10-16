import { describe, expect, it } from 'vitest';
import { terrainSolids } from '../../src/world/terrainSolids';
import { cityLayoutFixture } from './cityFixtures';

describe('terrainSolids', () => {
  it('returns a ground solid per level (L0 split at the water) for now', () => {
    const ids = terrainSolids(cityLayoutFixture()).map((s) => s.id);
    expect(ids).toEqual(['ground-L0-docks', 'ground-L0-beach', 'ground-L0-harbor', 'ground-L1', 'ground-L2', 'ground-L3', 'ground-ridge']);
  });
});
