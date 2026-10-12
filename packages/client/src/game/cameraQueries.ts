import type { PhysicsWorld, Vec3 } from '@dm/shared';
import type { RayCast } from '../render/chaseCamera';

/**
 * Query filter for camera collision: static map solids only. The courier's capsule is the only kinematic body, so
 * excluding kinematic bodies leaves it out; sensors (trigger volumes) never block the camera.
 */
function cameraFilter(physics: PhysicsWorld): number {
  const f = physics.rapier.QueryFilterFlags;
  return f.EXCLUDE_KINEMATIC | f.EXCLUDE_SENSORS;
}

/** Chase-camera ray cast against the map's solids (distance to the first hit, or null). */
export function physicsRayCast(physics: PhysicsWorld): RayCast {
  const { rapier, world } = physics;
  const flags = cameraFilter(physics);
  return (from, dir, maxDist) => {
    const hit = world.castRay(new rapier.Ray(from, dir), maxDist, true, flags);
    return hit ? hit.timeOfImpact : null;
  };
}

/** Whether `p` lies inside any map solid (the courier's capsule and sensors excluded). */
export function pointInSolid(physics: PhysicsWorld, p: Vec3): boolean {
  let inside = false;
  physics.world.intersectionsWithPoint(
    p,
    () => {
      inside = true;
      return false; // stop at the first one
    },
    cameraFilter(physics),
  );
  return inside;
}
