import { rotationMatrixXYZ, solidSurface, type Solid } from '@dm/shared';

/** Corner k of a unit box: bit 0 → +x, bit 1 → +y, bit 2 → +z. */
const CORNERS = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [k & 1 ? 1 : -1, k & 2 ? 1 : -1, k & 4 ? 1 : -1] as const);
/**
 * The 12 triangles of a box as corner indices, wound so that (b − a) × (c − a) points out of the box (the normal
 * recast tests against the walkable slope): −x, +x, −y, +y, −z, +z faces.
 */
const TRIS = [
  [0, 4, 6], [0, 6, 2],
  [1, 3, 7], [1, 7, 5],
  [0, 1, 5], [0, 5, 4],
  [2, 6, 7], [2, 7, 3],
  [0, 2, 3], [0, 3, 1],
  [4, 5, 7], [4, 7, 6],
] as const;

/**
 * Every solid as a closed box mesh for recast: 8 corners and 12 outward-facing triangles each, rotation honoured.
 * A chute is the exception: grounded on one the courier slides down whatever the input (movement/slide.ts), so it is
 * never walked, up or down. Its up-facing triangles are wound to face down, which recast marks unwalkable whatever the
 * slope; the box still blocks like any solid.
 */
export function solidsToTriangles(solids: readonly Solid[]): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array(solids.length * 8 * 3);
  const indices = new Uint32Array(solids.length * TRIS.length * 3);
  const corner = (n: number, k: number): number[] => [0, 1, 2].map((a) => positions[(n * 8 + k) * 3 + a]!);
  solids.forEach((s, n) => {
    const h = [s.size.x / 2, s.size.y / 2, s.size.z / 2] as const;
    const m = s.rotationDeg ? rotationMatrixXYZ(s.rotationDeg) : null;
    CORNERS.forEach((c, k) => {
      const l = [c[0] * h[0], c[1] * h[1], c[2] * h[2]] as const;
      const w = m ? m.map((row) => row[0] * l[0] + row[1] * l[1] + row[2] * l[2]) : l;
      positions.set([s.center.x + w[0]!, s.center.y + w[1]!, s.center.z + w[2]!], (n * 8 + k) * 3);
    });
    const chute = solidSurface(s) === 'chute';
    TRIS.forEach(([a, b, c], k) => {
      const flip = chute && upFacing(corner(n, a), corner(n, b), corner(n, c));
      indices.set(flip ? [n * 8 + a, n * 8 + c, n * 8 + b] : [n * 8 + a, n * 8 + b, n * 8 + c], (n * TRIS.length + k) * 3);
    });
  });
  return { positions, indices };
}

/** Whether triangle abc's normal (b − a) × (c − a) points up. */
function upFacing(a: number[], b: number[], c: number[]): boolean {
  return (b[2]! - a[2]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[2]! - a[2]!) > 0;
}
