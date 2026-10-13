import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hospitalBlockId, vec3, type MapData, type Vec3 } from '@dm/shared';
import { palette } from './palette';

// Art dimensions (metres). The block's size is the hospital solid's (map/greybox.json `hospitalBlock`); the safe
// radius comes from the map.
const CROSS_LENGTH = 2.4;
const CROSS_BAR = 0.7;
const CROSS_THICKNESS = 0.08;
/** Ring width as a share of the safe radius (the unit ring is scaled per hospital). */
const RING_SHARE = 0.03;
const DECAL_Y = 0.03;

function paint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const flat = g.index ? g.toNonIndexed() : g;
  const count = flat.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) c.toArray(colors, i * 3);
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  flat.deleteAttribute('uv');
  return flat;
}

/** A white block with a red cross on its roof and on all four sides, centred on the origin at ground level. */
function crossBlockGeometry(size: Vec3): THREE.BufferGeometry {
  const parts = [paint(new THREE.BoxGeometry(size.x, size.y, size.z).translate(0, size.y / 2, 0), palette.hospital)];
  const crossAt = (face: THREE.Matrix4): void => {
    for (const [w, h] of [
      [CROSS_LENGTH, CROSS_BAR],
      [CROSS_BAR, CROSS_LENGTH],
    ] as const) {
      parts.push(paint(new THREE.BoxGeometry(w, h, CROSS_THICKNESS).applyMatrix4(face), palette.hospitalCross));
    }
  };
  // Four sides, then the roof.
  for (let k = 0; k < 4; k++) {
    const half = (k % 2 === 0 ? size.z : size.x) / 2 + CROSS_THICKNESS / 2;
    const face = new THREE.Matrix4().makeRotationY((k * Math.PI) / 2).multiply(new THREE.Matrix4().makeTranslation(0, size.y / 2, half));
    crossAt(face);
  }
  crossAt(new THREE.Matrix4().makeTranslation(0, size.y + CROSS_THICKNESS / 2, 0).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)));
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged;
}

/**
 * Hospitals (spec §5 spawning and safe zones): a white block with red crosses at each hospital's centre and a flat
 * ring at its safe radius. Two InstancedMeshes for every hospital together.
 */
export function buildHospitalMeshes(map: MapData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hospitals';
  const hs = map.hospitals;
  const n = Math.max(1, hs.length);

  // Every hospital block has the same size (one GreyboxSource.hospitalBlock); a map without the solids draws none.
  const solid = hs[0] ? map.solids.find((s) => s.id === hospitalBlockId(hs[0]!)) : undefined;
  const blocks = new THREE.InstancedMesh(crossBlockGeometry(solid?.size ?? vec3(1, 1, 1)), new THREE.MeshLambertMaterial({ vertexColors: true }), n);
  blocks.name = 'hospital-blocks';
  blocks.castShadow = true;
  blocks.receiveShadow = true;

  const rings = new THREE.InstancedMesh(
    new THREE.RingGeometry(1 - RING_SHARE, 1, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: palette.safeZone, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    n,
  );
  rings.name = 'hospital-rings';
  blocks.count = solid ? hs.length : 0;
  rings.count = hs.length;

  const m = new THREE.Matrix4();
  hs.forEach((h, i) => {
    blocks.setMatrixAt(i, m.makeTranslation(h.center.x, h.center.y, h.center.z));
    rings.setMatrixAt(i, m.makeScale(h.safeRadius, 1, h.safeRadius).setPosition(h.center.x, h.center.y + DECAL_Y, h.center.z));
  });
  blocks.computeBoundingSphere();
  rings.computeBoundingSphere();
  group.add(blocks, rings);
  return group;
}
