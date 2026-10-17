import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import type { MovementConfig } from '../config/types';
import { vec3, type Vec3 } from '../math/vec3';
import type { PhysicsWorld } from '../world/physicsWorld';
import { KinematicMover, type MoveResult, type RayHit } from './kinematicMover';

export { WALL_MAX_NY, type MoveResult, type RayHit } from './kinematicMover';

/** Shrink applied to fitsAt's test capsule so resting contact does not count as overlap. */
const FIT_SKIN = 0.01;
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
  private readonly mover: KinematicMover;
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
    this.mover = new KinematicMover(physics, this.collider, this.body, () => cfg.controller);
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

  /** Moves by `desired` (metres this tick), sliding along obstacles. */
  move(desired: Vec3, snapToGround: boolean): MoveResult {
    const result = this.mover.move(desired, snapToGround, () => ({
      center: vec3(0, -this.halfHeight(this.crouchedNow), 0),
      radius: this.cfg.capsule.radius,
    }));
    this.syncFeet();
    return result;
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

  /**
   * True when a standing capsule slides from feet `from` to feet `to` in a straight line without touching anything
   * but this player and `ignore` (e.g. the vehicle being left): no wall, rail or post stands between them. The test
   * capsule is shrunk by FIT_SKIN like fitsAt's, and only contact the slide moves into counts, so a start already
   * touching something it moves away from is clear.
   */
  pathClear(from: Vec3, to: Vec3, ignore: Collider): boolean {
    const { rapier, world } = this.physics;
    const d = vec3(to.x - from.x, to.y - from.y, to.z - from.z);
    const center = this.centerOf(from, false);
    const hit = world.castShape(
      center,
      { x: 0, y: 0, z: 0, w: 1 },
      d,
      new rapier.Capsule(this.halfHeight(false), this.cfg.capsule.radius - FIT_SKIN),
      0,
      1,
      false,
      undefined,
      undefined,
      this.collider,
      undefined,
      (c) => c.handle !== ignore.handle,
    );
    return hit === null;
  }

  /**
   * The courier's collider is disabled while riding (the vehicle collides instead). Steps the world so scene queries
   * see the change at once.
   */
  setEnabled(on: boolean): void {
    if (this.collider.isEnabled() === on) return;
    this.collider.setEnabled(on);
    this.physics.world.step();
  }

  castRay(from: Vec3, dir: Vec3, maxDist: number): RayHit | null {
    return this.mover.castRay(from, dir, maxDist);
  }
}
