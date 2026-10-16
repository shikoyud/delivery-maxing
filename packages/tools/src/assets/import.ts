import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Document, Logger, NodeIO, type Material, type Node, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization, type Transform } from '@gltf-transform/extensions';
import { cloneDocument, prune, quantize, reorder, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import type { AssetCatalog } from '@dm/shared';
import clientJson from '../../../../config/client.json';

export interface ImportReport {
  /** Models written (LOD0 files) */
  written: number;
  /** Of those, how many also got a LOD1 file */
  lod1: number;
  /** Catalog ids whose file is absent or unreadable, or has no triangles */
  skipped: string[];
  /** Bytes written in all (models, LOD1 files, textures, manifest) */
  bytes: number;
}

/** `manifest.json` in the output folder: the ids written and whether each has a LOD1 file (the client reads it). */
export interface PackManifest {
  version: 1;
  models: Record<string, { lod1: boolean }>;
}

/** LOD1 simplification (config/client.json city.lod1): toward `ratio` within `error`, kept if it drops `minDrop`. */
export interface Lod1Options {
  ratio: number;
  error: number;
  minDrop: number;
}
/** Material names in the runtime files: `tex:<file>` samples textures/<file>; `flat` is vertex-coloured. */
const FLAT = 'flat';

const readIo = () =>
  new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .setLogger(new Logger(Logger.Verbosity.ERROR));
const writeIo = () =>
  new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
    .setLogger(new Logger(Logger.Verbosity.WARN));

/** One output primitive's vertex streams, gathered from every source primitive with the same material. */
interface Bucket {
  pos: number[];
  nrm: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

interface Shared {
  /** Texture file name per source image hash (written once into textures/) */
  textures: Map<string, string>;
  bytes: number;
}

const triCount = (doc: Document): number =>
  doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3, 0);

/** The texture of `m`'s base colour, written once per distinct image; null for an untextured material. */
function textureName(m: Material | null, outDir: string, shared: Shared): string | null {
  const tex = m?.getBaseColorTexture();
  const img = tex?.getImage();
  if (!tex || !img) return null;
  const hash = createHash('sha1').update(img).digest('hex').slice(0, 12);
  let name = shared.textures.get(hash);
  if (!name) {
    const ext = tex.getMimeType() === 'image/png' ? 'png' : tex.getMimeType() === 'image/webp' ? 'webp' : 'jpg';
    name = `${hash}.${ext}`;
    const path = join(outDir, 'textures', name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, img);
    shared.bytes += img.byteLength;
    shared.textures.set(hash, name);
  }
  return name;
}

/** UV transform of the base colour texture (KHR_texture_transform offset and scale; rotation is not used by the packs). */
function uvTransform(m: Material | null): { ox: number; oy: number; sx: number; sy: number } {
  const t = m?.getBaseColorTextureInfo()?.getExtension<Transform>('KHR_texture_transform');
  const o = t?.getOffset() ?? [0, 0];
  const s = t?.getScale() ?? [1, 1];
  return { ox: o[0]!, oy: o[1]!, sx: s[0]!, sy: s[1]! };
}

/**
 * Bakes every mesh node of the first scene into one mesh in a new document: positions and normals in scene space (the
 * catalog's size and pivot are measured there, so the model stays where the catalog says), one primitive per texture
 * plus one vertex-coloured `flat` primitive for every untextured material (glass, lights: opaque, its base colour).
 * TANGENT, TEXCOORD_1 and the source images are dropped; the texture goes to textures/ once and the material names it.
 */
function bake(src: Document, outDir: string, shared: Shared): Document | null {
  const scene = src.getRoot().getDefaultScene() ?? src.getRoot().listScenes()[0];
  if (!scene) return null;
  const buckets = new Map<string, Bucket>();
  const nodes: Node[] = [];
  scene.traverse((n) => {
    if (n.getMesh()) nodes.push(n);
  });
  for (const node of nodes) {
    const m = node.getWorldMatrix();
    // normal matrix: the inverse transpose of the upper 3 × 3
    const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
    const det = a[0]! * (a[4]! * a[8]! - a[5]! * a[7]!) - a[3]! * (a[1]! * a[8]! - a[2]! * a[7]!) + a[6]! * (a[1]! * a[5]! - a[2]! * a[4]!);
    const flip = det < 0;
    const inv = [
      (a[4]! * a[8]! - a[5]! * a[7]!) / det, (a[2]! * a[7]! - a[1]! * a[8]!) / det, (a[1]! * a[5]! - a[2]! * a[4]!) / det,
      (a[5]! * a[6]! - a[3]! * a[8]!) / det, (a[0]! * a[8]! - a[2]! * a[6]!) / det, (a[2]! * a[3]! - a[0]! * a[5]!) / det,
      (a[3]! * a[7]! - a[4]! * a[6]!) / det, (a[1]! * a[6]! - a[0]! * a[7]!) / det, (a[0]! * a[4]! - a[1]! * a[3]!) / det,
    ];
    for (const prim of node.getMesh()!.listPrimitives()) {
      if (prim.getMode() !== 4) continue; // triangles only (TRIANGLES = 4)
      const mat = prim.getMaterial();
      const tex = textureName(mat, outDir, shared);
      const key = tex ? `tex:${tex}` : FLAT;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { pos: [], nrm: [], uv: [], col: [], idx: [] }));
      appendPrimitive(b, prim, m, inv, flip, tex !== null, mat);
    }
  }
  if (buckets.size === 0) return null;

  // ERROR: quantize() reports every UV set outside [0, 1] (the packs tile UVs; those stay float) as a warning
  const out = new Document().setLogger(new Logger(Logger.Verbosity.ERROR));
  const buf = out.createBuffer();
  const mesh = out.createMesh('model');
  const textured = [...buckets.keys()].some((k) => k !== FLAT);
  const colored = [...buckets.values()].some((b) => b.col.some((c) => c !== 1));
  const hasNormals = [...buckets.values()].every((b) => b.nrm.length === b.pos.length);
  for (const [key, b] of buckets) {
    if (b.idx.length === 0) continue;
    const prim = out
      .createPrimitive()
      .setAttribute('POSITION', out.createAccessor().setType('VEC3').setArray(new Float32Array(b.pos)).setBuffer(buf))
      .setIndices(out.createAccessor().setType('SCALAR').setArray(new Uint32Array(b.idx)).setBuffer(buf))
      .setMaterial(out.createMaterial(key).setRoughnessFactor(1).setMetallicFactor(0));
    if (hasNormals) prim.setAttribute('NORMAL', out.createAccessor().setType('VEC3').setArray(new Float32Array(b.nrm)).setBuffer(buf));
    // The primitives of one model share an attribute set, so the client merges them into one geometry with groups.
    if (textured) prim.setAttribute('TEXCOORD_0', out.createAccessor().setType('VEC2').setArray(new Float32Array(b.uv)).setBuffer(buf));
    if (colored) prim.setAttribute('COLOR_0', out.createAccessor().setType('VEC3').setArray(new Float32Array(b.col)).setBuffer(buf));
    mesh.addPrimitive(prim);
  }
  out.createScene('model').addChild(out.createNode('model').setMesh(mesh));
  return out;
}

