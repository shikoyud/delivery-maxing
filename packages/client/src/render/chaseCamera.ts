import type * as THREE from 'three';
import type { PlayerState, Vec3 } from '@dm/shared';
import type { ChaseConfig, ClientConfig } from '../clientConfig';
import { easeToward, fovForSpeed, rollForWallRun } from './cameraRig';

type CameraConfig = ClientConfig['camera'];

/**
 * Camera collision query: how far the centre of the camera's collision ball (radius camera.chase.collisionRadius)
 * travels from `from` along the unit vector `dir` before touching a solid, or null when it travels `maxDist` freely.
 * In the game this is a Rapier sphere cast (game/cameraQueries.ts).
 */
export type RayCast = (from: Vec3, dir: Vec3, maxDist: number) => number | null;

export interface ChasePose {
  /** Where the camera goes. */
  position: Vec3;
  /** A point the camera looks at (one metre along its view direction). */
  lookAt: Vec3;
  /** Boom length from the pivot to `position` (collision-shortened, never below minDistance). */
  distance: number;
  /** Unit vector from the pivot toward the camera. */
  direction: Vec3;
  /** Unit view direction. */
  view: Vec3;
  /** True when geometry blocks the full boom. */
  blocked: boolean;
  /** How far along `direction` the collision ball travels freely (the full boom length when not blocked). */
  clear: number;
}

const UP = { x: 0, y: 1, z: 0 };

/** Unit look direction for yaw and pitch (yaw 0 faces −Z, positive turns left; positive pitch looks up). */
export function lookDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

/** Whether the courier is low: crouched or sliding (lower pivot, shorter body). */
export function isLow(state: PlayerState): boolean {
  return state.crouched || state.mode === 'slide';
}

/** Pivot height above the feet: lower while crouched or sliding, so the boom fits under low ceilings. */
export function pivotHeightFor(state: PlayerState, chase: ChaseConfig): number {
  return isLow(state) ? chase.crouchPivotHeight : chase.pivotHeight;
}

/**
 * Lowers a pivot height so the collision ball fits at the pivot: a cast straight up from one ball radius above the
 * feet. Covers the moment after a crouch into a low gap while the eased pivot height is still coming down.
 */
export function clampPivotHeight(feet: Vec3, height: number, cast: RayCast, chase: ChaseConfig): number {
  const r = chase.collisionRadius;
  if (height <= r) return height;
  const hit = cast({ x: feet.x, y: feet.y + r, z: feet.z }, UP, height - r);
  return hit === null ? height : r + hit;
}

const add = (a: Vec3, d: Vec3, k: number): Vec3 => ({ x: a.x + d.x * k, y: a.y + d.y * k, z: a.z + d.z * k });

/**
 * Third-person chase pose (spec §4 "Camera", R9). `target` is the pivot (feet + pivot height). On open ground the camera
 * sits at the desired point target − look(yaw, pitch) × distance + (0, height, 0) and looks at the aim point
 * lookAtHeight above the feet. A low ceiling trims the lift first (a cast straight up), so in a tunnel the boom runs
 * back under the roof instead of into it. The boom itself is one cast from the pivot toward the desired point, so the
 * camera always has a clear line of sight to the courier; a hit at d (the collision ball's travel, so no radius is
 * subtracted again) shortens it to max(minDistance, d). The view direction is the desired point's view of the aim
 * point, so pulling the boom in never swings the view.
 */
export function chaseCameraPose(target: Vec3, yaw: number, pitch: number, cam: ChaseConfig, cast: RayCast): ChasePose {
  const lift = cast(target, UP, cam.height) ?? cam.height;
  const f = lookDirection(yaw, pitch);
  const desired = { x: target.x - f.x * cam.distance, y: target.y + lift - f.y * cam.distance, z: target.z - f.z * cam.distance };
  const ox = desired.x - target.x;
  const oy = desired.y - target.y;
  const oz = desired.z - target.z;
  const full = Math.hypot(ox, oy, oz);
  const direction = { x: ox / full, y: oy / full, z: oz / full };
  const hit = cast(target, direction, full);
  const blocked = hit !== null;
  const clear = blocked ? Math.max(0, hit) : full;
  const distance = blocked ? Math.max(cam.minDistance, clear) : full;
  const position = add(target, direction, distance);

  const vx = target.x - desired.x;
  const vy = target.y + cam.lookAtHeight - cam.pivotHeight - desired.y;
  const vz = target.z - desired.z;
  const len = Math.hypot(vx, vy, vz);
  const view = { x: vx / len, y: vy / len, z: vz / len };
  return { position, lookAt: add(position, view, 1), distance, direction, view, blocked, clear };
}

