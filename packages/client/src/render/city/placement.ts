import type { CatalogEntry, Facing, FrontAxis, Lot, Vec3 } from '@dm/shared';

/** Angle of a model axis about +y from +z, in three's convention (rotY a maps +z to (sin a, 0, cos a)). */
const AXIS_ANGLE: Record<FrontAxis, number> = { '+z': 0, '+x': Math.PI / 2, '-z': Math.PI, '-x': -Math.PI / 2 };

/**
 * The world direction a lot's front looks along: the side of its rect the door is on (the generator's lotRect and
 * door placement): S its minZ edge (−z), N +z, E +x, W −x.
 */
const FACING_ANGLE: Record<Facing, number> = { N: 0, E: Math.PI / 2, S: Math.PI, W: -Math.PI / 2 };

/** Wraps an angle into (−π, π]. */
function wrap(a: number): number {
  const t = Math.atan2(Math.sin(a), Math.cos(a));
  return Math.abs(t + Math.PI) < 1e-12 ? Math.PI : t;
}

/** The yaw that turns a model whose front is `front` so the front looks along `facing`. */
export function frontYaw(front: FrontAxis, facing: Facing): number {
  return wrap(FACING_ANGLE[facing] - AXIS_ANGLE[front]);
}

/**
 * Places `entry`'s model on a ground point: turned by `frontYaw(entry.front ?? '+z', facing)` (Decision 17: +z by
 * default), then moved so its bounding-box centre (the catalog `pivot`'s x and z, turned with it) lands on `at`'s x
 * and z, and its lowest point (`pivot.minY`) on `at.y`.
 */
export function placeModel(entry: CatalogEntry, facing: Facing, at: Vec3): { position: Vec3; rotY: number } {
  const rotY = frontYaw(entry.front ?? '+z', facing);
  const p = entry.pivot ?? { x: 0, z: 0, minY: 0 };
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  // the pivot after the turn: (x, z) → (x cos + z sin, −x sin + z cos)
  const px = p.x * c + p.z * s;
  const pz = -p.x * s + p.z * c;
  return { position: { x: at.x - px + 0, y: at.y - p.minY + 0, z: at.z - pz + 0 }, rotY };
}

/**
 * Where a lot's model goes (city design §7.2: swapping never moves a lot): placed (placeModel) on the lot rect's
 * centre at `lot.y`, its front toward `lot.facing`. A model that grew past its lot is still placed by the catalog and
 * may poke out (Review Focus 2).
 */
export function lotTransform(lot: Lot, entry: CatalogEntry): { position: Vec3; rotY: number } {
  const r = lot.rect;
  return placeModel(entry, lot.facing, { x: (r.minX + r.maxX) / 2, y: lot.y, z: (r.minZ + r.maxZ) / 2 });
}