function appendPrimitive(b: Bucket, prim: Primitive, m: readonly number[], inv: number[], flip: boolean, textured: boolean, mat: Material | null): void {
  const pos = prim.getAttribute('POSITION');
  if (!pos) return;
  const nrm = prim.getAttribute('NORMAL');
  const uv = prim.getAttribute('TEXCOORD_0');
  const base = b.pos.length / 3;
  const t = uvTransform(mat);
  const c = textured ? [1, 1, 1] : (mat?.getBaseColorFactor() ?? [1, 1, 1, 1]).slice(0, 3);
  const p: number[] = [];
  const n: number[] = [];
  const u: number[] = [];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, p);
    b.pos.push(
      m[0]! * p[0]! + m[4]! * p[1]! + m[8]! * p[2]! + m[12]!,
      m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]! + m[13]!,
      m[2]! * p[0]! + m[6]! * p[1]! + m[10]! * p[2]! + m[14]!,
    );
    if (nrm) {
      nrm.getElement(i, n);
      // inverse transpose: row i of inv^T is column i of inv
      const x = inv[0]! * n[0]! + inv[3]! * n[1]! + inv[6]! * n[2]!;
      const y = inv[1]! * n[0]! + inv[4]! * n[1]! + inv[7]! * n[2]!;
      const z = inv[2]! * n[0]! + inv[5]! * n[1]! + inv[8]! * n[2]!;
      const l = Math.hypot(x, y, z) || 1;
      b.nrm.push(x / l, y / l, z / l);
    }
    if (uv && textured) {
      uv.getElement(i, u);
      b.uv.push(u[0]! * t.sx + t.ox, u[1]! * t.sy + t.oy);
    } else b.uv.push(0, 0);
    b.col.push(c[0]!, c[1]!, c[2]!);
  }
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : pos.getCount();
  for (let i = 0; i + 2 < count; i += 3) {
    const i0 = idx ? idx.getScalar(i) : i;
    const i1 = idx ? idx.getScalar(i + 1) : i + 1;
    const i2 = idx ? idx.getScalar(i + 2) : i + 2;
    // a mirrored node turns the winding inside out
    if (flip) b.idx.push(base + i0, base + i2, base + i1);
    else b.idx.push(base + i0, base + i1, base + i2);
  }
}

