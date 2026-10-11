import type { Collider, KinematicCharacterController, RigidBody } from '@dimforge/rapier3d-compat';
import type { MovementConfig } from '../config/types';
import { vec3, type Vec3 } from '../math/vec3';
import type { Surface } from '../world/mapTypes';
import type { PhysicsWorld } from '../world/physicsWorld';

export interface MoveResult {
  grounded: boolean;
  groundNormal: Vec3;
  groundSurface: Surface;
  /** Collision normals (pointing out of the obstacle) with |n.y| < 0.3. */
  wallNormals: Vec3[];
  /** Collision normals with n.y < -0.3 (ceilings). */
  ceilingNormals: Vec3[];
  /** The translation the controller actually applied. */
  movement: Vec3;
}

export interface RayHit {
  point: Vec3;
  normal: Vec3;
  distance: number;
}

const DEG = Math.PI / 180;
const UP = { x: 0, y: 1, z: 0 };
/** How far above the feet the ground probe starts, and how far below them it may reach. */
const GROUND_PROBE_LIFT = 0.1;
const GROUND_PROBE_REACH = 0.1;
/** Shrink applied to fitsAt's test capsule so resting contact does not count as overlap. */
const FIT_SKIN = 0.01;

/**
 * Kinematic capsule driven by Rapier's character controller. Positions are feet: standing on a surface, the
 * feet are on it (the capsule bottom sits `controller.offset` above them).
 */
export class PlayerBody {
  private readonly physics: PhysicsWorld;
  private readonly cfg: MovementConfig;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private crouchedNow = false;
  private feetPos: Vec3;

  constructor(physics: PhysicsWorld, cfg: MovementConfig, feet: Vec3) {
    this.physics = physics;
    this.cfg = cfg;
    this.feetPos = vec3(feet.x, feet.y, feet.z);
    const { rapier, world } = physics;
    const c = this.centerOf(feet, false);
    this.body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, c.y, c.z));
    this.collider = world.createCollider(
      rapier.ColliderDesc.capsule(this.halfHeight(false), cfg.capsule.radius),
      this.body,
    );
    this.controller = world.createCharacterController(cfg.controller.offset);
    this.controller.setUp(UP);
    world.step();
  }

  get feet(): Vec3 {
    return vec3(this.feetPos.x, this.feetPos.y, this.feetPos.z);
  }

  get crouched(): boolean {
    return this.crouchedNow;
  }

  private halfHeight(crouched: boolean): number {
    const { radius, height, crouchHeight } = this.cfg.capsule;
    return ((crouched ? crouchHeight : height) - 2 * radius) / 2;
  }

  /** Capsule centre for feet at `feet`. The capsule floats `controller.offset` above the feet: that is the gap the
   * controller keeps to the ground, and a capsule placed closer than that would be allowed to sink through. */
  private centerOf(feet: Vec3, crouched: boolean): Vec3 {
    return vec3(feet.x, feet.y + this.cfg.controller.offset + this.halfHeight(crouched) + this.cfg.capsule.radius, feet.z);
  }

  /** Re-reads controller tuning from cfg so dev-panel edits apply on the next move. */
  private configureController(snapToGround: boolean): void {
    const k = this.cfg.controller;
    this.controller.setOffset(k.offset);
    this.controller.enableAutostep(k.maxStepHeight, k.minStepWidth, false);
    this.controller.setMaxSlopeClimbAngle(k.maxSlopeClimbDeg * DEG);
    this.controller.setMinSlopeSlideAngle(k.minSlopeSlideDeg * DEG);
    if (snapToGround) this.controller.enableSnapToGround(k.snapToGround);
    else this.controller.disableSnapToGround();
  }

  /** Moves by `desired` (metres this tick), sliding along obstacles. */
  move(desired: Vec3, snapToGround: boolean): MoveResult {
    this.configureController(snapToGround);
    const collider = this.collider;
    this.controller.computeColliderMovement(collider, desired, undefined, undefined, (c) => c !== collider);
    const m = this.controller.computedMovement();
    const grounded = this.controller.computedGrounded();
    const wallNormals: Vec3[] = [];
    const ceilingNormals: Vec3[] = [];
    const n = this.controller.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const hit = this.controller.computedCollision(i);
      if (!hit) continue;
      const nn = vec3(hit.normal1.x, hit.normal1.y, hit.normal1.z);
      if (Math.abs(nn.y) < 0.3) wallNormals.push(nn);
      else if (nn.y < -0.3) ceilingNormals.push(nn);
    }
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    this.physics.world.step();
    this.syncFeet();

    let groundNormal = vec3(0, 1, 0);
    let groundSurface: Surface = 'default';
    if (grounded) {
      const probe = this.rayHit(
        vec3(this.feetPos.x, this.feetPos.y + GROUND_PROBE_LIFT, this.feetPos.z),
        vec3(0, -1, 0),
        GROUND_PROBE_LIFT + GROUND_PROBE_REACH,
      );
      if (probe) {
        groundNormal = probe.hit.normal;
        groundSurface = this.physics.surfaceOf(probe.collider);
      }
    }
    return { grounded, groundNormal, groundSurface, wallNormals, ceilingNormals, movement: vec3(m.x, m.y, m.z) };
  }

  private syncFeet(): void {
    const t = this.body.translation();
    const c = this.centerOf(vec3(0, 0, 0), this.crouchedNow).y;
    this.feetPos = vec3(t.x, t.y - c, t.z);
  }

  /** Places the feet at `p` immediately. */
  setFeet(p: Vec3): void {
    const c = this.centerOf(p, this.crouchedNow);
    this.body.setTranslation(c, true);
    this.body.setNextKinematicTranslation(c);
    this.physics.world.step();
    this.feetPos = vec3(p.x, p.y, p.z);
  }

  /** Resizes the capsule, keeping the feet planted. Returns false (and stays crouched) if standing is blocked. */
  setCrouched(c: boolean): boolean {
    if (c === this.crouchedNow) return true;
    if (!c && !this.fitsAt(this.feetPos, false)) return false;
    this.crouchedNow = c;
    this.collider.setHalfHeight(this.halfHeight(c));
    this.setFeet(this.feetPos);
    return true;
  }

  /** True when a capsule (standing or crouched) with its feet at `feet` overlaps nothing but this player. */
  fitsAt(feet: Vec3, crouched: boolean): boolean {
    const { rapier, world } = this.physics;
    const r = this.cfg.capsule.radius - FIT_SKIN;
    const hh = this.halfHeight(crouched);
    const center = vec3(feet.x, this.centerOf(feet, crouched).y, feet.z);
    const hit = world.intersectionWithShape(
      center,
      { x: 0, y: 0, z: 0, w: 1 },
      new rapier.Capsule(hh, r),
      undefined,
      undefined,
      this.collider,
    );
    return hit === null;
  }

  castRay(from: Vec3, dir: Vec3, maxDist: number): RayHit | null {
    return this.rayHit(from, dir, maxDist)?.hit ?? null;
  }

  private rayHit(from: Vec3, dir: Vec3, maxDist: number): { hit: RayHit; collider: Collider } | null {
    const { rapier, world } = this.physics;
    const res = world.castRayAndGetNormal(new rapier.Ray(from, dir), maxDist, true, undefined, undefined, this.collider);
    if (!res) return null;
    const d = res.timeOfImpact;
    return {
      hit: {
        point: vec3(from.x + dir.x * d, from.y + dir.y * d, from.z + dir.z * d),
        normal: vec3(res.normal.x, res.normal.y, res.normal.z),
        distance: d,
      },
      collider: res.collider,
    };
  }
}
