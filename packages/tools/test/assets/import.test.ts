import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseCatalog, type AssetCatalog, type CatalogEntry } from '@dm/shared';
import { importPacks } from '../../src/assets/import';
import { FIXTURE_PACKS } from '../helpers/fixtures';

const entry = (id: string, file: string | null, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  file,
  category: 'prop',
  size: { w: 2, h: 3, d: 4 },
  pivot: { x: 0, z: 0, minY: -1.5 },
  tris: 12,
  use: 'placed',
  ...over,
});
const cat = (...entries: CatalogEntry[]): AssetCatalog => parseCatalog({ version: 1, packs: {}, entries });

/** The JSON chunk of a GLB (chunk 0). */
function glbJson(path: string): { extensionsRequired?: string[]; meshes: unknown[] } {
  const b = readFileSync(path);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

const out = mkdtempSync(join(tmpdir(), 'dm-import-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('importPacks', () => {
  it('writes each used model compressed under its id, no LOD1 for a 12-triangle box, and a manifest', async () => {
    const r = await importPacks(
      FIXTURE_PACKS,
      cat(
        entry('fixture/box', 'fixture/box.glb'),
        entry('fixture/offset', 'fixture/offset.glb', { use: 'prop' }),
        entry('fixture/unused', 'fixture/box.glb', { use: 'unused' }),
        entry('missing/Thing', null, { status: 'missing' }),
        entry('fixture/gone', 'fixture/gone.glb'),
      ),
      out,
    );
    const box = join(out, 'fixture/box.glb');
    expect(existsSync(box)).toBe(true);
    expect(existsSync(join(out, 'fixture/offset.glb'))).toBe(true);
    expect(existsSync(join(out, 'fixture/unused.glb'))).toBe(false);
    // The 12-triangle box's GLB grows by the extensions' JSON (~0.5 KB): its binary payload is what shrinks. The
    // sphere below checks whole files.
    const payload = (j: { buffers: { byteLength: number; extensions?: object }[] }) =>
      j.buffers.filter((b) => !b.extensions).reduce((n, b) => n + b.byteLength, 0);
    expect(payload(glbJson(box) as never)).toBeLessThan(payload(glbJson(join(FIXTURE_PACKS, 'fixture/box.glb')) as never));
    expect(glbJson(box).extensionsRequired).toContain('EXT_meshopt_compression');
    expect(glbJson(box).meshes).toHaveLength(1);
    expect(existsSync(join(out, 'fixture/box.lod1.glb'))).toBe(false);
    expect(r).toEqual({ written: 2, lod1: 0, skipped: ['fixture/gone'], bytes: expect.any(Number) });
    expect(r.bytes).toBe(statSync(box).size + statSync(join(out, 'fixture/offset.glb')).size + statSync(join(out, 'manifest.json')).size);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(manifest).toEqual({ version: 1, models: { 'fixture/box': { lod1: false }, 'fixture/offset': { lod1: false } } });
  });
});

/** A UV sphere of radius 2 (`seg` × `seg / 2` quads), textured with `png` when given, else untextured red. */
async function writeSphere(path: string, seg: number, png?: Uint8Array): Promise<void> {
  const { Document, NodeIO } = await import('@gltf-transform/core');
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const doc = new Document();
  const buf = doc.createBuffer();
  const rows = seg / 2;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= seg; i++) {
      const th = (j / rows) * Math.PI;
      const ph = (i / seg) * Math.PI * 2;
      const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      nrm.push(...n);
      pos.push(n[0]! * 2, n[1]! * 2 + 2, n[2]! * 2);
      uv.push(i / seg, j / rows);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const acc = (type: 'VEC3' | 'VEC2' | 'SCALAR', a: Float32Array | Uint16Array) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(pos)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(nrm)))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(uv)))
    .setIndices(acc('SCALAR', new Uint16Array(idx)));
  const mat = doc.createMaterial('MAIN');
  if (png) mat.setBaseColorTexture(doc.createTexture('atlas').setImage(png).setMimeType('image/png'));
  else mat.setBaseColorFactor([1, 0, 0, 1]);
  prim.setMaterial(mat);
  doc.createScene('s').addChild(doc.createNode('sphere').setMesh(doc.createMesh('sphere').addPrimitive(prim)));
  mkdirSync(dirname(path), { recursive: true });
  await new NodeIO().write(path, doc);
}

// 1 × 1 white PNG
const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64'),
);

describe('importPacks: LOD1 and shared textures', () => {
  const src = mkdtempSync(join(tmpdir(), 'dm-import-src-'));
  const dst = mkdtempSync(join(tmpdir(), 'dm-import-dst-'));
  afterAll(() => {
    rmSync(src, { recursive: true, force: true });
    rmSync(dst, { recursive: true, force: true });
  });

  it('writes a LOD1 when simplify drops at least 30% of the triangles; textures go to textures/ once', async () => {
    await writeSphere(join(src, 'p/a.glb'), 48, PNG);
    await writeSphere(join(src, 'p/b.glb'), 48, PNG);
    await writeSphere(join(src, 'p/red.glb'), 48);
    const r = await importPacks(src, cat(entry('x/a', 'p/a.glb'), entry('x/b', 'p/b.glb'), entry('x/red', 'p/red.glb')), dst);
    expect(r.written).toBe(3);
    expect(r.lod1).toBe(3);
    expect(statSync(join(dst, 'x/red.glb')).size).toBeLessThan(statSync(join(src, 'p/red.glb')).size / 2);
    for (const id of ['a', 'b', 'red']) expect(existsSync(join(dst, `x/${id}.lod1.glb`))).toBe(true);
    const a = glbJson(join(dst, 'x/a.glb')) as unknown as { materials: { name: string }[]; images?: unknown[] };
    expect(a.images ?? []).toEqual([]);
    const tex = a.materials[0]!.name;
    expect(tex).toMatch(/^tex:[0-9a-f]{12}\.png$/);
    expect(existsSync(join(dst, 'textures', tex.slice(4)))).toBe(true);
    expect((glbJson(join(dst, 'x/b.glb')) as unknown as { materials: { name: string }[] }).materials[0]!.name).toBe(tex);
    expect((glbJson(join(dst, 'x/red.glb')) as unknown as { materials: { name: string }[] }).materials[0]!.name).toBe('flat');
    const manifest = JSON.parse(readFileSync(join(dst, 'manifest.json'), 'utf8'));
    expect(manifest.models['x/a']).toEqual({ lod1: true });
  });
});
