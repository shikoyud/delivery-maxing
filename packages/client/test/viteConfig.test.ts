import { describe, expect, it } from 'vitest';
import { isGzAssetRequest } from '../vite.config';

describe('isGzAssetRequest (dev and preview servers)', () => {
  it('treats a .gz file request as gzip bytes, with or without a cache-busting query', () => {
    expect(isGzAssetRequest('/assets/city-car-abc123.bin.gz')).toBe(true);
    expect(isGzAssetRequest('/@fs/repo/map/nav/city-car.bin.gz')).toBe(true);
    expect(isGzAssetRequest('/@fs/repo/map/nav/city-car.bin.gz?t=1700000000')).toBe(true);
  });

  it("leaves Vite's module requests for a .gz import alone (they are JavaScript)", () => {
    expect(isGzAssetRequest('/@fs/repo/map/nav/city-car.bin.gz?import&url')).toBe(false);
    expect(isGzAssetRequest('/@fs/repo/map/city.distances.bin.gz?url')).toBe(false);
    expect(isGzAssetRequest('/@fs/repo/map/nav/city-car.bin.gz?import')).toBe(false);
  });

  it('ignores other files', () => {
    expect(isGzAssetRequest('/src/main.ts')).toBe(false);
    expect(isGzAssetRequest('/packs/manifest.json')).toBe(false);
  });
});
