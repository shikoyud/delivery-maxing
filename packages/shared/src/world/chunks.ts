import type { Vec3 } from '../math/vec3';
import { rotatedHalfExtents } from './pieces';
import type { Rect, Solid } from './mapTypes';

/** `"cx,cz"`: the chunk grid cell containing a point, cell (0,0) covering x, z in [0, size). */
export type ChunkKey = string;

const key = (cx: number, cz: number): ChunkKey => `${cx},${cz}`;

export function chunkOf(x: number, z: number, size: number): ChunkKey {
  return key(Math.floor(x / size), Math.floor(z / size));
}

/** Every chunk the rect touches. A rect ending exactly on a chunk edge does not reach the next chunk. */
export function chunksOverlapping(rect: Rect, size: number): ChunkKey[] {
  const cx0 = Math.floor(rect.minX / size);
  const cz0 = Math.floor(rect.minZ / size);
  const cx1 = Math.max(cx0, Math.ceil(rect.maxX / size) - 1);
  const cz1 = Math.max(cz0, Math.ceil(rect.maxZ / size) - 1);
  const out: ChunkKey[] = [];
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) out.push(key(cx, cz));
  return out;
}

/** Chunks whose square comes within `radius` of `center`, measured horizontally (height is ignored). */
export function chunksWithin(center: Vec3, radius: number, size: number): ChunkKey[] {
  const out: ChunkKey[] = [];
  // The range is inclusive of chunks that merely touch the circle's bounding square (distance == radius counts).
  const cx0 = Math.ceil((center.x - radius) / size) - 1;
  const cx1 = Math.floor((center.x + radius) / size);
  const cz0 = Math.ceil((center.z - radius) / size) - 1;
  const cz1 = Math.floor((center.z + radius) / size);
  for (let cx = cx0; cx <= cx1; cx++) {
    const dx = Math.max(cx * size - center.x, 0, center.x - (cx + 1) * size);
    for (let cz = cz0; cz <= cz1; cz++) {
      const dz = Math.max(cz * size - center.z, 0, center.z - (cz + 1) * size);
      if (Math.hypot(dx, dz) <= radius) out.push(key(cx, cz));
    }
  }
  return out;
}

/** The horizontal AABB of a solid, honouring its XYZ Euler rotation. */
export function solidRect(s: Solid): Rect {
  const h = rotatedHalfExtents({ x: s.size.x / 2, y: s.size.y / 2, z: s.size.z / 2 }, s.rotationDeg);
  return { minX: s.center.x - h.x, minZ: s.center.z - h.z, maxX: s.center.x + h.x, maxZ: s.center.z + h.z };
}
