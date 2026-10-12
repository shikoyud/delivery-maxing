import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, World } from '@dimforge/rapier3d-compat';
import type { MapData, Solid, Surface } from './mapTypes';

export type Rapier = typeof RAPIER;

let initPromise: Promise<Rapier> | undefined;

/** Initialises the Rapier WASM module once; later calls share the same promise. */
export function initRapier(): Promise<Rapier> {
  initPromise ??= RAPIER.init().then(() => RAPIER);
  return initPromise;
}

export interface PhysicsWorld {
  rapier: Rapier;
  world: World;
  surfaceOf(c: Collider): Surface;
}

/** Quaternion for an XYZ Euler rotation (degrees), matching three.js 'XYZ' order. */
function eulerXYZ(xDeg: number, yDeg: number, zDeg: number): { x: number; y: number; z: number; w: number } {
  const k = Math.PI / 360;
  const [cx, sx] = [Math.cos(xDeg * k), Math.sin(xDeg * k)];
  const [cy, sy] = [Math.cos(yDeg * k), Math.sin(yDeg * k)];
  const [cz, sz] = [Math.cos(zDeg * k), Math.sin(zDeg * k)];
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}

/** The surface a solid's collider reports: its own, else 'chute' for chute solids, else 'default'. */
export function solidSurface(s: Solid): Surface {
  return s.surface ?? (s.kind === 'chute' ? 'chute' : 'default');
}

/** Adds one fixed cuboid collider (with its own fixed rigid body) for a solid. Removing the body removes the collider. */
export function addSolidCollider(world: World, rapier: Rapier, s: Solid): Collider {
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.fixed().setTranslation(s.center.x, s.center.y, s.center.z),
  );
  const r = s.rotationDeg;
  if (r) body.setRotation(eulerXYZ(r.x, r.y, r.z), false);
  return world.createCollider(rapier.ColliderDesc.cuboid(s.size.x / 2, s.size.y / 2, s.size.z / 2), body);
}

/** Builds a static world with one cuboid per solid. Gravity is zero; the sim applies it itself. */
export function createPhysicsWorld(rapier: Rapier, map: MapData): PhysicsWorld {
  const world = new rapier.World({ x: 0, y: 0, z: 0 });
  const surfaces = new Map<number, Surface>();
  for (const s of map.solids) surfaces.set(addSolidCollider(world, rapier, s).handle, solidSurface(s));
  world.step();
  return { rapier, world, surfaceOf: (c) => surfaces.get(c.handle) ?? 'default' };
}
