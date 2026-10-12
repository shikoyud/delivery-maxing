import type { PhysicsWorld, PlayerSim, Vec3 } from '@dm/shared';
import type { RayCast, WallProbe } from '../render/chaseCamera';

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

/** A face counts as a wall when the horizontal share of its normal is at least this (about 45° from vertical). */
const WALL_MIN_HORIZONTAL = 0.7;

/**
 * R12 wall probe: projects `p` onto every solid within `reach` (a ball overlap query) and returns the horizontal unit
 * normal of the nearest near-vertical face, pointing from the face toward `p`. Floors, ceilings, sensors and the
 * courier's own collider (`exclude`) never count.
 */
export function physicsWallProbe(physics: PhysicsWorld, exclude?: Collider): WallProbe {
  const { rapier, world } = physics;
  return (p, reach) => {
    let best: Vec3 | null = null;
    let bestDist = reach;
    world.intersectionsWithShape(
      p,
      IDENTITY,
      new rapier.Ball(reach),
      (collider) => {
        const proj = collider.projectPoint(p, true);
        if (!proj || proj.isInside) return true;
        const dx = p.x - proj.point.x;
        const dy = p.y - proj.point.y;
        const dz = p.z - proj.point.z;
        const dist = Math.hypot(dx, dy, dz);
        const h = Math.hypot(dx, dz);
        if (dist < 1e-6 || dist > bestDist || h < WALL_MIN_HORIZONTAL * dist) return true;
        best = { x: dx / h, y: 0, z: dz / h };
        bestDist = dist;
        return true;
      },
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      exclude,
    );
    return best;
  };
}
