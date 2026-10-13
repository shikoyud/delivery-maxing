import type { Vec3 } from '../math/vec3';

/** A box collider in piece-local metres (origin at the footprint centre, y = 0 at the base). */
export interface PieceCollider {
  center: Vec3;
  size: Vec3;
  /** XYZ Euler, degrees */
  rotationDeg?: Vec3;
}

export type PieceKind = 'building' | 'part' | 'character';

export interface PieceEntry {
  /** 'b-4story', 'p-balcony', 'c-thief-casual' */
  id: string;
  kind: PieceKind;
  /** Paths relative to assets/ */
  lod0: string;
  lod1: string | null;
  /** AABB after baking, metres; origin at the footprint centre, y = 0 at the base; the door faces +z */
  size: Vec3;
  /** Triangles in lod0 and lod1 (0 when there is no lod1) */
  tris: [number, number];
  /** Walkable flat roof height; null for gable/round roofs, parts and characters */
  roofY: number | null;
  colliders: PieceCollider[];
  /** Linear RGB, used for LOD2 boxes */
  avgColor: [number, number, number];
}

export type PieceCatalog = Record<string, PieceEntry>;

/** How far a collider may poke out of the piece's AABB, metres. */
const COLLIDER_TOLERANCE = 0.5;
const KINDS: readonly PieceKind[] = ['building', 'part', 'character'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.z);

/** The rotation matrix (rows) of an XYZ Euler rotation in degrees: R = Rx(a) · Ry(b) · Rz(c), three.js 'XYZ' order. */
export function rotationMatrixXYZ(r: Vec3): [[number, number, number], [number, number, number], [number, number, number]] {
  const [a, b, c] = [r.x, r.y, r.z].map((d) => (d * Math.PI) / 180) as [number, number, number];
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
  ];
}

/** Half-extents of the AABB of a box with half-extents `h` rotated by XYZ Euler degrees `r`. */
export function rotatedHalfExtents(h: Vec3, r: Vec3 | undefined): Vec3 {
  if (!r) return h;
  const m = rotationMatrixXYZ(r);
  const e = (row: readonly [number, number, number]) =>
    Math.abs(row[0]) * h.x + Math.abs(row[1]) * h.y + Math.abs(row[2]) * h.z;
  return { x: e(m[0]), y: e(m[1]), z: e(m[2]) };
}

function checkEntry(key: string, e: unknown): PieceEntry {
  const fail = (why: string): never => {
    throw new Error(`piece ${key}: ${why}`);
  };
  if (!isObj(e)) return fail('not an object');
  if (e.id !== key) fail(`id ${String(e.id)} does not match its key`);
  if (!KINDS.includes(e.kind as PieceKind)) fail(`unknown kind ${String(e.kind)}`);
  if (typeof e.lod0 !== 'string' || e.lod0 === '') fail('lod0 must be a path');
  if (e.lod1 !== null && typeof e.lod1 !== 'string') fail('lod1 must be a path or null');
  if (!isVec3(e.size) || e.size.x <= 0 || e.size.y <= 0 || e.size.z <= 0) fail('size must be positive');
  const size = e.size as Vec3;
  const tris = e.tris;
  if (!Array.isArray(tris) || tris.length !== 2 || !tris.every((t) => Number.isInteger(t) && t >= 0)) {
    fail('tris must be two non-negative integers');
  }
  const [t0, t1] = tris as [number, number];
  if (t1 > t0) fail(`lod1 tris ${t1} > lod0 tris ${t0}`);
  if (e.lod1 === null && t1 !== 0) fail('lod1 tris must be 0 without a lod1');
  if (e.roofY !== null && (!isNum(e.roofY) || e.roofY <= 0 || e.roofY > size.y)) fail('roofY must be null or within the AABB');
  const col = e.avgColor;
  if (!Array.isArray(col) || col.length !== 3 || !col.every((c) => isNum(c) && c >= 0 && c <= 1)) {
    fail('avgColor must be three numbers in [0, 1]');
  }
  if (!Array.isArray(e.colliders)) return fail('colliders must be an array');
  e.colliders.forEach((c: unknown, i) => {
    if (!isObj(c) || !isVec3(c.center) || !isVec3(c.size) || c.size.x <= 0 || c.size.y <= 0 || c.size.z <= 0) {
      fail(`collider ${i} is malformed`);
    }
    const cc = c as unknown as PieceCollider;
    if (cc.rotationDeg !== undefined && !isVec3(cc.rotationDeg)) fail(`collider ${i} rotationDeg is malformed`);
    const h = rotatedHalfExtents({ x: cc.size.x / 2, y: cc.size.y / 2, z: cc.size.z / 2 }, cc.rotationDeg);
    const t = COLLIDER_TOLERANCE;
    const inside =
      Math.abs(cc.center.x) + h.x <= size.x / 2 + t &&
      Math.abs(cc.center.z) + h.z <= size.z / 2 + t &&
      cc.center.y - h.y >= -t &&
      cc.center.y + h.y <= size.y + t;
    if (!inside) fail(`collider ${i} lies outside the AABB`);
  });
  return e as unknown as PieceEntry;
}

/** Validates map/pieces.json. Throws naming the offending piece id. */
export function parsePieceCatalog(json: unknown): PieceCatalog {
  if (!isObj(json)) throw new Error('piece catalog must be an object');
  const out: PieceCatalog = {};
  for (const [key, e] of Object.entries(json)) out[key] = checkEntry(key, e);
  return out;
}
