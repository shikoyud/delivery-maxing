import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { movementConfig } from '@dm/shared';
import { createCourierPlaceholder } from '../src/render/courierPlaceholder';

const cap = movementConfig.capsule;

/** World-space bounding box of the placeholder. */
const box = (o: THREE.Object3D): THREE.Box3 => {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
};

describe('courier placeholder', () => {
  it('a capsule as tall as the courier, standing on the feet', () => {
    const c = createCourierPlaceholder(cap);
    c.update({ x: 5, y: 2, z: -3 }, 0, false);
    const b = box(c.object);
    expect(b.min.y).toBeCloseTo(2, 3);
    expect(b.max.y).toBeCloseTo(2 + cap.height, 3);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(5, 1);
  });

  it('crouched or sliding it is crouchHeight tall', () => {
    const c = createCourierPlaceholder(cap);
    c.update({ x: 0, y: 0, z: 0 }, 0, true);
    expect(box(c.object).max.y).toBeCloseTo(cap.crouchHeight, 3);
  });

  it('the front marker points along the heading (yaw 0 faces −Z, positive turns left)', () => {
    const c = createCourierPlaceholder(cap);
    const front = (): THREE.Vector3 => c.front.getWorldPosition(new THREE.Vector3());
    c.update({ x: 0, y: 0, z: 0 }, 0, false);
    c.object.updateMatrixWorld(true);
    expect(front().z).toBeLessThan(-cap.radius * 0.9);
    c.update({ x: 0, y: 0, z: 0 }, Math.PI / 2, false);
    c.object.updateMatrixWorld(true);
    expect(front().x).toBeLessThan(-cap.radius * 0.9);
    expect(Math.abs(front().z)).toBeLessThan(1e-6);
  });

  it('casts shadows and costs two meshes', () => {
    const c = createCourierPlaceholder(cap);
    const meshes: THREE.Mesh[] = [];
    c.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes).toHaveLength(2);
    expect(meshes.every((m) => m.castShadow)).toBe(true);
  });
});
