import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, World } from '@dimforge/rapier3d-compat';
import type { Vec3 } from '../math/vec3';
import type { MapData, Solid } from './mapTypes';

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
  /**
   * Present on a paged world (createPagedPhysicsWorld): the client calls it with the player position before every
   * sim step and after a teleport or respawn. Absent on a plain world, where every solid always has a collider.
   */
  update?(center: Vec3): boolean;
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

/** Adds one fixed cuboid collider (on its own fixed body) for a solid; returns the collider. */
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
  for (const s of map.solids) addSolidCollider(world, rapier, s);
  world.step();
  return { rapier, world };
}
