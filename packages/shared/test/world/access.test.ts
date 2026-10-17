import { describe, expect, it } from 'vitest';
import { vec3 } from '../../src/math/vec3';
import { accessAllowed, baySlot, forbiddenZoneAt, zoneAt } from '../../src/world/access';
import { emptyMap, testHospital } from './fixtures';

const mapWithAlley = () => ({
  ...emptyMap(),
  accessZones: [{ id: 'alley-test', kind: 'alley' as const, rect: { minX: 0, minZ: 0, maxX: 4, maxZ: 20 }, minY: 0, maxY: 0 }],
});

describe('access', () => {
  it('accessAllowed follows spec §4.3', () => {
    expect(accessAllowed('car', 'alley')).toBe(false);
    expect(accessAllowed('motorbike', 'alley')).toBe(true);
    expect(accessAllowed('skateboard', 'steepLane')).toBe(false);
    expect(accessAllowed('bicycle', 'stairs')).toBe(false);
    expect(accessAllowed('walk', 'stairs')).toBe(true);
    expect(accessAllowed('motorbike', 'path')).toBe(false);
  });

  it('forbiddenZoneAt: a car in an alley zone gets the zone, a bicycle gets null', () => {
    const map = mapWithAlley();
    const p = vec3(2, 0, 10);
    expect(forbiddenZoneAt(map, 'car', p)?.id).toBe('alley-test');
    expect(forbiddenZoneAt(map, 'bicycle', p)).toBeNull();
    expect(forbiddenZoneAt(map, 'car', vec3(10, 0, 10))).toBeNull();
  });

  it('zoneAt includes rect edges and ignores a point far above the zone (a bridge over an alley)', () => {
    const map = mapWithAlley();
    expect(zoneAt(map, vec3(4, 0.4, 20))?.id).toBe('alley-test');
    expect(zoneAt(map, vec3(2, 0 + 3, 10))).toBeNull();
  });

  it('baySlot lines slots up behind the first, along the street, by bays.spacing', () => {
    const h = { ...testHospital('h'), bay: vec3(10, 0, 20), bayYaw: Math.PI };
    const s0 = baySlot(h, 0);
    const s2 = baySlot(h, 2);
    expect(s0.position).toEqual(h.bay);
    expect(Math.hypot(s2.position.x - s0.position.x, s2.position.z - s0.position.z)).toBeCloseTo(8, 6);
    expect(s2.position.z).toBeCloseTo(12, 6);
    expect(s2.position.x).toBeCloseTo(10, 6);
    expect(s2.heading).toBe(h.bayYaw);
  });
});
