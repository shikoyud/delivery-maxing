import { describe, expect, it } from 'vitest';
import { Document, type Node } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import {
  bakeAndCentre,
  dropSmallIslands,
  roofHeight,
  triangleCount,
  wallCollider,
} from '../../src/assets/pieceGeometry';

type V3 = [number, number, number];

/** 24 vertices (4 per face) + 36 indices of an axis-aligned box, outward winding. */
function box(min: V3, max: V3): { pos: V3[]; nrm: V3[]; idx: number[] } {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const faces: { n: V3; c: V3[] }[] = [
    { n: [0, 1, 0], c: [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]] },
    { n: [0, -1, 0], c: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
    { n: [1, 0, 0], c: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
    { n: [-1, 0, 0], c: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
    { n: [0, 0, 1], c: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    { n: [0, 0, -1], c: [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]] },
  ];
  const pos: V3[] = [];
  const nrm: V3[] = [];
  const idx: number[] = [];
  for (const f of faces) {
    const b = pos.length;
    pos.push(...f.c);
    nrm.push(f.n, f.n, f.n, f.n);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { pos, nrm, idx };
}

/**
 * A building in final Y-up metres (before an arbitrary offset), stored the way FBX2glTF writes the pack:
 * Z-up raw positions / 100 on a node rotated −90° about X and scaled ×100.
 *  - two stacked wall boxes x,z ∈ [−3, 3], y 0..3 and 3..6 (the flat roof is at 6)
 *  - a porch slab in front, z 3..4, y 0..0.4
 *  - a small roof box x,z ∈ [−1, 1], y 6..7
 *  - a 0.3 m vent cube on the roof
 */
function fixture(offset: V3 = [10, 2, -5]): { doc: Document; node: Node } {
  const parts = [
    box([-3, 0, -3], [3, 3, 3]),
    box([-3, 3, -3], [3, 6, 3]),
    box([-3, 0, 3], [3, 0.4, 4]),
    box([-1, 6, -1], [1, 7, 1]),
    box([2, 6, 2], [2.3, 6.3, 2.3]),
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const p of parts) {
    const base = pos.length / 3;
    for (const [x, y, z] of p.pos) {
      const fx = x + offset[0];
      const fy = y + offset[1];
      const fz = z + offset[2];
      // final = (100x, 100z, −100y)  ⇒  raw = (fx/100, −fz/100, fy/100)
      pos.push(fx / 100, -fz / 100, fy / 100);
      uv.push(0.5, 0.5);
    }
    for (const [x, y, z] of p.nrm) nrm.push(x, -z, y);
    idx.push(...p.idx.map((i) => i + base));
  }
  const doc = new Document();
  const buf = doc.createBuffer();
  const acc = (type: 'VEC3' | 'VEC2' | 'SCALAR', arr: Float32Array | Uint16Array) =>
    doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(pos)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(nrm)))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(uv)))
    .setIndices(acc('SCALAR', new Uint16Array(idx)));
  const mesh = doc.createMesh('test').addPrimitive(prim);
  const s = Math.SQRT1_2;
  const node = doc.createNode('test').setMesh(mesh).setRotation([-s, 0, 0, s]).setScale([100, 100, 100]);
  const root = doc.createNode('RootNode').addChild(node);
  doc.createScene().addChild(root);
  return { doc, node };
}

const sceneBounds = (doc: Document) => getBounds(doc.getRoot().listScenes()[0]!);

describe('pieceGeometry', () => {
  it('bakeAndCentre bakes a -90° X node rotation and ×100 scale into vertices and puts the base at y = 0', () => {
    const { doc, node } = fixture();
    bakeAndCentre(doc, 1);
    expect(node.getRotation()).toEqual([0, 0, 0, 1]);
    expect(node.getScale()).toEqual([1, 1, 1]);
    const { min, max } = sceneBounds(doc);
    // footprint x −3..3, z −3..4 → centred at z = 0.5
    [-3, 0, -3.5].forEach((v, i) => expect(min[i]).toBeCloseTo(v, 4));
    [3, 7, 3.5].forEach((v, i) => expect(max[i]).toBeCloseTo(v, 4));
    // the top face normal now points up
    const prim = node.getMesh()!.listPrimitives()[0]!;
    expect(prim.getAttribute('NORMAL')!.getElement(0, [])).toEqual([
      expect.closeTo(0, 5),
      expect.closeTo(1, 5),
      expect.closeTo(0, 5),
    ]);
  });

  it('bakeAndCentre applies the scale', () => {
    const { doc } = fixture();
    bakeAndCentre(doc, 2.8);
    const { min, max } = sceneBounds(doc);
    expect(min[1]).toBeCloseTo(0, 4);
    expect(max[1]).toBeCloseTo(7 * 2.8, 4);
    expect(max[0] - min[0]).toBeCloseTo(6 * 2.8, 4);
  });

  it('roofHeight finds the top slab, ignoring a small roof box above it', () => {
    const { doc } = fixture();
    bakeAndCentre(doc, 1);
    expect(roofHeight(doc)).toBeCloseTo(6, 3);
  });

  it('roofHeight is null when no level above 2 m covers 40% of the footprint', () => {
    const { doc } = fixture();
    bakeAndCentre(doc, 0.3); // the roof slab is now at 1.8 m
    expect(roofHeight(doc)).toBeNull();
  });

  it('dropSmallIslands removes the 0.3 m cube and keeps both big boxes', () => {
    const { doc } = fixture();
    bakeAndCentre(doc, 1);
    expect(triangleCount(doc)).toBe(5 * 12);
    dropSmallIslands(doc, 1.4);
    expect(triangleCount(doc)).toBe(4 * 12);
    const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    const posAcc = prim.getAttribute('POSITION')!;
    // unused vertices are compacted away: 4 boxes × 24
    expect(posAcc.getCount()).toBe(4 * 24);
    for (let i = 0; i < posAcc.getCount(); i++) {
      const [x, y] = posAcc.getElement(i, [0, 0, 0]);
      expect(x! >= 2 - 1e-6 && x! <= 2.3 + 1e-6 && y! > 6.01).toBe(false);
    }
    const { min, max } = sceneBounds(doc);
    expect(max[1]).toBeCloseTo(7, 4);
    expect(min[2]).toBeCloseTo(-3.5, 4);
  });

  it('wallCollider spans the walls, not a porch below 0.8 m', () => {
    const { doc } = fixture();
    bakeAndCentre(doc, 1);
    const c = wallCollider(doc, 6);
    expect(c.center.x).toBeCloseTo(0, 4);
    expect(c.center.y).toBeCloseTo(3, 4);
    expect(c.center.z).toBeCloseTo(-0.5, 4);
    expect(c.size.x).toBeCloseTo(6, 4);
    expect(c.size.y).toBeCloseTo(6, 4);
    expect(c.size.z).toBeCloseTo(6, 4);
  });
});
