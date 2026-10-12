import * as THREE from 'three';
import type { MovementConfig, Vec3 } from '@dm/shared';
import { palette } from './palette';

type Capsule = MovementConfig['capsule'];

/** The visible courier. Task 5's animated model implements the same shape; this capsule stays as its fallback. */
export interface CourierView {
  readonly object: THREE.Object3D;
  /** Feet position, heading (yaw: 0 faces −Z, positive turns left) and whether crouched or sliding. */
  update(feet: Vec3, heading: number, crouched: boolean): void;
}

export interface CourierPlaceholder extends CourierView {
  /** The front marker (a coral visor), exposed so tests can check which way the courier faces. */
  readonly front: THREE.Object3D;
}

/**
 * Greybox courier: a teal capsule the size of the movement capsule with a coral visor on its front, so the heading
 * reads at a glance from the chase camera. Two meshes (two draw calls, plus their shadows). `capsule` is read on
 * every update, so dev-panel edits to the capsule size show at once.
 */
export function createCourierPlaceholder(capsule: Capsule): CourierPlaceholder {
  const r0 = capsule.radius;
  const h0 = capsule.height;
  const root = new THREE.Group();
  root.name = 'courier-placeholder';
  const body = new THREE.Group();
  root.add(body);

  const capsuleMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(r0, h0 - 2 * r0, 6, 16),
    new THREE.MeshLambertMaterial({ color: palette.teal }),
  );
  capsuleMesh.position.y = h0 / 2;
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(r0 * 1.1, h0 * 0.08, r0 * 0.6),
    new THREE.MeshLambertMaterial({ color: palette.coral }),
  );
  visor.position.set(0, h0 * 0.82, -r0 * 0.95);
  for (const m of [capsuleMesh, visor]) {
    m.castShadow = true;
    m.receiveShadow = false;
    body.add(m);
  }

  return {
    object: root,
    front: visor,
    update(feet, heading, crouched) {
      root.position.set(feet.x, feet.y, feet.z);
      root.rotation.y = heading;
      const h = crouched ? capsule.crouchHeight : capsule.height;
      const s = capsule.radius / r0;
      body.scale.set(s, h / h0, s);
    },
  };
}