/**
 * The chase camera: follows the pivot with a slight lag (followEaseRate), pulls the boom in at once when geometry
 * blocks it and lets it back out slowly (pushOutEaseRate), widens the FOV with speed and rolls during wall-runs.
 * R10: the camera never passes the point where its collision ball touches a surface; when that is closer than
 * minDistance, `courierHidden` turns true.
 */
export class ChaseCamera {
  private follow: Vec3 | null = null;
  private dist = 0;
  private roll = 0;
  private hidden = false;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly cfg: CameraConfig,
    private readonly cast: RayCast,
  ) {
    camera.rotation.order = 'YXZ';
  }

  /** Current boom length (m). */
  get distance(): number {
    return this.dist;
  }

  /** True when the boom is shorter than minDistance (the courier mesh would fill the view). */
  get courierHidden(): boolean {
    return this.hidden;
  }

  /** Jump straight to the next pose instead of easing (teleport, respawn). */
  snap(): void {
    this.follow = null;
  }

  update(frameDt: number, target: Vec3, yaw: number, pitch: number, speed: number, state: PlayerState): void {
    const ch = this.cfg.chase;
    const dt = Math.max(0, frameDt);
    const snapping = this.follow === null;
    const follow = snapping ? { ...target } : this.easeFollow(this.follow!, target, dt, ch);
    this.follow = follow;

    const pose = chaseCameraPose(follow, yaw, pitch, ch, this.cast);
    // Pull in at once, push out slowly; R10: never past the hit, even when that is under minDistance.
    if (snapping || pose.distance <= this.dist) this.dist = pose.distance;
    else this.dist = easeToward(this.dist, pose.distance, dt, ch.pushOutEaseRate);
    if (pose.blocked) this.dist = Math.min(this.dist, pose.clear);

    const p = add(follow, pose.direction, this.dist);
    this.camera.position.set(p.x, p.y, p.z);
    this.hidden = this.dist < ch.minDistance;
    // Roll is clockwise-positive (see rollForWallRun); three's rotation.z is counter-clockwise-positive.
    this.roll = easeToward(this.roll, rollForWallRun(state, this.cfg), dt, this.cfg.rollEaseRate);
    const v = pose.view;
    this.camera.rotation.set(Math.asin(Math.max(-1, Math.min(1, v.y))), Math.atan2(-v.x, -v.z), -this.roll);
    const fov = easeToward(this.camera.fov, fovForSpeed(speed, this.cfg), dt, this.cfg.fovEaseRate);
    if (Math.abs(this.camera.fov - fov) > 1e-4) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Eases the followed pivot toward the courier's pivot, then pulls it back along a cast from the courier's pivot if
   * the lagging point ended up behind geometry (e.g. cutting a corner during a mantle), so the camera never orbits a
   * point inside a wall.
   */
  private easeFollow(prev: Vec3, target: Vec3, dt: number, ch: ChaseConfig): Vec3 {
    const r = ch.followEaseRate;
    const p = { x: easeToward(prev.x, target.x, dt, r), y: easeToward(prev.y, target.y, dt, r), z: easeToward(prev.z, target.z, dt, r) };
    const dx = p.x - target.x;
    const dy = p.y - target.y;
    const dz = p.z - target.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return p;
    const dir = { x: dx / len, y: dy / len, z: dz / len };
    const hit = this.cast(target, dir, len);
    return hit === null ? p : add(target, dir, hit);
  }
}
