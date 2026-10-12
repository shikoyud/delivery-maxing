import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { PNG } from 'pngjs';

export const PALETTE_SIZE = 32;

/**
 * Stacks the 32 × 32 palette PNGs top to bottom into one 32 × (32·n) atlas.
 * Row i (image rows 32i..32i+31) is `pngs[i]`; `rows` are the file base names in the same order.
 */
export function buildPaletteAtlas(pngs: string[]): { png: Buffer; rows: string[] } {
  const n = PALETTE_SIZE;
  const atlas = new PNG({ width: n, height: n * pngs.length });
  const rows = pngs.map((path, i) => {
    const name = basename(path, extname(path));
    const img = PNG.sync.read(readFileSync(path));
    if (img.width !== n || img.height !== n) {
      throw new Error(`palette ${name} is ${img.width}×${img.height}, expected ${n}×${n}`);
    }
    img.data.copy(atlas.data, i * n * n * 4);
    return name;
  });
  return { png: PNG.sync.write(atlas), rows };
}
