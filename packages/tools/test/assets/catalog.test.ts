import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { PNG } from 'pngjs';
import { parsePieceCatalog } from '@dm/shared';
import type { AssetsConfig } from '../../src/assets/pipeline';
import { triangleCount } from '../../src/assets/pieceGeometry';

// Reads the committed outputs of `pnpm assets:build`.
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const assets = join(repo, 'assets');
const catalog = parsePieceCatalog(JSON.parse(readFileSync(join(repo, 'map/pieces.json'), 'utf8')));
const cfg = JSON.parse(readFileSync(join(here, '../../assets.config.json'), 'utf8')) as AssetsConfig;
const entries = Object.values(catalog);
const buildings = entries.filter((e) => e.kind === 'building');

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? filesUnder(join(dir, d.name)) : [join(dir, d.name)],
  );
}

describe('committed piece catalog', () => {
  it('lists every configured piece, and every lod file exists', () => {
    expect(Object.keys(catalog).sort()).toEqual(cfg.pieces.map((p) => p.id).sort());
    for (const e of entries) {
      expect(existsSync(join(assets, e.lod0)), e.lod0).toBe(true);
      if (e.lod1) expect(existsSync(join(assets, e.lod1)), e.lod1).toBe(true);
    }
  });

  it('every building has lod1 ≤ 50% of lod0 triangles', () => {
    expect(buildings.length).toBe(26);
    for (const b of buildings) {
      expect(b.lod1, b.id).not.toBeNull();
      expect(b.tris[1], b.id).toBeGreaterThan(0);
      expect(b.tris[1] / b.tris[0], b.id).toBeLessThanOrEqual(0.5);
    }
  });

  it('flat-roof buildings have roofY within ±0.4 m of their AABB top or below it', () => {
    const flat = buildings.filter((b) => b.roofY !== null);
    expect(flat.length).toBeGreaterThan(15);
    for (const b of flat) {
      expect(b.roofY!, b.id).toBeLessThanOrEqual(b.size.y + 0.4);
      // ... and it is the roof, not an intermediate floor: parapets are under 1 m
      expect(b.size.y - b.roofY!, b.id).toBeLessThan(1);
    }
  });

  it('the GLB triangle counts match the catalog', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    for (const e of entries) {
      expect(triangleCount(await io.read(join(assets, e.lod0))), e.lod0).toBe(e.tris[0]);
      if (e.lod1) expect(triangleCount(await io.read(join(assets, e.lod1))), e.lod1).toBe(e.tris[1]);
    }
  });

  it('the palette atlas stacks the configured palettes', () => {
    const img = PNG.sync.read(readFileSync(join(assets, 'city/palette-atlas.png')));
    expect([img.width, img.height]).toEqual([32, 32 * cfg.palettes.length]);
  });

  it('assets/city totals ≤ 6 MB', () => {
    const total = filesUnder(join(assets, 'city')).reduce((s, f) => s + statSync(f).size, 0);
    expect(total).toBeLessThanOrEqual(6_000_000);
  });

  it('no runtime file comes from CasinoSign or Texture_Casino', () => {
    const sources = [...cfg.pieces.map((p) => p.src), ...cfg.palettes];
    expect(sources.filter((s) => /casino/i.test(s))).toEqual([]);
    expect(filesUnder(join(assets, 'city')).filter((f) => /casino/i.test(f))).toEqual([]);
    expect(entries.filter((e) => /casino/i.test(e.id))).toEqual([]);
  });
});
