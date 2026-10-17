import { describe, expect, it } from 'vitest';
import { parseCityLayout } from '../../src/world/cityLayout';
import type { CityLayout, Level } from '../../src/world/cityLayout';
import { cityLayoutFixture } from './cityFixtures';

const json = (): CityLayout => JSON.parse(JSON.stringify(cityLayoutFixture())) as CityLayout;

describe('parseCityLayout', () => {
  it('accepts a minimal fixture', () => {
    const l = parseCityLayout(json());
    expect(l.lots).toHaveLength(4);
    expect(l.connectors.map((c) => c.kind)).toEqual(['switchback', 'steepLane', 'stairs']);
  });

  it('rejects a lot whose asset is not a string, naming the lot', () => {
    const j = json();
    j.lots[1]!.asset = 7 as unknown as string;
    expect(() => parseCityLayout(j)).toThrow(/lot-house/);
  });

  it('rejects a connector with z1 <= z0', () => {
    const j = json();
    j.connectors[1]!.z1 = j.connectors[1]!.z0;
    expect(() => parseCityLayout(j)).toThrow(/sl-1/);
  });

  it('rejects a road rect with maxX <= minX', () => {
    const j = json();
    j.roads[0]!.rect.maxX = j.roads[0]!.rect.minX;
    expect(() => parseCityLayout(j)).toThrow(/road-ave/);
  });

  it('rejects a wrong version and an unknown level', () => {
    const a = json();
    (a as unknown as { version: number }).version = 2;
    expect(() => parseCityLayout(a)).toThrow();
    const b = json();
    b.lots[0]!.level = 'L9' as Level;
    expect(() => parseCityLayout(b)).toThrow(/lot-bakery/);
  });

  it('accepts a lot stack of a whole number from 1 and rejects any other', () => {
    const ok = json();
    ok.lots[2]!.stack = 2;
    expect(() => parseCityLayout(ok)).not.toThrow();
    for (const bad of [0, 1.5, '2']) {
      const j = json();
      (j.lots[2] as unknown as { stack: unknown }).stack = bad;
      expect(() => parseCityLayout(j)).toThrow(/lot-tree/);
    }
  });
});
