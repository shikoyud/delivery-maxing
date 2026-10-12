import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { type Document, Logger, type mat4, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import {
  cloneDocument,
  getBounds,
  join as joinPrimitives,
  prune,
  quantize,
  reorder,
  resample,
  transformMesh,
} from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { PNG } from 'pngjs';
import type { PieceCatalog, PieceCollider, PieceEntry, PieceKind, Vec3 } from '@dm/shared';
import { buildPaletteAtlas } from './atlas';
import { convertFbx } from './convert';
import {
  bakeAndCentre,
  dropSmallIslands,
  listTrianglePrimitives,
  roofHeight,
  triangleCount,
  wallCollider,
} from './pieceGeometry';
import { characterBounds, keepClips, normaliseCharacter } from './character';

export interface PieceConfig {
  /** Source file, relative to the assets root */
  src: string;
  id: string;
  kind: PieceKind;
  /** Uniform scale for buildings and parts (source units → metres) */
  scale?: number;
  /** Characters: scaled so their bind pose is this tall, metres */
  height?: number;
  /** Quarter turns about +y applied after baking, so the door faces +z (0, 90, 180, 270) */
  rotY?: number;
  /** Palette used for avgColor and the contact sheet (default: `defaultPalette`) */
  palette?: string;
  /** Overrides the computed roof height (null: not a walkable flat roof) */
  roofY?: number | null;
  /** Overrides the computed colliders */
  colliders?: PieceCollider[];
  /** Overrides the config-wide lod1MinDiagonal (for models whose small parts are just above it) */
  lod1MinDiagonal?: number;
  /** Characters: animation clips to keep (names after the last '|') */
  keepClips?: string[];
}

export interface AssetsConfig {
  /** Palette PNGs relative to the assets root, in atlas row order */
  palettes: string[];
  defaultPalette: string;
  /** LOD1 drops connected parts whose AABB diagonal is shorter than this, metres */
  lod1MinDiagonal: number;
  pieces: PieceConfig[];
}

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
  .setLogger(new Logger(Logger.Verbosity.WARN));
const PALETTE_MATERIAL = 'palette';

const r3 = (v: number) => Math.round(v * 1000) / 1000 + 0; // + 0 turns −0 into 0
const v3 = (v: Vec3): Vec3 => ({ x: r3(v.x), y: r3(v.y), z: r3(v.z) });

function outPaths(cfg: PieceConfig): { lod0: string; lod1: string | null } {
  switch (cfg.kind) {
    case 'building':
      return { lod0: `city/buildings/${cfg.id}.glb`, lod1: `city/buildings/${cfg.id}.lod1.glb` };
    case 'part':
      return { lod0: `city/parts/${cfg.id}.glb`, lod1: null };
    case 'character':
      return { lod0: `city/characters/${cfg.id.replace(/^c-/, '')}.glb`, lod1: null };
  }
}

/** Replaces every material with one untextured material named `palette`; UVs are kept. Joins the primitives. */
function usePaletteMaterial(doc: Document): void {
  const mat = doc.createMaterial(PALETTE_MATERIAL).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(0);
  for (const prim of listTrianglePrimitives(doc)) prim.setMaterial(mat);
  for (const m of doc.getRoot().listMaterials()) if (m !== mat) m.dispose();
}

function rotateY(doc: Document, deg: number): void {
  if (deg % 90 !== 0) throw new Error(`rotY must be a multiple of 90, got ${deg}`);
  const a = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(a));
  const s = Math.round(Math.sin(a));
  const m = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1] as unknown as mat4;
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, m);
}

function boundsOf(doc: Document): { min: number[]; max: number[] } {
  return getBounds(doc.getRoot().listScenes()[0]!);
}

interface Rgb { r: number; g: number; b: number }
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function readPalette(path: string): (u: number, v: number) => Rgb {
  const img = PNG.sync.read(readFileSync(path));
  const frac = (x: number) => x - Math.floor(x);
  return (u, v) => {
    // glTF UVs: (0, 0) is the top-left texel
    const x = Math.min(img.width - 1, Math.floor(frac(u) * img.width));
    const y = Math.min(img.height - 1, Math.floor(frac(v) * img.height));
    const o = (y * img.width + x) * 4;
    return { r: img.data[o]! / 255, g: img.data[o + 1]! / 255, b: img.data[o + 2]! / 255 };
  };
}

