import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapData, Solid, SolidKind } from '@dm/shared';
import { buildingTints, kindColor, palette } from './palette';

/** FNV-1a hash of a string, as an unsigned 32-bit integer. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The vertex colour for a solid: its kind's colour, tinted by a hash of its id. */
export function solidColor(s: Solid): THREE.Color {
  const h = hashId(s.id);
  const base = new THREE.Color(s.kind === 'building' ? buildingTints[h % buildingTints.length]! : kindColor[s.kind]);
  // ±6% lightness jitter so neighbouring solids of the same tint still read apart.
  const jitter = (((h >>> 8) & 0xff) / 255 - 0.5) * 0.12;
  return base.offsetHSL(0, 0, jitter);
}

/** A solid as a world-space box with its vertex colour and world-space UVs (1 unit = 1 m). */
export function solidGeometry(s: Solid): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(s.size.x, s.size.y, s.size.z);
  const r = s.rotationDeg;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(s.center.x, s.center.y, s.center.z),
    new THREE.Quaternion().setFromEuler(
      r ? new THREE.Euler(THREE.MathUtils.degToRad(r.x), THREE.MathUtils.degToRad(r.y), THREE.MathUtils.degToRad(r.z), 'XYZ') : new THREE.Euler(),
    ),
    new THREE.Vector3(1, 1, 1),
  );
  g.applyMatrix4(m);
  const c = solidColor(s);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // World-space UVs (1 unit = 1 m) so the ground grid texture keeps a constant scale.
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < n; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
  return g;
}

/** A tiling 1 m grid on a white background, multiplied over the vertex colours of the ground. */
export function gridTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = `#${new THREE.Color(palette.gridLine).getHexString()}`;
  ctx.lineWidth = 3; // 1.5 px visible per edge: ~0.05 m per 4 m cell
  ctx.strokeRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 4, 1 / 4); // one grid cell per 4 m
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Merges every static solid into one mesh per kind (one draw call each), with vertex colours tinted per solid.
 * The ground carries a grid texture so speed reads in motion.
 */
export function buildGreyboxMeshes(map: MapData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'greybox';
  const byKind = new Map<SolidKind, THREE.BufferGeometry[]>();
  for (const s of map.solids) {
    const list = byKind.get(s.kind) ?? [];
    list.push(solidGeometry(s));
    byKind.set(s.kind, list);
  }
  for (const [kind, geoms] of byKind) {
    const merged = mergeGeometries(geoms, false);
    for (const g of geoms) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (kind === 'ground') material.map = gridTexture();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `greybox-${kind}`;
    mesh.castShadow = kind !== 'ground';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return group;
}
