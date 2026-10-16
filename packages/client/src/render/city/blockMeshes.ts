import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CatalogIndex, CityMap, Lot } from '@dm/shared';
import { lotColor } from './categoryColors';

/** The block-mesh id of a lot: its block, or `"<district>-free"` for lots outside every block (docks, beach, harbor…). */
export function lotBlockId(lot: Lot, blocks: ReadonlySet<string>): string {
  return lot.block && blocks.has(lot.block) ? lot.block : `${lot.district}-free`;
}

/** One lot's placeholder box (city design §7.3): its rect, catalog height × stack from `lot.y`, category-coloured. */
export function lotBoxGeometry(lot: Lot, cat: CatalogIndex): THREE.BufferGeometry {
  const entry = cat.get(lot.asset);
  const h = entry.size.h * (lot.stack ?? 1);
  const r = lot.rect;
  const g = new THREE.BoxGeometry(r.maxX - r.minX, h, r.maxZ - r.minZ);
  g.translate((r.minX + r.maxX) / 2, lot.y + h / 2, (r.minZ + r.maxZ) / 2);
  g.deleteAttribute('uv');
  const c = lotColor(lot.id, lot.asset, entry.category);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** A block's placeholder mesh: its lots' boxes merged (one draw call), or null when it has none to draw. */
export function buildBlockMesh(blockId: string, lots: readonly Lot[], cat: CatalogIndex, material: THREE.Material): THREE.Mesh | null {
  const geoms = lots.filter((l) => !l.open).map((l) => lotBoxGeometry(l, cat));
  if (geoms.length === 0) return null;
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  if (!merged) throw new Error(`block ${blockId}: lot boxes could not be merged`);
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = `block ${blockId}`;
  mesh.userData.blockId = blockId;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * Every lot of the city as a placeholder box (Decision 7: coloured by category, no sign), merged into one
 * vertex-coloured mesh per block id (and one `"<district>-free"` mesh per district for the lots outside blocks). Open
 * lots draw nothing; prop lots draw a box like buildings. CityView (Task 12) shows them within lodRadii[2] and swaps
 * in pack models nearer.
 */
export function buildBlockMeshes(map: CityMap, cat: CatalogIndex): Map<string, THREE.Mesh> {
  const blockIds = new Set(map.layout.blocks.map((b) => b.id));
  const byBlock = new Map<string, Lot[]>();
  for (const lot of map.layout.lots) {
    const id = lotBlockId(lot, blockIds);
    const list = byBlock.get(id);
    if (list) list.push(lot);
    else byBlock.set(id, [lot]);
  }
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const out = new Map<string, THREE.Mesh>();
  for (const [id, lots] of byBlock) {
    const mesh = buildBlockMesh(id, lots, cat, material);
    if (mesh) out.set(id, mesh);
  }
  return out;
}
