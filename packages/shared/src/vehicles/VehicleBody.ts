import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import { movementConfig } from '../config';
import type { RideSpec } from '../config/types';
import { vec3, type Vec3 } from '../math/vec3';
import { KinematicMover, type BottomSphere, type MoveResult, type MoverSettings } from '../movement/kinematicMover';
import type { PhysicsWorld } from '../world/physicsWorld';

/** Shrink applied to fitsAt's test capsule so resting contact does not count as overlap. */
const FIT_SKIN = 0.01;

type Quat = { x: number; y: number; z: number; w: number };

/**
 * Collider rotation for a heading (yaw, see movement/ground.ts facing). Rapier capsules lie along Y: an upright
 * capsule is only yawed; a lengthwise one is first turned 90° about X (axis along Z), then yawed, so its axis runs
 * along the heading.
 */
function rotationFor(shape: RideSpec['collider']['shape'], heading: number): Quat {
  const sy = Math.sin(heading / 2);
  const cy = Math.cos(heading / 2);
  if (shape === 'upright') return { x: 0, y: sy, z: 0, w: cy };
  const h = Math.SQRT1_2; // sin and cos of 45°
  // yaw(heading) * rotX(90°)
  return { x: cy * h, y: h * sy, z: -sy * h, w: cy * h };
}

/**
 * A ride's kinematic capsule, moved by the shared KinematicMover. `upright` (skateboard, bicycle) is a standing
 * capsule of collider.height; `lengthwise` (motorbike, car) is a capsule of half-length collider.halfLength lying
 * along the heading, its axis `radius` above the bottom. Feet = capsule bottom − controller.offset, as for the
 * courier. The controller's step height and slope limit come from the ride; offset, step width, snap distance and
 * slide angle from movement.json `controller`.
 */
export class VehicleBody {
  private readonly physics: PhysicsWorld;
  private readonly spec: RideSpec;
  private readonly body: RigidBody;
  readonly collider: Collider;
  private readonly mover: KinematicMover;
  private feetPos: Vec3;
  private headingNow: number;

  constructor(physics: PhysicsWorld, spec: RideSpec, feet: Vec3, heading: number) {
    this.physics = physics;
    this.spec = spec;
    this.feetPos = vec3(feet.x, feet.y, feet.z);
    this.headingNow = heading;
    const { rapier, world } = physics;
    const c = this.centerOf(feet);
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, c.y, c.z).setRotation(rotationFor(spec.collider.shape, heading)),
    );
    this.collider = world.createCollider(rapier.ColliderDesc.capsule(this.halfHeight(), spec.collider.radius), this.body);
    this.mover = new KinematicMover(physics, this.collider, this.body, () => this.settings());
    world.step();
  }

  get feet(): Vec3 {
    return vec3(this.feetPos.x, this.feetPos.y, this.feetPos.z);
  }

  get heading(): number {
    return this.headingNow;
  }

  private settings(): MoverSettings {
    const k = movementConfig.controller;
    return {
      offset: k.offset,
      maxStepHeight: this.spec.maxStepHeight,
      minStepWidth: k.minStepWidth,
      snapToGround: k.snapToGround,
      maxSlopeClimbDeg: this.spec.maxSlopeClimbDeg,
      minSlopeSlideDeg: k.minSlopeSlideDeg,
    };
  }

  /** Rapier half height of the capsule's segment. */
  private halfHeight(): number {
    const { shape, radius, height, halfLength } = this.spec.collider;
    return shape === 'upright' ? (height - 2 * radius) / 2 : halfLength;
  }

  /** Height of the capsule centre above the feet. */
  private centerLift(): number {
    const { shape, radius } = this.spec.collider;
    const offset = movementConfig.controller.offset;
    return shape === 'upright' ? offset + this.halfHeight() + radius : offset + radius;
  }

  private centerOf(feet: Vec3): Vec3 {
    return vec3(feet.x, feet.y + this.centerLift(), feet.z);
  }

  /** The bottom sphere relative to the capsule centre; a lengthwise capsule's is centred on its axis. */
  private bottomSphere(): BottomSphere {
    const { shape, radius } = this.spec.collider;
    return { center: vec3(0, shape === 'upright' ? -this.halfHeight() : 0, 0), radius };
  }

  /** Moves by `desired` (metres this tick), sliding along obstacles. */
  move(desired: Vec3, snap: boolean): MoveResult {
    const result = this.mover.move(desired, snap, () => this.bottomSphere());
    const t = this.body.translation();
    this.feetPos = vec3(t.x, t.y - this.centerLift(), t.z);
    return result;
  }

  /** Turns to `heading` when the turned capsule overlaps nothing; otherwise the heading stays. Returns success. */
  tryTurn(heading: number): boolean {
    if (heading === this.headingNow) return true;
    if (this.spec.collider.shape === 'lengthwise' && !this.fitsAt(this.feetPos, heading)) return false;
    this.headingNow = heading;
    this.body.setRotation(rotationFor(this.spec.collider.shape, heading), true);
    this.body.setNextKinematicRotation(rotationFor(this.spec.collider.shape, heading));
    return true;
  }

  /** Places the vehicle at `feet` facing `heading` immediately (no collision check; see fitsAt). */
  place(feet: Vec3, heading: number): void {
    const c = this.centerOf(feet);
    const q = rotationFor(this.spec.collider.shape, heading);
    this.body.setTranslation(c, true);
    this.body.setRotation(q, true);
    this.body.setNextKinematicTranslation(c);
    this.body.setNextKinematicRotation(q);
    this.physics.world.step();
    this.feetPos = vec3(feet.x, feet.y, feet.z);
    this.headingNow = heading;
  }

  /**
   * True when this vehicle's capsule with its feet at `feet` facing `heading` overlaps nothing but itself. The test
   * capsule's radius is shrunk by FIT_SKIN so resting on the ground or touching a wall is not an overlap.
   */
  fitsAt(feet: Vec3, heading: number): boolean {
    const { rapier, world } = this.physics;
    const hit = world.intersectionWithShape(
      this.centerOf(feet),
      rotationFor(this.spec.collider.shape, heading),
      new rapier.Capsule(this.halfHeight(), this.spec.collider.radius - FIT_SKIN),
      undefined,
      undefined,
      this.collider,
    );
    return hit === null;
  }

  /** A parked vehicle collides; a disabled one (e.g. the carried skateboard) does not. */
  setEnabled(on: boolean): void {
    this.collider.setEnabled(on);
  }

  destroy(): void {
    this.mover.destroy();
    this.physics.world.removeRigidBody(this.body);
  }
}
