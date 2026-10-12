import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { PlayerState, Vec3 } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { fovForSpeed } from '../src/render/cameraRig';
import {
  ChaseCamera,
  chaseCameraPose,
  clampPivotHeight,
  isLow,
  pivotHeightFor,
  type RayCast,
} from '../src/render/chaseCamera';

const cam = clientConfig.camera;
const chase = cam.chase;
const R = chase.collisionRadius;
const DEG = Math.PI / 180;
/** Open-ground boom length and its share along +Z at yaw 0, pitch 0. */
const FULL = Math.hypot(chase.distance, chase.height);
const DIR_Z = chase.distance / FULL;

/** No geometry anywhere. */
const open: RayCast = () => null;

/**
 * Sphere-cast mock: an infinite wall plane at z = zWall, blocking from either side. Returns how far the centre of a
 * ball of radius collisionRadius travels before the ball touches the plane.
 */
const wallAtZ =
  (zWall: number): RayCast =>
  (from, dir, maxDist) => {
    const gap = zWall - from.z;
    if (dir.z === 0 || Math.sign(gap) !== Math.sign(dir.z)) return null;
    const d = Math.max(0, (Math.abs(gap) - R) / Math.abs(dir.z));
    return d <= maxDist ? d : null;
  };

/** Sphere-cast mock: a ceiling plane at y = yRoof. */
const roofAt =
  (yRoof: number): RayCast =>
  (from, dir, maxDist) => {
    if (dir.y <= 0) return null;
    const d = (yRoof - R - from.y) / dir.y;
    return d <= maxDist ? Math.max(0, d) : null;
  };

const both =
  (...casts: RayCast[]): RayCast =>
  (f, d, m) => {
    const hits = casts.map((c) => c(f, d, m)).filter((h): h is number => h !== null);
    return hits.length ? Math.min(...hits) : null;
  };

const feet = { x: 10, y: 2, z: -5 };
const pivot = (f: Vec3 = feet, h: number = chase.pivotHeight): Vec3 => ({ x: f.x, y: f.y + h, z: f.z });
const standing = { mode: 'ground', crouched: false, yaw: 0, wallRun: { time: 0, normal: null, lastNormal: null } } as unknown as PlayerState;

/** Unit view direction of a pose. */
const view = (p: { position: Vec3; lookAt: Vec3 }): THREE.Vector3 =>
  new THREE.Vector3(p.lookAt.x - p.position.x, p.lookAt.y - p.position.y, p.lookAt.z - p.position.z).normalize();

describe('chaseCameraPose', () => {
  it('open ground: camera sits 4.5 m behind and 1.6 m above the pivot (R9: feet + pivotHeight + 1.6)', () => {
    expect(chase.distance).toBe(4.5);
    expect(chase.height).toBe(1.6);
    const p = chaseCameraPose(pivot(), 0, 0, chase, open);
    // Yaw 0 faces −Z, so "behind" is +Z.
    expect(p.position.x).toBeCloseTo(feet.x, 9);
    expect(p.position.y).toBeCloseTo(feet.y + chase.pivotHeight + 1.6, 9);
    expect(p.position.z).toBeCloseTo(feet.z + 4.5, 9);
    expect(p.distance).toBeCloseTo(FULL, 9);
  });

  it('R9: looks at the point lookAtHeight above the feet, so the courier sits in the lower half', () => {
    expect(chase.lookAtHeight).toBe(1.9);
    const p = chaseCameraPose(pivot(), 0.7, 0, chase, open);
    const aim = new THREE.Vector3(feet.x - p.position.x, feet.y + chase.lookAtHeight - p.position.y, feet.z - p.position.z).normalize();
    expect(view(p).distanceTo(aim)).toBeLessThan(1e-9);
    // The feet and the pivot project below the screen centre.
    const c = new THREE.PerspectiveCamera(cam.fovBase, 16 / 9, cam.near, cam.far);
    c.position.set(p.position.x, p.position.y, p.position.z);
    c.lookAt(p.lookAt.x, p.lookAt.y, p.lookAt.z);
    c.updateMatrixWorld(true);
    expect(new THREE.Vector3(feet.x, feet.y, feet.z).project(c).y).toBeLessThan(-0.3);
    expect(new THREE.Vector3(feet.x, feet.y + chase.pivotHeight, feet.z).project(c).y).toBeLessThan(0);
  });

  it('looking down orbits the camera up over the courier', () => {
    const level = chaseCameraPose(pivot(), 0, 0, chase, open);
    const down = chaseCameraPose(pivot(), 0, chase.pitchMinDeg * DEG, chase, open);
    expect(down.position.y).toBeGreaterThan(level.position.y + 3);
    expect(down.position.z - feet.z).toBeLessThan(level.position.z - feet.z);
  });

  it('a wall 2 m behind pulls the camera in to 2 − collisionRadius (Review Focus 1, sphere cast: no double subtraction)', () => {
    const p = chaseCameraPose(pivot(), 0, 0, chase, wallAtZ(feet.z + 2));
    expect(p.position.z - feet.z).toBeCloseTo(2 - R, 9);
    expect(p.distance).toBeCloseTo((2 - R) / DIR_Z, 9);
    expect(p.blocked).toBe(true);
    expect(p.clear).toBeCloseTo((2 - R) / DIR_Z, 9);
  });

  it('never closer than minDistance', () => {
    const p = chaseCameraPose(pivot(), 0, 0, chase, wallAtZ(feet.z + 0.5));
    expect(p.distance).toBe(chase.minDistance);
    expect(p.clear).toBeCloseTo((0.5 - R) / DIR_Z, 9);
    expect(chaseCameraPose(pivot(), 0, 0, chase, () => 0).distance).toBe(chase.minDistance);
  });

  it('a low ceiling caps the lift first, then the boom runs back under it (crouch tunnel)', () => {
    // Crouched pivot 0.8 m above the feet, roof underside 1.4 m above them.
    const crouched = pivot(feet, chase.crouchPivotHeight);
    const p = chaseCameraPose(crouched, 0, 0, chase, roofAt(feet.y + 1.4));
    expect(p.position.y).toBeCloseTo(feet.y + 1.4 - R, 6);
    expect(p.position.z - feet.z).toBeCloseTo(4.5, 6);
  });
});

