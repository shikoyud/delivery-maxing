import type { Collider, KinematicCharacterController, RigidBody } from '@dimforge/rapier3d-compat';
import type { MovementConfig } from '../config/types';
import { vec3, type Vec3 } from '../math/vec3';
import type { Surface } from '../world/mapTypes';
import type { PhysicsWorld } from '../world/physicsWorld';

export interface MoveResult {
  grounded: boolean;
  groundNormal: Vec3;
  groundSurface: Surface;
  /** Collision normals (pointing out of the obstacle) with |n.y| < WALL_MAX_NY. */
  wallNormals: Vec3[];
  /** Collision normals with n.y < -WALL_MAX_NY (ceilings). */
  ceilingNormals: Vec3[];
  /** The translation the controller actually applied. */
  movement: Vec3;
}

export interface RayHit {
  point: Vec3;
  normal: Vec3;
  distance: number;
}

/** Faces with |n.y| below this count as walls (wall contacts, mantle and wall-run probes). */
export const WALL_MAX_NY = 0.3;

const DEG = Math.PI / 180;
const UP = { x: 0, y: 1, z: 0 };
/** How far above the feet the ground probe starts, and how far below them it may reach. */
const GROUND_PROBE_LIFT = 0.1;
const GROUND_PROBE_REACH = 0.1;
/** Shrink applied to fitsAt's test capsule so resting contact does not count as overlap. */
const FIT_SKIN = 0.01;
/** A ground gap this much under controller.offset is left alone (float noise, not a sink). */
const SKIN_TOLERANCE = 1e-4;
/** skinDeficit's -normal ray must meet the face within this of its plane distance (m). */
const FACE_MATCH = 1e-3;
/**
 * Rapier's controller is given this fraction of controller.offset as its own gap, while the body rests a full
 * controller.offset above the ground (skinDeficit restores it after every move). A capsule resting exactly at the
 * controller's gap makes every horizontal cast graze the ground: Rapier reports a contact at distance 0 whose normal
 * is noise, and the slide along it hops the capsule up by centimetres and pushes it sideways. Resting half the gap
 * further out keeps those casts clear of the ground (a slab's cast error is under 5 mm at that distance).
 */
const CAST_GAP_FRACTION = 0.5;

/**
 * Kinematic capsule driven by Rapier's character controller. Positions are feet = capsule bottom −
 * controller.offset, which is (about) the ground contact point: standing on a surface, the feet are on it and
 * the capsule bottom floats `controller.offset` above them. Standing and crouched capsules share the same feet,
 * so a crouched capsule's top is at feet + offset + crouchHeight.
 */
export class PlayerBody {
  private readonly physics: PhysicsWorld;
  private readonly cfg: MovementConfig;
  private readonly body: RigidBody;
  /** The courier's own collider (camera queries exclude it). */
  readonly collider: Collider;
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
    this.controller = world.createCharacterController(cfg.controller.offset * CAST_GAP_FRACTION);
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
    this.controller.setOffset(k.offset * CAST_GAP_FRACTION);
    this.controller.enableAutostep(k.maxStepHeight, k.minStepWidth, false);
    this.controller.setMaxSlopeClimbAngle(k.maxSlopeClimbDeg * DEG);
    this.controller.setMinSlopeSlideAngle(k.minSlopeSlideDeg * DEG);
    // Rapier snaps down to its own (smaller) gap, so the snap reaches further by the gap difference, measured
    // vertically on the steepest walkable slope: the feet follow drops of up to snapToGround, as before.
    const gapDiff = (k.offset * (1 - CAST_GAP_FRACTION)) / Math.cos(k.maxSlopeClimbDeg * DEG);
    if (snapToGround) this.controller.enableSnapToGround(k.snapToGround + gapDiff);
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
      if (Math.abs(nn.y) < WALL_MAX_NY) wallNormals.push(nn);
      else if (nn.y < -WALL_MAX_NY) ceilingNormals.push(nn);
    }
    const t = this.body.translation();
    const lift = desired.y <= 0 ? this.skinDeficit(vec3(t.x + m.x, t.y + m.y, t.z + m.z)) : 0;
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y + lift, z: t.z + m.z });
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

  /**
   * How far the capsule centred at `center` must rise to restore the controller.offset gap above walkable ground
   * below it (0 when the gap is intact or there is no walkable ground under it).
   *
   * Rapier's shape casts against a large cuboid are off by centimetres (up to ~5 cm on the 600 m ground slab), so
   * the controller can leave the capsule inside its own offset gap, or inside the slab; the next moves then start
   * in contact and stall. A ray cast is exact, so the gap is measured with rays from the bottom sphere's centre:
   * straight down to find the walkable face below, then along that face's -normal, which is the sphere's true
   * distance to the face only when the foot of that perpendicular lies on the face. Near a convex edge (a flat top
   * running into a ramp going down) it does not: the ramp's plane is closer than the edge the sphere rests on, and
   * lifting to that plane would launch the player off the crest. So the gap counts only when the -normal ray meets
   * the same plane (within FACE_MATCH), and the correction is bounded by the capsule radius, so it only ever
   * settles a shallow sink.
   */
  private skinDeficit(center: Vec3): number {
    const { radius } = this.cfg.capsule;
    const { offset, maxSlopeClimbDeg } = this.cfg.controller;
    const minNy = Math.cos(maxSlopeClimbDeg * DEG);
    const sphere = vec3(center.x, center.y - this.halfHeight(this.crouchedNow), center.z);
    // Straight down to a walkable face: (r + gap) / n.y, so the reach covers the steepest climbable slope.
    const down = this.rayHit(sphere, vec3(0, -1, 0), (radius + offset) / minNy + GROUND_PROBE_REACH);
    if (!down) return 0;
    const n = down.hit.normal;
    if (n.y < minNy) return 0;
    const planeDist = down.hit.distance * n.y;
    const along = this.rayHit(sphere, vec3(-n.x, -n.y, -n.z), planeDist + FACE_MATCH);
    if (!along || Math.abs(along.hit.distance - planeDist) > FACE_MATCH) return 0;
    const gap = planeDist - radius;
    if (gap >= offset - SKIN_TOLERANCE) return 0;
    return Math.min((offset - gap) / n.y, radius);
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

  /**
   * Resizes the capsule (setHalfHeight), keeping the feet planted. Crouching always succeeds. Standing first checks
   * that a standing capsule fits at the current feet (top at feet + offset + height); if not, it returns false
   * and the body stays crouched, so a low ceiling never ends up inside the capsule.
   */
  setCrouched(c: boolean): boolean {
    if (c === this.crouchedNow) return true;
    if (!c && !this.fitsAt(this.feetPos, false)) return false;
    this.crouchedNow = c;
    this.collider.setHalfHeight(this.halfHeight(c));
    this.setFeet(this.feetPos);
    return true;
  }

  /**
   * True when a capsule (standing or crouched) with its feet at `feet` (capsule bottom at feet + controller.offset)
   * overlaps nothing but this player. The test capsule's radius is shrunk by FIT_SKIN so resting on the ground
   * or touching a wall is not an overlap.
   */
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