/** Area-weighted average of the palette colour at each triangle's UV centroid, in linear RGB. */
function texturedAvgColor(doc: Document, sample: (u: number, v: number) => Rgb): [number, number, number] {
  const sum: [number, number, number] = [0, 0, 0];
  let total = 0;
  for (const prim of listTrianglePrimitives(doc)) {
    const pos = prim.getAttribute('POSITION')!;
    const uv = prim.getAttribute('TEXCOORD_0');
    const idx = prim.getIndices();
    if (!uv || !idx) throw new Error('textured pieces need indexed primitives with TEXCOORD_0');
    const p = [[], [], []] as number[][];
    const t = [[], [], []] as number[][];
    for (let i = 0; i + 2 < idx.getCount(); i += 3) {
      for (let k = 0; k < 3; k++) {
        pos.getElement(idx.getScalar(i + k), p[k]!);
        uv.getElement(idx.getScalar(i + k), t[k]!);
      }
      const [a, b, c] = p as [number[], number[], number[]];
      const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
      const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
      const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      const col = sample((t[0]![0]! + t[1]![0]! + t[2]![0]!) / 3, (t[0]![1]! + t[1]![1]! + t[2]![1]!) / 3);
      sum[0] += area * srgbToLinear(col.r);
      sum[1] += area * srgbToLinear(col.g);
      sum[2] += area * srgbToLinear(col.b);
      total += area;
    }
  }
  return [sum[0] / total, sum[1] / total, sum[2] / total];
}

/** Area-weighted average of the material base colours (already linear in glTF). */
function materialAvgColor(doc: Document): [number, number, number] {
  const sum: [number, number, number] = [0, 0, 0];
  let total = 0;
  for (const prim of listTrianglePrimitives(doc)) {
    const f = prim.getMaterial()?.getBaseColorFactor() ?? [1, 1, 1, 1];
    const pos = prim.getAttribute('POSITION')!;
    const idx = prim.getIndices()!;
    const a: number[] = [], b: number[] = [], c: number[] = [];
    for (let i = 0; i + 2 < idx.getCount(); i += 3) {
      pos.getElement(idx.getScalar(i), a);
      pos.getElement(idx.getScalar(i + 1), b);
      pos.getElement(idx.getScalar(i + 2), c);
      const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
      const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
      const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      for (let k = 0; k < 3; k++) sum[k] = sum[k]! + area * f[k]!;
      total += area;
    }
  }
  return [sum[0] / total, sum[1] / total, sum[2] / total];
}

/**
 * Writes a compressed copy of `doc` (the original stays float, for further processing):
 * normals → int8 and UVs/weights → uint16 (KHR_mesh_quantization), then EXT_meshopt_compression.
 * Positions stay float32 and node transforms stay identity, so the client can instance the geometry as is;
 * it needs three's MeshoptDecoder (GLTFLoader.setMeshoptDecoder).
 */
async function write(doc: Document, path: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const out = cloneDocument(doc);
  await out.transform(
    // keepAttributes: the palette material has no texture, but the client samples the atlas with TEXCOORD_0
    prune({ keepAttributes: true }),
    resample(),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern: /^(NORMAL|TEXCOORD_0|JOINTS_0|WEIGHTS_0)$/, quantizeNormal: 8, quantizeTexcoord: 16, quantizeWeight: 16 }),
  );
  // quantize() only declares KHR_mesh_quantization when POSITION is quantized; the int8 normals need it too
  out.createExtension(KHRMeshQuantization).setRequired(true);
  out
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  writeFileSync(path, await io.writeBinary(out));
}

/**
 * Moves each vertex's UV into [0, 1] by the integer cell of the triangles using it (the 32 × 32 palettes repeat,
 * and the atlas stacks them in v, so v must stay inside one palette). Throws if a vertex is shared by triangles in
 * different cells.
 */
function wrapUvs(doc: Document): void {
  for (const prim of listTrianglePrimitives(doc)) {
    const uv = prim.getAttribute('TEXCOORD_0');
    const idx = prim.getIndices();
    if (!uv || !idx) throw new Error('palette pieces need indexed primitives with TEXCOORD_0');
    const shift = new Map<number, string>();
    const t = [[0, 0], [0, 0], [0, 0]];
    for (let i = 0; i + 2 < idx.getCount(); i += 3) {
      const vs = [idx.getScalar(i), idx.getScalar(i + 1), idx.getScalar(i + 2)];
      vs.forEach((v, k) => uv.getElement(v, t[k]!));
      const cu = Math.floor((t[0]![0]! + t[1]![0]! + t[2]![0]!) / 3);
      const cv = Math.floor((t[0]![1]! + t[1]![1]! + t[2]![1]!) / 3);
      for (const v of vs) {
        const prev = shift.get(v);
        if (prev !== undefined && prev !== `${cu},${cv}`) throw new Error(`vertex ${v} UV spans two palette cells`);
        shift.set(v, `${cu},${cv}`);
      }
    }
    const e = [0, 0];
    for (const [v, key] of shift) {
      const [cu, cv] = key.split(',').map(Number) as [number, number];
      uv.getElement(v, e);
      uv.setElement(v, [e[0]! - cu, e[1]! - cv]);
    }
  }
}

