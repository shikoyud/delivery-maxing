import { type Document, type Node, type Primitive } from '@gltf-transform/core';
import { clearNodeTransform, compactPrimitive, getBounds, transformMesh } from '@gltf-transform/functions';
import type { PieceCollider } from '@dm/shared';

const TRIANGLES = 4;
/** Height bins for roofHeight, metres. */
const ROOF_BIN = 0.05;
/** A level counts as a roof when its horizontal area is at least this share of the footprint. */
const ROOF_MIN_SHARE = 0.4;
/** A roof must be higher than this, metres (ignores porches, steps and floors). */
const ROOF_MIN_Y = 2;
/** wallCollider ignores vertices this close to the base and the roof (porches, steps, parapets). */
const WALL_MARGIN = 0.8;
/** Positions closer than this are the same vertex when finding islands, metres. */
const ISLAND_QUANTUM = 0.001;
/** |normal.y| above this makes a triangle horizontal. */
const HORIZONTAL_COS = 0.99;

type V3 = [number, number, number];

export function listTrianglePrimitives(doc: Document): Primitive[] {
  return doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .filter((p) => p.getMode() === TRIANGLES && p.getAttribute('POSITION'));
}

/** Calls `fn` with the three vertex positions of every triangle of every mesh. */
function forEachTriangle(doc: Document, fn: (a: V3, b: V3, c: V3) => void): void {
  for (const prim of listTrianglePrimitives(doc)) {
    const pos = prim.getAttribute('POSITION')!;
    const idx = prim.getIndices();
    const count = idx ? idx.getCount() : pos.getCount();
    const at = (i: number) => (idx ? idx.getScalar(i) : i);
    const a = [0, 0, 0] as V3;
    const b = [0, 0, 0] as V3;
    const c = [0, 0, 0] as V3;
    for (let i = 0; i + 2 < count; i += 3) {
      pos.getElement(at(i), a);
      pos.getElement(at(i + 1), b);
      pos.getElement(at(i + 2), c);
      fn(a, b, c);
    }
  }
}

export function triangleCount(doc: Document): number {
  let n = 0;
  for (const prim of listTrianglePrimitives(doc)) {
    n += Math.floor((prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')!.getCount()) / 3);
  }
  return n;
}

function sceneBounds(doc: Document): { min: V3; max: V3 } {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error('document has no scene');
  const { min, max } = getBounds(scene);
  return { min: min as V3, max: max as V3 };
}

/**
 * Bakes every node transform into the vertices (the FBX exports are Z-up, on a node rotated −90° about X and scaled
 * ×100), then scales by `scale` and moves the origin to the footprint centre at the base (AABB centre in x and z,
 * AABB minimum in y).
 */
export function bakeAndCentre(doc: Document, scale: number): void {
  const clearTree = (node: Node) => {
    clearNodeTransform(node);
    node.listChildren().forEach(clearTree);
  };
  for (const scene of doc.getRoot().listScenes()) scene.listChildren().forEach(clearTree);
  const { min, max } = sceneBounds(doc);
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const s = scale;
  // column-major: scale, then translate the footprint centre at the base to the origin
  const m = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -cx * s, -min[1] * s, -cz * s, 1];
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, m as unknown as Parameters<typeof transformMesh>[1]);
}

/**
 * The highest 0.05 m level whose horizontal-face area (either winding) is at least 40% of the footprint
 * (AABB x × z) and which lies above 2 m; null when there is none. Returns the area-weighted mean height of that level.
 */
export function roofHeight(doc: Document): number | null {
  const { min, max } = sceneBounds(doc);
  const footprint = (max[0] - min[0]) * (max[2] - min[2]);
  const bins = new Map<number, { area: number; ySum: number }>();
  forEachTriangle(doc, (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0 || Math.abs(ny) / len < HORIZONTAL_COS) return;
    const area = len / 2;
    const y = (a[1] + b[1] + c[1]) / 3;
    const key = Math.round(y / ROOF_BIN);
    const bin = bins.get(key) ?? { area: 0, ySum: 0 };
    bin.area += area;
    bin.ySum += area * y;
    bins.set(key, bin);
  });
  let best: { key: number; y: number } | null = null;
  for (const [key, bin] of bins) {
    const y = bin.ySum / bin.area;
    if (y <= ROOF_MIN_Y || bin.area < ROOF_MIN_SHARE * footprint) continue;
    if (best === null || key > best.key) best = { key, y };
  }
  return best?.y ?? null;
}

/** One box from the base to `roofY`, spanning the x and z bounds of the vertices with 0.8 m < y < roofY − 0.8 m. */
export function wallCollider(doc: Document, roofY: number): PieceCollider {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const prim of listTrianglePrimitives(doc)) {
    const pos = prim.getAttribute('POSITION')!;
    const p: number[] = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p);
      const y = p[1]!;
      if (y <= WALL_MARGIN || y >= roofY - WALL_MARGIN) continue;
      for (const k of [0, 2] as const) {
        lo[k] = Math.min(lo[k], p[k]!);
        hi[k] = Math.max(hi[k], p[k]!);
      }
    }
  }
  if (!Number.isFinite(lo[0])) throw new Error(`no wall vertices between ${WALL_MARGIN} and ${roofY - WALL_MARGIN} m`);
  return {
    center: { x: (lo[0] + hi[0]) / 2, y: roofY / 2, z: (lo[2] + hi[2]) / 2 },
    size: { x: hi[0] - lo[0], y: roofY, z: hi[2] - lo[2] },
  };
}

/**
 * Removes connected components (triangles linked by shared quantised positions) whose AABB diagonal is shorter
 * than `minDiagonal`, then compacts the vertex streams. This makes LOD1.
 */
export function dropSmallIslands(doc: Document, minDiagonal: number): void {
  for (const prim of listTrianglePrimitives(doc)) {
    const pos = prim.getAttribute('POSITION')!;
    const idxAcc = prim.getIndices();
    if (!idxAcc) throw new Error('dropSmallIslands needs indexed primitives');
    const n = pos.getCount();
    const parent = new Int32Array(n).map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    const p: number[] = [];
    const byKey = new Map<string, number>();
    const coords = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.getElement(i, p);
      coords.set(p, i * 3);
      const key = p.map((v) => Math.round(v / ISLAND_QUANTUM)).join(',');
      const other = byKey.get(key);
      if (other === undefined) byKey.set(key, i);
      else union(i, other);
    }
    const idx = idxAcc.getArray()!;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      union(idx[t]!, idx[t + 1]!);
      union(idx[t]!, idx[t + 2]!);
    }
    const boxes = new Map<number, { lo: V3; hi: V3 }>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      const b = boxes.get(r) ?? { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
      for (let k = 0; k < 3; k++) {
        b.lo[k] = Math.min(b.lo[k]!, coords[i * 3 + k]!);
        b.hi[k] = Math.max(b.hi[k]!, coords[i * 3 + k]!);
      }
      boxes.set(r, b);
    }
    const keep = new Set<number>();
    for (const [r, b] of boxes) {
      if (Math.hypot(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]) >= minDiagonal) keep.add(r);
    }
    const kept: number[] = [];
    for (let t = 0; t + 2 < idx.length; t += 3) {
      if (keep.has(find(idx[t]!))) kept.push(idx[t]!, idx[t + 1]!, idx[t + 2]!);
    }
    const Arr = n > 65535 ? Uint32Array : Uint16Array;
    idxAcc.setArray(new Arr(kept));
    compactPrimitive(prim);
  }
}
