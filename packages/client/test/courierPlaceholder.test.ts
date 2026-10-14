import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { movementConfig, type MoveMode, type PlayerState, type Vec3 } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { createCourierPlaceholder } from '../src/render/courierPlaceholder';
import { riderLift } from '../src/render/vehicles/vehicleMeshes';

const cap = movementConfig.capsule;
const courierCfg = clientConfig.courier;
const make = () => createCourierPlaceholder(cap, courierCfg);

/** A partial PlayerState with the fields the placeholder reads. */
const st = (heading: number, crouched = false, mode: MoveMode = 'ground'): PlayerState =>
  ({ heading, crouched, mode, riding: null, velocity: { x: 0, y: 0, z: 0 } }) as unknown as PlayerState;

/** Snaps the placeholder to `feet` and `heading`. */
const place = (c: ReturnType<typeof make>, feet: Vec3, heading: number, crouched = false): void => {
  c.snap();
  c.update(0, st(heading, crouched), feet, 0);
};

/** World-space bounding box of the placeholder. */
const box = (o: THREE.Object3D): THREE.Box3 => {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
};

describe('courier placeholder', () => {
  it('a capsule as tall as the courier, standing on the feet', () => {
    const c = make();
    place(c, { x: 5, y: 2, z: -3 }, 0);
    const b = box(c.root);
    expect(b.min.y).toBeCloseTo(2, 3);
    expect(b.max.y).toBeCloseTo(2 + cap.height, 3);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(5, 1);
  });

  it('crouched or sliding it is crouchHeight tall', () => {
    const c = make();
    place(c, { x: 0, y: 0, z: 0 }, 0, true);
    expect(box(c.root).max.y).toBeCloseTo(cap.crouchHeight, 3);
    c.update(0, st(0, true, 'slide'), { x: 0, y: 0, z: 0 }, 8);
    expect(box(c.root).max.y).toBeCloseTo(cap.crouchHeight, 3);
  });

  it('the front marker points along the heading (yaw 0 faces −Z, positive turns left)', () => {
    const c = make();
    const front = (): THREE.Vector3 => c.front.getWorldPosition(new THREE.Vector3());
    place(c, { x: 0, y: 0, z: 0 }, 0);
    c.root.updateMatrixWorld(true);
    expect(front().z).toBeLessThan(-cap.radius * 0.7);
    place(c, { x: 0, y: 0, z: 0 }, Math.PI / 2);
    c.root.updateMatrixWorld(true);
    expect(front().x).toBeLessThan(-cap.radius * 0.7);
    expect(Math.abs(front().z)).toBeLessThan(1e-6);
  });

  it('turns toward the heading at turnEaseRate (no snap) once placed', () => {
    const c = make();
    place(c, { x: 0, y: 0, z: 0 }, 0);
    c.update(0.05, st(1), { x: 0, y: 0, z: 0 }, 0);
    expect(c.root.rotation.y).toBeGreaterThan(0);
    expect(c.root.rotation.y).toBeLessThan(1);
    c.update(10, st(1), { x: 0, y: 0, z: 0 }, 0);
    expect(c.root.rotation.y).toBeCloseTo(1, 5);
  });

  it('in a slide it faces its travel, not the input (R14)', () => {
    const c = make();
    const slide = { ...st(Math.PI / 2, true, 'slide'), velocity: { x: 0, y: 0, z: 12 } } as PlayerState;
    c.snap();
    c.update(0, slide, { x: 0, y: 0, z: 0 }, 12);
    expect(Math.abs(c.root.rotation.y)).toBeCloseTo(Math.PI, 6);
  });

  it('stands on the interpolated feet; a snap places it at once', () => {
    const c = make();
    c.snap();
    c.update(0.016, st(0), { x: 0, y: 9, z: 0 }, 5);
    c.update(0.016, st(0), { x: 0, y: 7.5, z: 0 }, 5);
    expect(c.root.position.y).toBe(7.5);
    c.snap();
    c.update(0.016, st(0, false, 'air'), { x: 40, y: 2, z: 0 }, 0);
    expect(c.root.position.y).toBe(2);
  });

  it('the visor stays inside the capsule radius (nothing pokes past the collision capsule)', () => {
    const c = make();
    place(c, { x: 0, y: 0, z: 0 }, 0);
    const b = box(c.root);
    expect(Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z)).toBeLessThanOrEqual(cap.radius + 1e-9);
  });

  it('hiding the courier keeps its shadow', () => {
    const c = make();
    c.setHidden(true);
    const meshes: THREE.Mesh[] = [];
    c.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(c.root.visible).toBe(true);
    // Hidden from the camera (colourWrite off) but still drawn into the shadow map.
    expect(meshes.every((m) => m.castShadow && (m.material as THREE.Material).colorWrite === false)).toBe(true);
    c.setHidden(false);
    expect(meshes.every((m) => (m.material as THREE.Material).colorWrite)).toBe(true);
  });

  it('reports itself as the fallback (not loaded) and ignores packages', () => {
    const c = make();
    c.setPackages(3);
    expect(c.debug()).toMatchObject({ loaded: false, clip: null, packages: 3 });
  });

  it('casts shadows and costs two meshes', () => {
    const c = make();
    const meshes: THREE.Mesh[] = [];
    c.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes).toHaveLength(2);
    expect(meshes.every((m) => m.castShadow)).toBe(true);
  });

  it('riding: hidden inside the car, lifted onto the skateboard deck', () => {
    const c = make();
    const riding = (t: string): PlayerState => ({ ...st(0), riding: t }) as unknown as PlayerState;
    c.update(0, riding('car'), { x: 0, y: 0, z: 0 }, 10);
    expect(c.root.visible).toBe(false);
    c.update(0, riding('skateboard'), { x: 0, y: 0, z: 0 }, 5);
    expect(c.root.visible).toBe(true);
    expect(box(c.root).min.y).toBeCloseTo(riderLift('skateboard'), 3);
    expect(riderLift('skateboard')).toBeGreaterThan(0.05);
    c.update(0, st(0), { x: 0, y: 0, z: 0 }, 0);
    expect(box(c.root).min.y).toBeCloseTo(0, 3);
  });
});