function aabbCollider(min: number[], max: number[]): PieceCollider {
  return {
    center: { x: (min[0]! + max[0]!) / 2, y: (min[1]! + max[1]!) / 2, z: (min[2]! + max[2]!) / 2 },
    size: { x: max[0]! - min[0]!, y: max[1]! - min[1]!, z: max[2]! - min[2]! },
  };
}

function roundEntry(e: PieceEntry): PieceEntry {
  return {
    id: e.id,
    kind: e.kind,
    lod0: e.lod0,
    lod1: e.lod1,
    size: v3(e.size),
    tris: e.tris,
    roofY: e.roofY === null ? null : r3(e.roofY),
    colliders: e.colliders.map((c) => ({
      center: v3(c.center),
      size: v3(c.size),
      ...(c.rotationDeg ? { rotationDeg: v3(c.rotationDeg) } : {}),
    })),
    avgColor: e.avgColor.map(r3) as [number, number, number],
  };
}

async function buildPiece(
  cfg: AssetsConfig,
  p: PieceConfig,
  srcRoot: string,
  outRoot: string,
  tmp: string,
  palettes: Map<string, string>,
): Promise<PieceEntry> {
  const glb = join(tmp, `${p.id}.glb`);
  convertFbx(join(srcRoot, p.src), glb);
  const doc = await io.read(glb);
  const paths = outPaths(p);

  if (p.kind === 'character') {
    if (!p.height || !p.keepClips) throw new Error(`piece ${p.id}: characters need height and keepClips`);
    keepClips(doc, p.keepClips);
    normaliseCharacter(doc, p.height);
    const { min, max } = characterBounds(doc);
    await write(doc, join(outRoot, paths.lod0));
    return {
      id: p.id,
      kind: p.kind,
      ...paths,
      size: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
      tris: [triangleCount(doc), 0],
      roofY: null,
      colliders: p.colliders ?? [],
      avgColor: materialAvgColor(doc),
    };
  }

  if (!p.scale) throw new Error(`piece ${p.id}: buildings and parts need a scale`);
  bakeAndCentre(doc, p.scale);
  if (p.rotY) rotateY(doc, p.rotY);
  usePaletteMaterial(doc);
  await doc.transform(joinPrimitives());
  wrapUvs(doc);
  const { min, max } = boundsOf(doc);
  const paletteName = p.palette ?? cfg.defaultPalette;
  const palettePath = palettes.get(paletteName);
  if (!palettePath) throw new Error(`piece ${p.id}: unknown palette ${paletteName}`);
  const avgColor = texturedAvgColor(doc, readPalette(join(srcRoot, palettePath)));
  const tris0 = triangleCount(doc);

  let roofY: number | null = null;
  let colliders: PieceCollider[] = [aabbCollider(min, max)];
  if (p.kind === 'building') {
    roofY = p.roofY !== undefined ? p.roofY : roofHeight(doc);
    if (p.colliders) colliders = p.colliders;
    else if (roofY !== null) colliders = [wallCollider(doc, roofY)];
    else throw new Error(`piece ${p.id}: no flat roof found; add a roofY or colliders override`);
  } else if (p.colliders) {
    colliders = p.colliders;
  }
  await write(doc, join(outRoot, paths.lod0));

  let tris1 = 0;
  if (paths.lod1) {
    dropSmallIslands(doc, p.lod1MinDiagonal ?? cfg.lod1MinDiagonal);
    tris1 = triangleCount(doc);
    await write(doc, join(outRoot, paths.lod1));
  }
  return {
    id: p.id,
    kind: p.kind,
    ...paths,
    size: { x: max[0]! - min[0]!, y: max[1]! - min[1]!, z: max[2]! - min[2]! },
    tris: [tris0, tris1],
    roofY,
    colliders,
    avgColor,
  };
}

/**
 * Converts every configured source file (relative to `srcRoot`, the assets folder) into runtime GLBs under
 * `outRoot/city/`, writes `outRoot/city/palette-atlas.png` and returns the piece catalog (rounded to 0.001,
 * keys sorted).
 */
export async function runAssetPipeline(cfg: AssetsConfig, srcRoot: string, outRoot: string): Promise<PieceCatalog> {
  await MeshoptEncoder.ready;
  const palettes = new Map(cfg.palettes.map((p) => [basename(p, extname(p)), p]));
  const atlas = buildPaletteAtlas(cfg.palettes.map((p) => join(srcRoot, p)));
  mkdirSync(join(outRoot, 'city'), { recursive: true });
  writeFileSync(join(outRoot, 'city', 'palette-atlas.png'), atlas.png);

  const tmp = mkdtempSync(join(tmpdir(), 'dm-assets-'));
  const entries: PieceEntry[] = [];
  try {
    for (const p of cfg.pieces) entries.push(roundEntry(await buildPiece(cfg, p, srcRoot, outRoot, tmp, palettes)));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.fromEntries(entries.map((e) => [e.id, e]));
}
