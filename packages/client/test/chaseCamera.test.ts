import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { movementConfig, type PlayerState, type Vec3 } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { fovForSpeed } from '../src/render/cameraRig';
import {
  ChaseCamera,
  chaseCameraPose,
  clampPivotHeight,
  headroom,
  isLow,
  pivotHeightFor,
  type RayCast,
  type WallProbe,
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

/** Sphere-cast mock: an infinite wall plane at x = xWall, blocking from either side. */
const wallAtX =
  (xWall: number): RayCast =>
  (from, dir, maxDist) => {
    const gap = xWall - from.x;
    if (dir.x === 0 || Math.sign(gap) !== Math.sign(dir.x)) return null;
    const d = Math.max(0, (Math.abs(gap) - R) / Math.abs(dir.x));
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
  it('crouch tunnel, looking down: the boom runs back under the roof instead of into it, courier in frame', () => {
    const crouched = pivot(feet, chase.crouchPivotHeight);
    const pitch = -20 * DEG;
    const p = chaseCameraPose(crouched, 0, pitch, chase, roofAt(feet.y + 1.4));
    expect(p.position.y).toBeLessThanOrEqual(feet.y + 1.4 - R + 1e-9);
    expect(p.position.z - feet.z).toBeCloseTo(chase.distance * Math.cos(pitch), 6);
    expect(p.distance).toBeGreaterThan(chase.minDistance);
    const c = new THREE.PerspectiveCamera(cam.fovBase, 16 / 9, cam.near, cam.far);
    c.position.set(p.position.x, p.position.y, p.position.z);
    c.lookAt(p.lookAt.x, p.lookAt.y, p.lookAt.z);
    c.updateMatrixWorld(true);
    const ndc = new THREE.Vector3(crouched.x, crouched.y, crouched.z).project(c);
    expect(ndc.y).toBeLessThan(0);
    expect(ndc.y).toBeGreaterThan(-1);
  });

  it('headroom: how far the collision ball rises above the pivot, up to height + distance', () => {
    expect(headroom(pivot(), chase, open)).toBe(chase.height + chase.distance);
    expect(headroom(pivot(feet, chase.crouchPivotHeight), chase, roofAt(feet.y + 1.4))).toBeCloseTo(1.4 - chase.crouchPivotHeight - R, 9);
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
  /** The movement capsule radius: the courier's axis never comes closer than this to a wall. */
  const CAP_R = movementConfig.capsule.radius;
  const make = (cast: RayCast = open, probe?: WallProbe): ChaseCamera =>
    new ChaseCamera(new THREE.PerspectiveCamera(cam.fovBase, 1, cam.near, cam.far), cam, cast, {
      probe,
      courierRadius: () => CAP_R,
    });

  it('courierDistance is the camera\'s distance to the courier\'s own pivot', () => {
    const c = make();
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    const p = c.camera.position;
    expect(c.courierDistance).toBeCloseTo(Math.hypot(p.x - feet.x, p.y - pivot().y, p.z - feet.z), 9);
    expect(c.courierDistance).toBeCloseTo(FULL, 9);
    expect(c.courierHidden).toBe(false);
  });

  describe('R12: wall pivot offset', () => {
    // A wall on the courier's left (face x = feet.x − 0.36, normal +X) while it runs toward −Z (yaw 0).
    const xWall = feet.x - 0.36;
    const normal = { x: 1, y: 0, z: 0 };
    const wallRunning = { ...standing, mode: 'wallrun', wallRun: { time: 0.1, normal, lastNormal: normal } } as unknown as PlayerState;
    /** Look 30° off the wall, turned away from it, so the boom swings toward the wall. */
    const yaw30 = -30 * DEG;
    /** Probe mock for a wall face at x = xw: its normal and distance when within reach. */
    const probeAtX =
      (xw: number, reaches: number[] = []): WallProbe =>
      (p, reach) => {
        reaches.push(reach);
        const d = p.x - xw;
        return d >= 0 && d < reach ? { normal, distance: d } : null;
      };
    /** Where the settled camera goes for a pivot shifted `shift` along +X. */
    const settledX = (shift: number, yaw: number, cast: RayCast): number =>
      chaseCameraPose({ ...pivot(), x: feet.x + shift }, yaw, 0, chase, cast).position.x;

    it('wall-running, wall 0.36 m from the pivot, look 30° off it: boom ≥ minDistance and the courier stays visible', () => {
      expect(chase.wallPivotOffset).toBe(0.6);
      const c = make(wallAtX(xWall));
      for (let i = 0; i < 60; i++) c.update(1 / 60, pivot(), yaw30, 0, 0, wallRunning);
      expect(c.distance).toBeGreaterThanOrEqual(chase.minDistance);
      expect(c.courierDistance).toBeGreaterThanOrEqual(chase.minDistance);
      expect(c.courierHidden).toBe(false);
      expect(c.camera.position.x).toBeGreaterThanOrEqual(xWall + R - 1e-9);
      // Settled: wall-running holds the courier flush, so the pivot sits the full wallPivotOffset off its axis.
      const want = chaseCameraPose({ ...pivot(), x: feet.x + chase.wallPivotOffset }, yaw30, 0, chase, wallAtX(xWall));
      expect(c.camera.position.x).toBeCloseTo(want.position.x, 4);
      expect(c.camera.position.z).toBeCloseTo(want.position.z, 4);
    });

    it('hides by the real camera-to-courier distance: shifted boom ≥ minDistance, camera < minDistance from the courier', () => {
      // Look 60° off the wall: the boom from the shifted pivot runs back toward the wall and ends beside the courier.
      const c = make(wallAtX(xWall));
      for (let i = 0; i < 60; i++) c.update(1 / 60, pivot(), -60 * DEG, 0, 0, wallRunning);
      expect(c.distance).toBeGreaterThanOrEqual(chase.minDistance);
      expect(c.courierDistance).toBeLessThan(chase.minDistance);
      expect(c.courierHidden).toBe(true);
    });

    it('not wall-running: the probe shift is continuous, max(0, capsuleRadius + wallPivotOffset − d), probed to that reach', () => {
      const reachWanted = CAP_R + chase.wallPivotOffset;
      for (const d of [0.36, 0.5, 0.7, 0.9, reachWanted - 0.01, reachWanted + 0.01, 1.3]) {
        const xw = feet.x - d;
        const reaches: number[] = [];
        const c = make(wallAtX(xw), probeAtX(xw, reaches));
        for (let i = 0; i < 120; i++) c.update(1 / 60, pivot(), 0, 0, 0, standing);
        expect(reaches.every((r) => Math.abs(r - reachWanted) < 1e-12), `reach at d ${d}`).toBe(true);
        const shift = Math.max(0, reachWanted - d);
        expect(c.camera.position.x, `d ${d}`).toBeCloseTo(settledX(shift, 0, wallAtX(xw)), 4);
      }
      // About wallPivotOffset when flush; next to nothing at the edge of the reach (no jump).
      expect(Math.max(0, reachWanted - 0.36)).toBeGreaterThan(chase.wallPivotOffset - 0.02);
      expect(Math.max(0, reachWanted - (reachWanted - 0.01))).toBeLessThan(0.02);
    });

    it('not wall-running, flush with the wall, look 30° off it: the courier stays visible', () => {
      const c = make(wallAtX(xWall), probeAtX(xWall));
      for (let i = 0; i < 60; i++) c.update(1 / 60, pivot(), yaw30, 0, 0, standing);
      expect(c.courierDistance).toBeGreaterThanOrEqual(chase.minDistance);
      expect(c.courierHidden).toBe(false);
    });

    it('the offset eases in (no jump) and back out when the run ends', () => {
      const c = make(wallAtX(xWall));
      c.update(1 / 60, pivot(), 0, 0, 0, standing);
      const x0 = c.camera.position.x;
      c.update(1 / 60, pivot(), 0, 0, 0, wallRunning);
      const step = c.camera.position.x - x0;
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThan(chase.wallPivotOffset / 2);
      for (let i = 0; i < 120; i++) c.update(1 / 60, pivot(), 0, 0, 0, wallRunning);
      expect(c.camera.position.x).toBeCloseTo(x0 + chase.wallPivotOffset, 4);
      c.update(1 / 60, pivot(), 0, 0, 0, standing);
      const back = c.camera.position.x - (x0 + chase.wallPivotOffset);
      expect(back).toBeLessThan(0);
      expect(back).toBeGreaterThan(-chase.wallPivotOffset / 2);
      for (let i = 0; i < 120; i++) c.update(1 / 60, pivot(), 0, 0, 0, standing);
      expect(c.camera.position.x).toBeCloseTo(x0, 4);
    });

    it('in a gap narrower than the offset, the shifted pivot stops short of the opposite wall', () => {
      // A second wall 0.5 m from the pivot on the other side.
      const xOther = feet.x + 0.5;
      const geo: RayCast = (f, d, m) => {
        const hits = [wallAtX(xWall)(f, d, m), wallAtX(xOther)(f, d, m)].filter((h): h is number => h !== null);
        return hits.length ? Math.min(...hits) : null;
      };
      const c = make(geo);
      for (let i = 0; i < 120; i++) c.update(1 / 60, pivot(), 0, 0, 0, wallRunning);
      expect(c.camera.position.x).toBeLessThanOrEqual(xOther - R + 1e-9);
      expect(c.camera.position.x).toBeGreaterThanOrEqual(xWall + R - 1e-9);
    });
  });

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

  it('crouched in the tunnel looking down, the courier stays in view', () => {
    const c = make(roofAt(feet.y + 1.4));
    c.update(1 / 60, pivot(feet, chase.crouchPivotHeight), 0, -20 * DEG, 0, standing);
    expect(c.camera.position.y).toBeLessThanOrEqual(feet.y + 1.4 - R + 1e-9);
    expect(c.courierHidden).toBe(false);
  });

  it('leaving a low ceiling, the camera rises back smoothly (no pop), then settles on the open pose', () => {
    let geo: RayCast = roofAt(feet.y + 1.4);
    const c = make((f, d, m) => geo(f, d, m));
    const low = pivot(feet, chase.crouchPivotHeight);
    const pitch = -20 * DEG;
    for (let i = 0; i < 5; i++) c.update(1 / 60, low, 0, pitch, 0, standing);
    const y0 = c.camera.position.y;
    geo = open;
    c.update(1 / 60, low, 0, pitch, 0, standing);
    const rose = c.camera.position.y - y0;
    expect(rose).toBeGreaterThan(0);
    expect(rose).toBeLessThan(0.5);
    for (let i = 0; i < 300; i++) c.update(1 / 60, low, 0, pitch, 0, standing);
    expect(c.camera.position.y).toBeCloseTo(chaseCameraPose(low, 0, pitch, chase, open).position.y, 6);
  });

  it('on open ground the mouse pitch moves the camera at once (no easing lag)', () => {
    const c = make();
    c.update(1 / 60, pivot(), 0, 0, 0, standing);
    c.update(1 / 60, pivot(), 0, chase.pitchMinDeg * DEG, 0, standing);
    const want = chaseCameraPose(pivot(), 0, chase.pitchMinDeg * DEG, chase, open).position;
    expect(c.camera.position.y).toBeCloseTo(want.y, 9);
    expect(c.camera.position.z).toBeCloseTo(want.z, 9);
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
