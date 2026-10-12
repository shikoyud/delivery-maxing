import * as THREE from 'three';
import type { MovementConfig } from '@dm/shared';
import type { CourierConfig } from '../clientConfig';
import { easeYaw } from './courier/animState';
import type { CourierView } from './courier/CourierView';
import { palette } from './palette';

type Capsule = MovementConfig['capsule'];

export interface CourierPlaceholder extends CourierView {
  /** The front marker (a coral visor), exposed so tests can check which way the courier faces. */
  readonly front: THREE.Object3D;
}

/** Visual body radius as a share of the collision radius: the visor sticks out of the body but not past the capsule. */
const BODY_SHARE = 0.8;
/** Visor front (share of the radius from the axis), depth and half-width; front² + halfWidth² stays under 1. */
const VISOR_FRONT = 0.95;
const VISOR_DEPTH = 0.3;
const VISOR_HALF_WIDTH = 0.3;

/**
 * The courier's fallback when the animated model fails to load (ruling R1, Review Focus 4).
 * A teal capsule as tall as the movement capsule with a coral visor on its front, so the heading
 * reads at a glance from the chase camera. Everything stays inside the collision capsule. Two meshes (two draw calls,
 * plus their shadows). `capsule` is read on every update, so dev-panel edits to the capsule size show at once.
 */
export function createCourierPlaceholder(capsule: Capsule, courier: CourierConfig): CourierPlaceholder {
  const r0 = capsule.radius;
  const h0 = capsule.height;
  const root = new THREE.Group();
  root.name = 'courier-placeholder';
  const body = new THREE.Group();
  root.add(body);

  const rb = r0 * BODY_SHARE;
  const capsuleMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(rb, h0 - 2 * rb, 6, 16),
    new THREE.MeshLambertMaterial({ color: palette.teal }),
  );
  capsuleMesh.position.y = h0 / 2;
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(r0 * VISOR_HALF_WIDTH * 2, h0 * 0.08, r0 * VISOR_DEPTH),
    new THREE.MeshLambertMaterial({ color: palette.coral }),
  );
  visor.position.set(0, h0 * 0.82, -r0 * (VISOR_FRONT - VISOR_DEPTH / 2));
  for (const m of [capsuleMesh, visor]) {
    m.castShadow = true;
    m.receiveShadow = false;
    body.add(m);
  }

  let snapNext = true;
  let packages = 0;
  return {
    root,
    front: visor,
    update(dt, state, feet) {
      root.position.set(feet.x, feet.y, feet.z);
      root.rotation.y = snapNext ? state.heading : easeYaw(root.rotation.y, state.heading, dt, courier.turnEaseRate);
      snapNext = false;
      const low = state.crouched || state.mode === 'slide';
      const h = low ? capsule.crouchHeight : capsule.height;
      const s = capsule.radius / r0;
      body.scale.set(s, h / h0, s);
    },
    setHidden(hidden) {
      // Not drawn into the colour or depth buffers, but still into the shadow map (which uses its own depth material).
      for (const m of [capsuleMesh, visor]) {
        m.material.colorWrite = !hidden;
        m.material.depthWrite = !hidden;
      }
    },
    setPackages(n) {
      packages = n; // the fallback carries no visible packages
    },
    snap() {
      snapNext = true;
    },
    debug: () => ({ loaded: false, clip: null, pose: 'none', time: 0, packages }),
  };
}
