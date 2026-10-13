import { WALL_MAX_NY, type LineOfSight, type PhysicsWorld, type PlayerSim, type Vec3 } from '@dm/shared';
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

/**
 * R12 wall probe: projects `p` onto every solid within `reach` (a ball overlap query) and returns the nearest face that
 * counts as a wall — its horizontal unit normal, pointing from the face toward `p`, and its distance. Walls are
 * classified exactly as the movement sim classifies them (|n.y| < WALL_MAX_NY, a geometry rule, not a camera tuning
 * value). Floors, ceilings, sensors and the courier's own collider (`exclude`) never count. The query ball is built
 * once and rebuilt only when the reach changes (a dev-panel edit).
 */
export function physicsWallProbe(physics: PhysicsWorld, exclude?: Collider): WallProbe {
  const { rapier, world } = physics;
  let ball = new rapier.Ball(1);
  let ballRadius = 1;
  return (p, reach) => {
    if (reach !== ballRadius) {
      ball = new rapier.Ball(reach);
      ballRadius = reach;
    }
    let best: { normal: Vec3; distance: number } | null = null;
    world.intersectionsWithShape(
      p,
      IDENTITY,
      ball,
      (collider) => {
        const proj = collider.projectPoint(p, true);
        if (!proj || proj.isInside) return true;
        const dx = p.x - proj.point.x;
        const dy = p.y - proj.point.y;
        const dz = p.z - proj.point.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 1e-6 || dist > reach || (best && dist >= best.distance)) return true;
        if (Math.abs(dy / dist) >= WALL_MAX_NY) return true;
        const h = Math.hypot(dx, dz);
        best = { normal: { x: dx / h, y: 0, z: dz / h }, distance: dist };
        return true;
      },
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      exclude,
    );
    return best;
  };
}

/**
 * Line of sight for the thieves (spec §7.3): a ray from `from` (a thief's eye) to `to` (the courier's chest) against the
 * map's solids; blocked when it hits one before reaching `to`. `exclude` is the courier's own collider, so its capsule
 * never hides it; sensors never block. On the city the colliders are paged around the courier, which covers the thieves'
 * trigger radius.
 */
export function physicsLineOfSight(physics: PhysicsWorld, exclude?: Collider): LineOfSight {
  const { rapier, world } = physics;
  const ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  return (from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) return true;
    ray.origin = { x: from.x, y: from.y, z: from.z };
    ray.dir = { x: dx / d, y: dy / d, z: dz / d };
    return world.castRay(ray, d, true, rapier.QueryFilterFlags.EXCLUDE_SENSORS, undefined, exclude) === null;
  };
}
