import { describe, expect, it } from 'vitest';
import { ordersConfig } from '../../src/config';
import { vec3, type Vec3 } from '../../src/math/vec3';
import { districtWeight, eligiblePois, type SelectionContext } from '../../src/orders/selection';
import type { PoiInfo } from '../../src/world/distance';
import type { District } from '../../src/world/mapTypes';

const cfg = ordersConfig.selection;

const info = (id: string, position: Vec3, district: District = 'downtown'): PoiInfo => ({
  poi: { id, position, district, kind: 'door' },
  hubDistance: 100,
  band: 'short',
  elevated: false,
});

const sel = (over: Partial<SelectionContext> = {}): SelectionContext => ({
  now: 0,
  recentUse: new Map(),
  activePois: [],
  recentDistricts: [],
  ...over,
});

const ids = (ps: PoiInfo[]): string[] => ps.map((p) => p.poi.id);

describe('eligiblePois', () => {
  it("a POI within 40 m (horizontal) of an active order's POI is excluded", () => {
    const pois = [
      info('near', vec3(139.9, 0, 0)), // 39.9 m from the active POI
      info('edge', vec3(100, 0, 40)), // exactly 40 m: allowed
      info('above', vec3(100, 30, 10)), // 30 m up, 10 m across: horizontal 10 m, excluded
      info('far', vec3(-100, 0, 0)),
    ];
    const ctx = sel({ activePois: [vec3(100, 0, 0)] });
    expect(ids(eligiblePois(pois, ctx, cfg))).toEqual(['edge', 'far']);
  });

  it('a POI accepted at t=100 is excluded at t=279 and allowed at t=280', () => {
    const pois = [info('used', vec3(0, 0, 0)), info('other', vec3(500, 0, 0))];
    const recentUse = new Map([['used', 100]]);
    expect(ids(eligiblePois(pois, sel({ now: 279, recentUse }), cfg))).toEqual(['other']);
    expect(ids(eligiblePois(pois, sel({ now: 280, recentUse }), cfg))).toEqual(['used', 'other']);
  });

  it('with no active orders and no recent use every POI is eligible', () => {
    const pois = [info('a', vec3(0, 0, 0)), info('b', vec3(1, 0, 0))];
    expect(ids(eligiblePois(pois, sel(), cfg))).toEqual(['a', 'b']);
  });
});

describe('districtWeight', () => {
  it('districtWeight is 1/3 for a district appearing twice in the last 6', () => {
    const ctx = sel({ recentDistricts: ['harbor', 'downtown', 'harbor', 'suburbs', 'suburbs', 'suburbs'] });
    expect(districtWeight('harbor', ctx, cfg)).toBeCloseTo(1 / 3, 12);
    expect(districtWeight('downtown', ctx, cfg)).toBeCloseTo(1 / 2, 12);
    expect(districtWeight('suburbs', ctx, cfg)).toBeCloseTo(1 / 4, 12);
    expect(districtWeight('hillside', ctx, cfg)).toBe(1);
  });

  it('only the most recent districtWindow (6) entries count', () => {
    const ctx = sel({ recentDistricts: ['suburbs', 'suburbs', 'suburbs', 'suburbs', 'suburbs', 'suburbs', 'harbor'] });
    expect(districtWeight('harbor', ctx, cfg)).toBe(1);
    expect(districtWeight('suburbs', ctx, cfg)).toBeCloseTo(1 / 7, 12);
  });
});
