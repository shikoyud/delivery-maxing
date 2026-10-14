import { describe, expect, it } from 'vitest';
import { rideLine } from '../src/ui/debugOverlay';

describe('debug overlay ride line', () => {
  it('ride: car · 21.4 m/s · fuel 73 %; no fuel part without a tank; none on foot', () => {
    expect(rideLine('car', 21.43, 0.731)).toBe('ride: car · 21.4 m/s · fuel 73 %');
    expect(rideLine('bicycle', 12, null)).toBe('ride: bicycle · 12.0 m/s');
    expect(rideLine(null, 7.9, null)).toBe('ride: none');
  });
});
