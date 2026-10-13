import { describe, expect, it } from 'vitest';
import { bandFor, streetDistance } from '../../src/world/distance';
import { ordersConfig } from '../../src/config';
import { vec3 } from '../../src/math/vec3';

const b = ordersConfig.bands;

describe('distance', () => {
  it('streetDistance is Manhattan on x/z and ignores y', () => {
    expect(streetDistance(vec3(0, 0, 0), vec3(30, 5, -40))).toBe(70);
  });

  it('bandFor boundaries', () => {
    expect(bandFor(149.9, b)).toBe('short');
    expect(bandFor(150, b)).toBe('medium');
    expect(bandFor(350, b)).toBe('medium');
    expect(bandFor(350.01, b)).toBe('long');
  });
});
