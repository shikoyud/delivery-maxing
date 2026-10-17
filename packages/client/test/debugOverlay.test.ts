import { describe, expect, it } from 'vitest';
import { cityLines, rideLine } from '../src/ui/debugOverlay';

describe('debug overlay ride line', () => {
  it('ride: car · 21.4 m/s · fuel 73 %; no fuel part without a tank; none on foot', () => {
    expect(rideLine('car', 21.43, 0.731)).toBe('ride: car · 21.4 m/s · fuel 73 %');
    expect(rideLine('bicycle', 12, null)).toBe('ride: bicycle · 12.0 m/s');
    expect(rideLine(null, 7.9, null)).toBe('ride: none');
  });
});

describe('debug overlay city lines', () => {
  it('loaded chunks, city stats and the CityView.update cost; nothing on the greybox', () => {
    expect(cityLines({ chunks: 12, city: { instances: 840, blocks: 31, models: 22, missing: 3 }, cityUpdateMs: 0.437 })).toEqual([
      'chunks 12',
      'city   840 inst · 31 blocks · 22 models · 3 missing',
      'cityUp 0.44 ms',
    ]);
    expect(cityLines({ chunks: null, city: null, cityUpdateMs: null })).toEqual([]);
    expect(cityLines({ chunks: 9, city: null, cityUpdateMs: null })).toEqual(['chunks 9']);
  });
});
