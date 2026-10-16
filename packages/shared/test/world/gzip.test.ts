import { gzipSync } from 'node:zlib';
import { afterEach, expect, test, vi } from 'vitest';
import { gunzip } from '../../src/world/gzip';

/** 1 MB shaped like a navmesh export: tile headers, vertex floats and polygon indices, mostly repeating. */
function navmeshLike(): Uint8Array {
  const bytes = new Uint8Array(1 << 20);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i + 4 <= bytes.length; i += 4) {
    const k = i >> 2;
    if (k % 64 === 0) view.setUint32(i, 0x444e4156, true); // a header magic every 256 bytes
    else if (k % 3 === 0) view.setUint16(i, k & 0x3ff, true);
    else view.setFloat32(i, Math.round((k % 1000) * 0.3 * 10) / 10, true);
  }
  return bytes;
}

afterEach(() => vi.unstubAllGlobals());

test('1 MB of navmesh-like bytes round-trip through zlib.gzipSync and gunzip', async () => {
  const raw = navmeshLike();
  const gz = new Uint8Array(gzipSync(raw));
  expect(gz.length).toBeLessThan(raw.length);
  const back = await gunzip(gz);
  expect(back.length).toBe(raw.length);
  expect(Buffer.from(back).equals(Buffer.from(raw))).toBe(true);
});

test('without DecompressionStream (older Node) gunzip falls back to zlib', async () => {
  const raw = navmeshLike().subarray(0, 4096);
  vi.stubGlobal('DecompressionStream', undefined);
  const back = await gunzip(new Uint8Array(gzipSync(raw)));
  expect(Buffer.from(back).equals(Buffer.from(raw))).toBe(true);
});
