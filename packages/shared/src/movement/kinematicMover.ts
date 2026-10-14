import type { Collider, KinematicCharacterController, RigidBody } from '@dimforge/rapier3d-compat';
import { vec3, type Vec3 } from '../math/vec3';
import type { PhysicsWorld } from '../world/physicsWorld';

export interface MoveResult {
  grounded: boolean;
  groundNormal: Vec3;
  /** Collision normals (pointing out of the obstacle) with |n.y| < WALL_MAX_NY. */
  wallNormals: Vec3[];
  /** Collision normals with n.y < -WALL_MAX_NY (ceilings). */
  ceilingNormals: Vec3[];
  /**
   * Collision normals with WALL_MAX_NY <= n.y < cos(maxSlopeClimbDeg): too steep to climb, yet not walls (a step
   * edge or curb met by the capsule's round bottom). Vehicles are blocked by these; the courier ignores them.
   */
  steepNormals: Vec3[];
  /** The translation the controller actually applied. */
  movement: Vec3;
}

export interface RayHit {
  point: Vec3;
  normal: Vec3;
  distance: number;
}

/** Character-controller tuning, re-read on every move (movement.json `controller`, or a ride's own values). */
export interface MoverSettings {
  offset: number;
  maxStepHeight: number;
  minStepWidth: number;
  snapToGround: number;
  maxSlopeClimbDeg: number;
  minSlopeSlideDeg: number;
}

/**
 * The collider's bottom sphere: `center` relative to the rigid body's translation, and its radius. The feet are
 * `radius + offset` below that centre (the capsule bottom floats `offset` above the ground contact point).
 */
export interface BottomSphere {
  center: Vec3;
  radius: number;
}

/** Faces with |n.y| below this count as walls (wall contacts and mantle probes). */
export const WALL_MAX_NY = 0.3;

const DEG = Math.PI / 180;
const UP = { x: 0, y: 1, z: 0 };
/** How far above the feet the ground probe starts, and how far below them it may reach. */
export const GROUND_PROBE_LIFT = 0.1;
export const GROUND_PROBE_REACH = 0.1;
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
export const CAST_GAP_FRACTION = 0.5;

/**
 * Moves a kinematic rigid body with Rapier's character controller (collide-and-slide, autostep, snap to ground),
 * keeps it `offset` above walkable ground (skinDeficit) and probes the ground normal under the feet. Shared by the
 * courier's PlayerBody and every VehicleBody; each move steps the physics world once.
 */
export class KinematicMover {
  private readonly physics: PhysicsWorld;
  private readonly collider: Collider;
  private readonly body: RigidBody;
  private readonly settings: () => MoverSettings;
  private readonly controller: KinematicCharacterController;

  constructor(physics: PhysicsWorld, collider: Collider, body: RigidBody, settings: () => MoverSettings) {
    this.physics = physics;
    this.collider = collider;
    this.body = body;
    this.settings = settings;
    this.controller = physics.world.createCharacterController(settings().offset * CAST_GAP_FRACTION);
    this.controller.setUp(UP);
  }

  /** Re-reads the settings so dev-panel edits apply on the next move. */
  private configureController(snapToGround: boolean): void {
    const k = this.settings();
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

  /** Moves by `desired` (metres this tick), sliding along obstacles, then steps the world. */
  move(desired: Vec3, snapToGround: boolean, bottomSphere: () => BottomSphere): MoveResult {
    this.configureController(snapToGround);
    const collider = this.collider;
    this.controller.computeColliderMovement(collider, desired, undefined, undefined, (c) => c !== collider);
    const m = this.controller.computedMovement();
    const grounded = this.controller.computedGrounded();
    const wallNormals: Vec3[] = [];
    const ceilingNormals: Vec3[] = [];
    const steepNormals: Vec3[] = [];
    const minWalkableNy = Math.cos(this.settings().maxSlopeClimbDeg * DEG);
    const n = this.controller.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const hit = this.controller.computedCollision(i);
      if (!hit) continue;
      const nn = vec3(hit.normal1.x, hit.normal1.y, hit.normal1.z);
      if (Math.abs(nn.y) < WALL_MAX_NY) wallNormals.push(nn);
      else if (nn.y < -WALL_MAX_NY) ceilingNormals.push(nn);
      else if (nn.y > 0 && nn.y < minWalkableNy) steepNormals.push(nn);
    }
    const t = this.body.translation();
    const lift = desired.y <= 0 ? this.skinDeficit(vec3(t.x + m.x, t.y + m.y, t.z + m.z), bottomSphere()) : 0;
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y + lift, z: t.z + m.z });
    this.physics.world.step();

    let groundNormal = vec3(0, 1, 0);
    if (grounded) {
      const feet = this.feetAfterMove(bottomSphere());
      const probe = this.rayHit(
        vec3(feet.x, feet.y + GROUND_PROBE_LIFT, feet.z),
        vec3(0, -1, 0),
        GROUND_PROBE_LIFT + GROUND_PROBE_REACH,
      );
      if (probe) groundNormal = probe.hit.normal;
    }
    return { grounded, groundNormal, wallNormals, ceilingNormals, steepNormals, movement: vec3(m.x, m.y, m.z) };
  }

  /** Feet under the body's current translation: `radius + offset` below the bottom sphere's centre. */
  private feetAfterMove(sphere: BottomSphere): Vec3 {
    const t = this.body.translation();
    return vec3(t.x, t.y - (this.settings().offset + -sphere.center.y + sphere.radius), t.z);
  }

  /**
   * How far the body with its translation at `center` must rise to restore the offset gap above walkable ground
   * below its bottom sphere (0 when the gap is intact or there is no walkable ground under it).
   *
   * Rapier's shape casts against a large cuboid are off by centimetres (up to ~5 cm on the 600 m ground slab), so
   * the controller can leave the capsule inside its own offset gap, or inside the slab; the next moves then start
   * in contact and stall. A ray cast is exact, so the gap is measured with rays from the bottom sphere's centre:
   * straight down to find the walkable face below, then along that face's -normal, which is the sphere's true
   * distance to the face only when the foot of that perpendicular lies on the face. Near a convex edge (a flat top
   * running into a ramp going down) it does not: the ramp's plane is closer than the edge the sphere rests on, and
   * lifting to that plane would launch the body off the crest. So the gap counts only when the -normal ray meets
   * the same plane (within FACE_MATCH), and the correction is bounded by the sphere radius, so it only ever
   * settles a shallow sink.
   */
  private skinDeficit(center: Vec3, bottom: BottomSphere): number {
    const { radius } = bottom;
    const { offset, maxSlopeClimbDeg } = this.settings();
    const minNy = Math.cos(maxSlopeClimbDeg * DEG);
    const o = bottom.center;
    const sphere = vec3(center.x + o.x, center.y + o.y, center.z + o.z);
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

  /** Ray cast that ignores this mover's own collider. */
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

  /** Removes the character controller (the caller removes its own body and collider). */
  destroy(): void {
    this.physics.world.removeCharacterController(this.controller);
  }
}
