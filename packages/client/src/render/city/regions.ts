import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapData } from '@dm/shared';
import { gridTexture, solidGeometry } from '../greyboxMeshes';

/** `"rx,rz"`: the square render region of side `size` containing (x, z), region (0,0) covering [0, size). */
export function regionOf(x: number, z: number, size: number): string {
  return `${Math.floor(x / size)},${Math.floor(z / size)}`;
}

/**
 * The code-built city geometry (ground, roads, sidewalks, cliffs, plaza…) merged per render region: each solid goes
 * to the region holding its centre. A region is one group of up to two meshes: `region-solids` (every drawn non-ground
 * solid, vertex-coloured, casting shadows) and `region-ground` (the ground tiles with the SP1 grid texture). Hidden
 * solids (colliders whose look comes from a prop) are skipped.
 */
export function buildRegionMeshes(map: MapData, regionSize: number): Map<string, THREE.Group> {
  const parts = new Map<string, { solids: THREE.BufferGeometry[]; ground: THREE.BufferGeometry[] }>();
  for (const s of map.solids) {
    if (s.hidden) continue;
    const key = regionOf(s.center.x, s.center.z, regionSize);
    let entry = parts.get(key);
    if (!entry) parts.set(key, (entry = { solids: [], ground: [] }));
    (s.kind === 'ground' ? entry.ground : entry.solids).push(solidGeometry(s));
  }
  const solidsMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  const groundMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, map: gridTexture() });
  const out = new Map<string, THREE.Group>();
  for (const [key, { solids, ground }] of parts) {
    const group = new THREE.Group();
    group.name = `region ${key}`;
    for (const [name, geoms, material, castShadow] of [
      ['region-solids', solids, solidsMaterial, true],
      ['region-ground', ground, groundMaterial, false],
    ] as const) {
      if (geoms.length === 0) continue;
      const merged = mergeGeometries(geoms, false);
      for (const g of geoms) g.dispose();
      if (!merged) throw new Error(`region ${key}: ${name} geometries could not be merged`);
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = name;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    out.set(key, group);
  }
  return out;
}
