import type * as THREE from 'three';
import type { PlayerState, Vec3 } from '@dm/shared';
import type { ChaseConfig, ClientConfig } from '../clientConfig';
import { easeToward, fovForSpeed, rollForWallRun } from './cameraRig';

type CameraConfig = ClientConfig['camera'];

/** Distance from `from` along the unit vector `dir` to the first solid within `maxDist`, or null when clear. */
export type RayCast = (from: Vec3, dir: Vec3, maxDist: number) => number | null;

export interface ChasePose {
  /** Where the camera goes. */
  position: Vec3;
  /** A point straight ahead of the camera: it always looks along the mouse look direction. */
  lookAt: Vec3;
  /** Boom length from the pivot to `position` (collision-shortened, never below minDistance). */
  distance: number;
  /** Unit vector from the pivot toward the camera. */
  direction: Vec3;
  /** True when geometry blocks the full boom. */
  blocked: boolean;
  /** How far along `direction` the boom is clear: the hit distance, or the full boom length when not blocked. */
  clear: number;
}

/** Unit look direction for yaw and pitch (yaw 0 faces −Z, positive turns left; positive pitch looks up). */
export function lookDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

/** Pivot height above the feet: lower while crouched or sliding, so the boom fits under low ceilings. */
export function pivotHeightFor(state: PlayerState, chase: ChaseConfig): number {
  return state.crouched || state.mode === 'slide' ? chase.crouchPivotHeight : chase.pivotHeight;
}

/**
 * Third-person chase pose (spec §4 "Camera"). `target` is the pivot (feet + pivot height). The desired camera point is
 * target − look(yaw, pitch) × distance + (0, height − pivotHeight, 0); a cast from the target toward it that hits at d
 * shortens the boom to max(minDistance, d − collisionRadius).
 */
export function chaseCameraPose(target: Vec3, yaw: number, pitch: number, cam: ChaseConfig, cast: RayCast): ChasePose {
  const f = lookDirection(yaw, pitch);
  const lift = cam.height - cam.pivotHeight;
  const ox = -f.x * cam.distance;
  const oy = -f.y * cam.distance + lift;
  const oz = -f.z * cam.distance;
  const full = Math.hypot(ox, oy, oz);
  const direction = { x: ox / full, y: oy / full, z: oz / full };
  const hit = cast(target, direction, full);
  const blocked = hit !== null;
  const clear = blocked ? Math.max(0, hit) : full;
  const distance = blocked ? Math.max(cam.minDistance, clear - cam.collisionRadius) : full;
  const position = {
    x: target.x + direction.x * distance,
    y: target.y + direction.y * distance,
    z: target.z + direction.z * distance,
  };
  return { position, lookAt: { x: position.x + f.x, y: position.y + f.y, z: position.z + f.z }, distance, direction, blocked, clear };
}

/**
 * The chase camera: follows the pivot with a slight lag (followEaseRate), shortens the boom quickly when geometry
 * blocks it (pullInEaseRate) and lets it back out slowly (pushOutEaseRate), widens the FOV with speed and rolls
 * during wall-runs. The camera is never placed past a surface the boom ray hits: when the minDistance floor would
 * put it inside geometry (back against a wall), it stops in front of the wall and `courierHidden` turns true.
 */
export class ChaseCamera {
  private follow: Vec3 | null = null;
  private dist = 0;
  private roll = 0;

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

  /** True when the camera had to come closer than minDistance (the courier mesh would fill the view). */
  get courierHidden(): boolean {
    return this.follow !== null && this.dist < this.cfg.chase.minDistance - 1e-6;
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
    if (snapping) this.dist = pose.distance;
    else this.dist = easeToward(this.dist, pose.distance, dt, pose.distance < this.dist ? ch.pullInEaseRate : ch.pushOutEaseRate);
    // Never past the hit: the pull-in ease and the minDistance floor both yield to it (near plane kept clear).
    if (pose.blocked) this.dist = Math.min(this.dist, Math.max(0, pose.clear - this.cfg.near));

    const d = pose.direction;
    this.camera.position.set(follow.x + d.x * this.dist, follow.y + d.y * this.dist, follow.z + d.z * this.dist);
    // Roll is clockwise-positive (see rollForWallRun); three's rotation.z is counter-clockwise-positive.
    this.roll = easeToward(this.roll, rollForWallRun(state, this.cfg), dt, this.cfg.rollEaseRate);
    this.camera.rotation.set(pitch, yaw, -this.roll);
    const fov = easeToward(this.camera.fov, fovForSpeed(speed, this.cfg), dt, this.cfg.fovEaseRate);
    if (Math.abs(this.camera.fov - fov) > 1e-4) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Eases the followed pivot toward the courier's pivot, then pulls it back along a ray from the courier's pivot if
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
    if (hit === null) return p;
    const k = Math.max(0, hit - ch.collisionRadius);
    return { x: target.x + dir.x * k, y: target.y + dir.y * k, z: target.z + dir.z * k };
  }
}
