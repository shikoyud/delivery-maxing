import * as THREE from 'three';
import { vehiclesConfig, type Vec3 } from '@dm/shared';
import { slotColors } from './palette';

export interface Waypoints {
  mesh: THREE.InstancedMesh;
  /** One beam per target, coloured by `colorIndices[i]` (the order's stable colour); `timeSeconds` drives the pulse. */
  update(targets: readonly Vec3[], colorIndices: readonly number[], timeSeconds: number): void;
}

// Art dimensions (metres).
const BEAM_HEIGHT = 80;
const BEAM_RADIUS = 1.4;
const PULSE = 0.12;

/** One beam per active order: the largest carrier (the car) has the most slots. */
export const MAX_WAYPOINTS = vehiclesConfig.car.slots;

/** The colour of order slot `i` (wraps if a dev setting ever exceeds the palette). */
export const slotColor = (i: number): number => slotColors[i % slotColors.length]!;

/**
 * Translucent beams over each active order's current target (spec §11 waypoints). One InstancedMesh, so it
 * costs one draw call whatever the number of orders. Beams ignore fog, so far targets stay visible.
 */
export function buildWaypoints(maxSlots: number, pulseHz: number): Waypoints {
  const geo = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 16, 1, true);
  geo.translate(0, BEAM_HEIGHT / 2, 0);
  // Fade upward: vertex colour brightness is multiplied into the instance colour; bottom ring stays full.
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = pos.getY(i) > BEAM_HEIGHT / 2 ? 0.35 : 1;
    colors.set([k, k, k], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, maxSlots));
  mesh.name = 'waypoints';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 10;

  const c = new THREE.Color();
  // Allocate instance colours up front so the shader is compiled with them from the first frame.
  for (let i = 0; i < Math.max(1, maxSlots); i++) mesh.setColorAt(i, c.setHex(slotColor(i)));

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  return {
    mesh,
    update(targets, colorIndices, t) {
      const count = Math.min(targets.length, mesh.instanceMatrix.count);
      for (let i = 0; i < count; i++) {
        const tg = targets[i]!;
        const k = 1 + PULSE * Math.sin(t * pulseHz * Math.PI * 2 + i);
        m.compose(p.set(tg.x, tg.y, tg.z), q, s.set(k, 1, k));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.setHex(slotColor(colorIndices[i] ?? i)));
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}
