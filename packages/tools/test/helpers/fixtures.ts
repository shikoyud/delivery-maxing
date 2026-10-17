import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';

export const FIXTURE_PACKS = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/packs');

/** A 2 (x) x 3 (y) x 4 (z) m box centred on its node, which sits at `offsetX` m: 12 triangles. */
export async function writeBox(path: string, offsetX: number): Promise<void> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const hx = 1;
  const hy = 1.5;
  const hz = 2;
  // 8 corners, 12 triangles
  const pos = new Float32Array([
    -hx, -hy, -hz, hx, -hy, -hz, hx, hy, -hz, -hx, hy, -hz, -hx, -hy, hz, hx, -hy, hz, hx, hy, hz, -hx, hy, hz,
  ]);
  const idx = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 6, 2, 3, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
  const position = doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf);
  const indices = doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute('POSITION', position).setIndices(indices);
  const mesh = doc.createMesh('box').addPrimitive(prim);
  const node = doc.createNode('box').setMesh(mesh).setTranslation([offsetX, 0, 0]);
  doc.createScene('s').addChild(node);
  mkdirSync(dirname(path), { recursive: true });
  await new NodeIO().write(path, doc);
}

/** Writes fixture/box.glb (at the origin) and fixture/offset.glb (1 m in x) under `root`. */
export async function writeFixturePacks(root: string = FIXTURE_PACKS): Promise<void> {
  await writeBox(join(root, 'fixture/box.glb'), 0);
  await writeBox(join(root, 'fixture/offset.glb'), 1);
}