describe('pivot helpers', () => {
  it('isLow: crouched or sliding', () => {
    expect(isLow(standing)).toBe(false);
    expect(isLow({ ...standing, crouched: true })).toBe(true);
    expect(isLow({ ...standing, mode: 'slide' } as PlayerState)).toBe(true);
  });

  it('pivotHeightFor is pivotHeight standing and crouchPivotHeight while low', () => {
    expect(pivotHeightFor(standing, chase)).toBe(chase.pivotHeight);
    expect(pivotHeightFor({ ...standing, crouched: true }, chase)).toBe(chase.crouchPivotHeight);
  });

  it('clampPivotHeight keeps the collision ball under a low ceiling (pivot still easing down after a crouch)', () => {
    expect(clampPivotHeight(feet, 1.3, open, chase)).toBe(1.3);
    expect(clampPivotHeight(feet, 1.3, roofAt(feet.y + 1.4), chase)).toBeCloseTo(1.4 - R, 9);
    expect(clampPivotHeight(feet, 0.8, roofAt(feet.y + 1.4), chase)).toBe(0.8);
  });
});

describe('ChaseCamera', () => {
  const make = (cast: RayCast = open): ChaseCamera =>
    new ChaseCamera(new THREE.PerspectiveCamera(cam.fovBase, 1, cam.near, cam.far), cam, cast);

  it('the first update places the camera at the pose (no sweep in from the origin)', () => {
    const c = make();
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    expect(c.camera.position.z).toBeCloseTo(feet.z + 4.5, 6);
    expect(c.camera.position.y).toBeCloseTo(feet.y + chase.pivotHeight + 1.6, 6);
  });

  it('the camera faces the pose look-at point', () => {
    const c = make();
    c.update(1 / 60, pivot(), 0.4, -0.2, 0, standing);
    const p = chaseCameraPose(pivot(), 0.4, -0.2, chase, open);
    const v = c.camera.getWorldDirection(new THREE.Vector3());
    expect(v.distanceTo(view(p))).toBeLessThan(1e-6);
  });

  it('follows with a slight lag: a 2 m drop (zip dismount) is eased, not snapped', () => {
    const c = make();
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    const y0 = c.camera.position.y;
    const dropped = pivot({ ...feet, y: feet.y - 2 });
    c.update(1 / 60, dropped, 0, 0, 0, standing);
    const fell = y0 - c.camera.position.y;
    expect(fell).toBeGreaterThan(0);
    expect(fell).toBeLessThan(1);
    for (let i = 0; i < 60; i++) c.update(1 / 60, dropped, 0, 0, 0, standing);
    expect(c.camera.position.y).toBeCloseTo(feet.y - 2 + chase.pivotHeight + 1.6, 3);
  });

  it('snap() jumps straight to the new pose (teleport, respawn)', () => {
    const c = make();
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    c.snap();
    const far = { x: 200, y: 0, z: 300 };
    c.update(1 / 60, pivot(far), 0, 0, 0, standing);
    expect(c.camera.position.x).toBeCloseTo(200, 6);
    expect(c.camera.position.z).toBeCloseTo(304.5, 6);
  });

  it('pulls in at once when a wall blocks the boom, and pushes back out slowly', () => {
    let wall: RayCast = open;
    const c = make((f, d, m) => wall(f, d, m));
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    expect(c.distance).toBeCloseTo(FULL, 9);
    wall = wallAtZ(feet.z + 2);
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    const blocked = (2 - R) / DIR_Z;
    expect(c.distance).toBeCloseTo(blocked, 9);
    expect(c.camera.position.z).toBeCloseTo(feet.z + 2 - R, 6);
    wall = open;
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    const k = 1 - Math.exp(-chase.pushOutEaseRate / 60);
    expect(c.distance).toBeCloseTo(blocked + (FULL - blocked) * k, 9);
    for (let i = 0; i < 300; i++) c.update(1 / 60, pivot(), 0, 0, 0, standing);
    expect(c.distance).toBeCloseTo(FULL, 6);
  });

  it('R10: in a low gap with a wall behind, the camera stays clear of both and the courier hides', () => {
    // Crouched in a tunnel (roof 1.4 m above the feet) with a wall 0.4 m behind: the camera ends up within
    // minDistance of the pivot.
    let geo: RayCast = both(roofAt(feet.y + 1.4), wallAtZ(feet.z + 0.4));
    const c = make((f, d, m) => geo(f, d, m));
    const low = pivot(feet, chase.crouchPivotHeight);
    c.update(1 / 60, low, 0, 0, 0, standing);
    expect(c.camera.position.z).toBeLessThanOrEqual(feet.z + 0.4 - R + 1e-9);
    expect(c.camera.position.y).toBeLessThanOrEqual(feet.y + 1.4 - R + 1e-9);
    expect(c.courierHidden).toBe(true);
    geo = open;
    for (let i = 0; i < 300; i++) c.update(1 / 60, low, 0, 0, 0, standing);
    expect(c.courierHidden).toBe(false);
  });

  it('standing flush against a wall: the camera stays in front of it, the courier hides and the view holds steady', () => {
    const c = make(wallAtZ(feet.z + 0.4));
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    expect(c.camera.position.z).toBeLessThanOrEqual(feet.z + 0.4 - R + 1e-9);
    expect(c.courierHidden).toBe(true);
    const openView = chaseCameraPose(pivot(), 0, 0, chase, open);
    expect(c.camera.getWorldDirection(new THREE.Vector3()).distanceTo(view(openView))).toBeLessThan(1e-6);
  });

  it('the eased follow point never crosses a wall the courier went around', () => {
    const c = make(wallAtZ(-4));
    c.update(1 / 60, pivot({ x: 0, y: 0, z: -10 }), 0, 0, 0, standing);
    c.update(1 / 60, pivot({ x: 0, y: 0, z: -3 }), Math.PI, 0, 0, standing);
    // The lagging follow point stays on the courier's side of the wall, so the camera ball does too.
    expect(c.camera.position.z).toBeGreaterThanOrEqual(-4 + R - 1e-9);
  });

  it('a low ceiling over open ground behind keeps the camera under it at full distance', () => {
    const c = make(roofAt(feet.y + 1.4));
    c.update(1 / 60, pivot(feet, chase.crouchPivotHeight), 0, 0, 0, standing);
    expect(c.camera.position.y).toBeLessThanOrEqual(feet.y + 1.4 - R + 1e-9);
    expect(c.courierHidden).toBe(false);
  });

  it('keeps the FOV kick and the wall-run roll easing', () => {
    const c = make();
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    expect(c.camera.fov).toBeCloseTo(cam.fovBase, 6);
    c.update(1 / 60, pivot(), 0, 0, 30, standing);
    expect(c.camera.fov).toBeGreaterThan(cam.fovBase);
    expect(c.camera.fov).toBeLessThan(fovForSpeed(30, cam));
    const wallRun = { ...standing, mode: 'wallrun', wallRun: { time: 0.2, normal: { x: -1, y: 0, z: 0 }, lastNormal: null } } as unknown as PlayerState;
    c.update(1 / 60, pivot(), 0, 0, 0, wallRun);
    // Wall on the right: roll −8° clockwise → rotation.z eases toward +8°.
    expect(c.camera.rotation.z).toBeGreaterThan(0);
    expect(c.camera.rotation.z).toBeLessThan(cam.wallRunRollDeg * DEG);
  });
});