/**
 * Writes `doc` quantised and meshopt-compressed (SP2's writeCompressed): normals → int8, UVs → uint16, colours → uint8
 * (KHR_mesh_quantization), then EXT_meshopt_compression. Positions stay float32 and the node has no transform, so the
 * client draws the geometry as is (three's GLTFLoader needs its MeshoptDecoder). Returns the bytes written.
 */
async function writeCompressed(doc: Document, path: string): Promise<number> {
  mkdirSync(dirname(path), { recursive: true });
  await doc.transform(
    prune({ keepAttributes: true }),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern: /^(NORMAL|TEXCOORD_0|COLOR_0)$/, quantizeNormal: 8, quantizeTexcoord: 16, quantizeColor: 8 }),
  );
  // quantize() only declares KHR_mesh_quantization when POSITION is quantized; the int8 normals need it too
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const bytes = await writeIo().writeBinary(doc);
  writeFileSync(path, bytes);
  return bytes.byteLength;
}

/**
 * `assets:import`: for every catalog entry with a `file` whose `use` is not `unused`, reads `<folder>/<file>`, bakes it
 * into one mesh (see bake) and writes `<outDir>/<id>.glb` (a `/` in the id is a folder) compressed, plus
 * `<id>.lod1.glb` simplified toward `lod1.ratio` within `lod1.error` when that drops at least `lod1.minDrop` of the
 * triangles.
 * Textures go to `<outDir>/textures/` once each; `<outDir>/manifest.json` lists what was written.
 */
export async function importPacks(
  folder: string,
  cat: AssetCatalog,
  outDir: string,
  lod1: Lod1Options = clientJson.city.lod1,
): Promise<ImportReport> {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  const io = readIo();
  const shared: Shared = { textures: new Map(), bytes: 0 };
  const report: ImportReport = { written: 0, lod1: 0, skipped: [], bytes: 0 };
  const manifest: PackManifest = { version: 1, models: {} };
  for (const e of cat.entries) {
    if (!e.file || e.use === 'unused') continue;
    const src = join(folder, e.file);
    let doc: Document | null;
    try {
      doc = existsSync(src) ? bake(await io.read(src), outDir, shared) : null;
    } catch {
      doc = null;
    }
    if (!doc || triCount(doc) === 0) {
      report.skipped.push(e.id);
      continue;
    }
    await doc.transform(weld());
    const tris = triCount(doc);
    report.bytes += await writeCompressed(cloneDocument(doc), join(outDir, `${e.id}.glb`));
    report.written++;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: lod1.ratio, error: lod1.error }));
    const hasLod1 = triCount(doc) <= tris * (1 - lod1.minDrop);
    if (hasLod1) {
      report.bytes += await writeCompressed(doc, join(outDir, `${e.id}.lod1.glb`));
      report.lod1++;
    }
    manifest.models[e.id] = { lod1: hasLod1 };
  }
  const manifestPath = join(outDir, 'manifest.json');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  report.bytes += shared.bytes + statSync(manifestPath).size;
  return report;
}
