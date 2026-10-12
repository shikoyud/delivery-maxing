import type { PhysicsWorld, PlayerSim, Vec3 } from '@dm/shared';
import type { RayCast } from '../render/chaseCamera';

/** A Rapier collider (the client has no direct Rapier dependency). */
type Collider = PlayerSim['body']['collider'];

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Chase-camera collision as a sphere cast against the map: how far the centre of a ball of `radius` travels along the
 * unit vector `dir` before the ball touches a solid (null when it travels `maxDist` freely). `exclude` is the
 * courier's own collider; sensors (trigger volumes) never block the camera. A ball already touching a surface and
 * moving away from it is not stopped (stopAtPenetration false), so a camera resting against a wall can still move off it.
 */
export function physicsSphereCast(physics: PhysicsWorld, radius: number, exclude?: Collider): RayCast {
  const { rapier, world } = physics;
  const ball = new rapier.Ball(radius);
  const flags = rapier.QueryFilterFlags.EXCLUDE_SENSORS;
  return (from, dir, maxDist) => {
    const hit = world.castShape(from, IDENTITY, dir, ball, 0, maxDist, false, flags, undefined, exclude);
    return hit ? hit.time_of_impact : null;
  };
}

/** Whether a ball of `radius` at `center` overlaps any map solid (`exclude`: the courier's collider; sensors ignored). */
export function ballInSolid(physics: PhysicsWorld, center: Vec3, radius: number, exclude?: Collider): boolean {
  const { rapier, world } = physics;
  let inside = false;
  world.intersectionsWithShape(
    center,
    IDENTITY,
    new rapier.Ball(radius),
    () => {
      inside = true;
      return false; // stop at the first one
    },
    rapier.QueryFilterFlags.EXCLUDE_SENSORS,
    undefined,
    exclude,
  );
  return inside;
}
