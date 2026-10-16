import { statSync } from 'node:fs';
import { type Node, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

export interface Measure {
  size: { w: number; h: number; d: number };
  pivot: { x: number; z: number; minY: number };
  tris: number;
  bytes: number;
}

const r2 = (v: number): number => Math.round(v * 100) / 100 + 0; // +0 turns -0 into 0

function triangles(node: Node): number {
  let n = 0;
  const mesh = node.getMesh();
  if (mesh) {
    for (const p of mesh.listPrimitives()) {
      if (p.getMode() < 4) continue; // points and lines
      const idx = p.getIndices();
      n += Math.floor((idx ? idx.getCount() : (p.getAttribute('POSITION')?.getCount() ?? 0)) / 3);
    }
  }
  for (const c of node.listChildren()) n += triangles(c);
  return n;
}

/** World-space bounds over the first scene's node graph (as docs/.../measure_glb.py); pivot is the bounds centre in x, z and the lowest y. */
export async function measureGlb(path: string): Promise<Measure> {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions([KHRMeshQuantization, EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(path);
  const scene = doc.getRoot().listScenes()[0];
  const bytes = statSync(path).size;
  if (!scene) return { size: { w: 0, h: 0, d: 0 }, pivot: { x: 0, z: 0, minY: 0 }, tris: 0, bytes };
  const tris = scene.listChildren().reduce((a, n) => a + triangles(n), 0);
  const { min, max } = getBounds(scene);
  if (!tris || !Number.isFinite(min[0]) || !Number.isFinite(max[0])) {
    return { size: { w: 0, h: 0, d: 0 }, pivot: { x: 0, z: 0, minY: 0 }, tris, bytes };
  }
  return {
    size: { w: r2(max[0] - min[0]), h: r2(max[1] - min[1]), d: r2(max[2] - min[2]) },
    pivot: { x: r2((min[0] + max[0]) / 2), z: r2((min[2] + max[2]) / 2), minY: r2(min[1]) },
    tris,
    bytes,
  };
}
