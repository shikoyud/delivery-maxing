import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { buildPaletteAtlas } from '../../src/assets/atlas';

function solidPng(path: string, rgb: [number, number, number]): void {
  const png = new PNG({ width: 32, height: 32 });
  for (let i = 0; i < 32 * 32; i++) png.data.set([...rgb, 255], i * 4);
  writeFileSync(path, PNG.sync.write(png));
}

describe('buildPaletteAtlas', () => {
  it('three 32×32 palettes stack into 32×96 with rows in config order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-'));
    const files = [
      ['Texture_Red', [255, 0, 0]],
      ['Texture_Green', [0, 255, 0]],
      ['Texture_Blue', [0, 0, 255]],
    ] as const;
    const paths = files.map(([name, rgb]) => {
      const p = join(dir, `${name}.png`);
      solidPng(p, [...rgb]);
      return p;
    });
    const { png, rows } = buildPaletteAtlas(paths);
    expect(rows).toEqual(['Texture_Red', 'Texture_Green', 'Texture_Blue']);
    const img = PNG.sync.read(png);
    expect([img.width, img.height]).toEqual([32, 96]);
    const px = (x: number, y: number) => [...img.data.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
    expect(px(0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(31, 31)).toEqual([255, 0, 0, 255]);
    expect(px(5, 32)).toEqual([0, 255, 0, 255]);
    expect(px(31, 95)).toEqual([0, 0, 255, 255]);
  });

  it('rejects a palette that is not 32×32', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-'));
    const p = join(dir, 'Texture_Big.png');
    writeFileSync(p, PNG.sync.write(new PNG({ width: 64, height: 32 })));
    expect(() => buildPaletteAtlas([p])).toThrow(/Texture_Big/);
  });
});
