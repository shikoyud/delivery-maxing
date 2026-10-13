import { describe, expect, it } from 'vitest';
import { vec3 } from '../../src/math/vec3';
import { inSafeZone, nearestHospital } from '../../src/world/hospitals';
import { emptyMap, testHospital } from './fixtures';

const map = () => {
  const m = emptyMap();
  m.hospitals = [testHospital('a', vec3(0, 0, 0)), testHospital('b', vec3(100, 0, 0))];
  return m;
};

describe('hospitals', () => {
  it('nearestHospital picks by horizontal distance', () => {
    const m = map();
    expect(nearestHospital(m, vec3(70, 0, 0)).id).toBe('b');
    expect(nearestHospital(m, vec3(20, 0, 0)).id).toBe('a');
    // Height is ignored: a point high above the first hospital is still nearest to it.
    expect(nearestHospital(m, vec3(10, 500, 0)).id).toBe('a');
  });

  it('inSafeZone is null outside safeRadius and the hospital inside', () => {
    const m = map();
    expect(inSafeZone(m, vec3(18, 0, 0))?.id).toBe('a');
    expect(inSafeZone(m, vec3(18.01, 0, 0))).toBeNull();
    expect(inSafeZone(m, vec3(100, 0, 17))?.id).toBe('b');
    expect(inSafeZone(m, vec3(50, 0, 0))).toBeNull();
  });
});
