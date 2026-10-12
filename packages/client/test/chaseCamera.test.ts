import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { PlayerState, Vec3 } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { fovForSpeed } from '../src/render/cameraRig';
import { ChaseCamera, chaseCameraPose, pivotHeightFor, type RayCast } from '../src/render/chaseCamera';

const cam = clientConfig.camera;
const chase = cam.chase;
const DEG = Math.PI / 180;

/** No geometry anywhere. */
const open: RayCast = () => null;

/** An infinite wall plane at z = zWall: blocks any ray crossing it, from either side. */
const wallAtZ =
  (zWall: number): RayCast =>
  (from, dir, maxDist) => {
    if (dir.z === 0) return null;
    const d = (zWall - from.z) / dir.z;
    return d >= 0 && d <= maxDist ? d : null;
  };

const feet = { x: 10, y: 2, z: -5 };
const pivot = (f: Vec3 = feet, h: number = chase.pivotHeight): Vec3 => ({ x: f.x, y: f.y + h, z: f.z });
const standing = { mode: 'ground', crouched: false, yaw: 0, wallRun: { time: 0, normal: null, lastNormal: null } } as unknown as PlayerState;

describe('chaseCameraPose', () => {
  it('open ground: camera sits 4.5 m behind and 1.6 m above the courier', () => {
    expect(chase.distance).toBe(4.5);
    expect(chase.height).toBe(1.6);
    const p = chaseCameraPose(pivot(), 0, 0, chase, open);
    // Yaw 0 faces −Z, so "behind" is +Z.
    expect(p.position.x).toBeCloseTo(feet.x, 9);
    expect(p.position.y).toBeCloseTo(feet.y + 1.6, 9);
    expect(p.position.z).toBeCloseTo(feet.z + 4.5, 9);
    expect(p.distance).toBeCloseTo(Math.hypot(4.5, 1.6 - chase.pivotHeight), 9);
  });

  it('the camera looks along the mouse look direction (yaw, pitch), so the courier sits low in frame', () => {
    const yaw = 0.7;
    const pitch = -20 * DEG;
    const p = chaseCameraPose(pivot(), yaw, pitch, chase, open);
    const v = new THREE.Vector3(p.lookAt.x - p.position.x, p.lookAt.y - p.position.y, p.lookAt.z - p.position.z).normalize();
    expect(v.x).toBeCloseTo(-Math.sin(yaw) * Math.cos(pitch), 9);
    expect(v.y).toBeCloseTo(Math.sin(pitch), 9);
    expect(v.z).toBeCloseTo(-Math.cos(yaw) * Math.cos(pitch), 9);
  });

  it('looking down orbits the camera up over the courier', () => {
    const level = chaseCameraPose(pivot(), 0, 0, chase, open);
    const down = chaseCameraPose(pivot(), 0, chase.pitchMinDeg * DEG, chase, open);
    expect(down.position.y).toBeGreaterThan(level.position.y + 3);
    expect(down.position.z - feet.z).toBeLessThan(level.position.z - feet.z);
  });

  it('a wall 2 m behind pulls the camera in to 2 − collisionRadius (Review Focus 1)', () => {
    const cast = wallAtZ(feet.z + 2);
    const p = chaseCameraPose(pivot(), 0, 0, chase, cast);
    expect(p.position.z - feet.z).toBeCloseTo(2 - chase.collisionRadius, 2);
    expect(p.position.z).toBeLessThan(feet.z + 2);
    // Exactly d − collisionRadius along the ray toward the desired point.
    const dir = { x: 0, y: chase.height - chase.pivotHeight, z: chase.distance };
    const len = Math.hypot(dir.y, dir.z);
    expect(p.distance).toBeCloseTo(2 / (dir.z / len) - chase.collisionRadius, 9);
  });

  it('never closer than minDistance', () => {
    const p = chaseCameraPose(pivot(), 0, 0, chase, wallAtZ(feet.z + 0.5));
    expect(p.distance).toBe(chase.minDistance);
    const q = chaseCameraPose(pivot(), 0, 0, chase, () => 0);
    expect(q.distance).toBe(chase.minDistance);
  });

  it('reports the clear length of the boom (how far it reaches before a hit)', () => {
    expect(chaseCameraPose(pivot(), 0, 0, chase, open).clear).toBeCloseTo(Math.hypot(4.5, 0.3), 9);
    expect(chaseCameraPose(pivot(), 0, 0, chase, () => 0.5).clear).toBe(0.5);
  });
});

describe('pivotHeightFor', () => {
  it('is pivotHeight standing and crouchPivotHeight while crouched or sliding', () => {
    expect(pivotHeightFor(standing, chase)).toBe(chase.pivotHeight);
    expect(pivotHeightFor({ ...standing, crouched: true }, chase)).toBe(chase.crouchPivotHeight);
    expect(pivotHeightFor({ ...standing, mode: 'slide' } as PlayerState, chase)).toBe(chase.crouchPivotHeight);
  });
});

describe('ChaseCamera', () => {
  const make = (cast: RayCast = open): ChaseCamera => new ChaseCamera(new THREE.PerspectiveCamera(cam.fovBase, 1, cam.near, cam.far), cam, cast);

  it('the first update places the camera at the pose (no sweep in from the origin)', () => {
    const c = make();
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    expect(c.camera.position.z).toBeCloseTo(feet.z + 4.5, 6);
    expect(c.camera.position.y).toBeCloseTo(feet.y + 1.6, 6);
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
    expect(c.camera.position.y).toBeCloseTo(feet.y - 2 + 1.6, 3);
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

  it('pulls in fast and pushes out slowly', () => {
    let wall: RayCast = open;
    const c = make((f, d, m) => wall(f, d, m));
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    const full = c.distance;
    wall = wallAtZ(feet.z + 2);
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    const target = chaseCameraPose(pivot(), 0, 0, chase, wall).distance;
    const pulledIn = (full - c.distance) / (full - target);
    wall = open;
    const before = c.distance;
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    const pushedOut = (c.distance - before) / (full - before);
    expect(pulledIn).toBeGreaterThan(pushedOut);
    expect(pushedOut).toBeGreaterThan(0);
    expect(pushedOut).toBeLessThan(0.2);
  });

  it('never ends up past a hit surface, even while easing in or held at minDistance', () => {
    let wall: RayCast = open;
    const c = make((f, d, m) => wall(f, d, m));
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    wall = wallAtZ(feet.z + 2);
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    expect(c.camera.position.z).toBeLessThan(feet.z + 2);
    // Back against a wall: the minDistance floor would put the camera inside it, so the camera stays in front of
    // the wall and the courier is hidden instead.
    wall = wallAtZ(feet.z + 0.4);
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    expect(c.camera.position.z).toBeLessThan(feet.z + 0.4);
    expect(c.courierHidden).toBe(true);
    wall = open;
    for (let i = 0; i < 300; i++) c.update(1 / 60, pivot(), 0, 0, 0, standing);
    expect(c.courierHidden).toBe(false);
  });

  it('the eased follow point never crosses a wall the courier went around', () => {
    // Walls block everything travelling toward +Z from below z = −4; the courier is already past it.
    const cast = wallAtZ(-4);
    const c = make(cast);
    c.update(1 / 60, pivot({ x: 0, y: 0, z: -10 }), 0, 0, 0, standing);
    c.update(1 / 60, pivot({ x: 0, y: 0, z: -3 }), Math.PI, 0, 0, standing);
    // The lagging follow point stays on the courier's side of the wall, so the camera does too.
    expect(c.camera.position.z).toBeGreaterThan(-4);
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
