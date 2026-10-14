import type { Solid } from '@dm/shared';

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

/** Row-major rotation matrix for an XYZ Euler in degrees, matching three.js 'XYZ' order (R = Rx·Ry·Rz). */
export function rotationMatrixXYZ(r: { x: number; y: number; z: number }): number[][] {
  const [a, b, c] = [r.x, r.y, r.z].map((d) => (d * Math.PI) / 180) as [number, number, number];
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
  ];
}

/** Solid kinds whose tops nobody walks or drives on: building and hospital roofs (no parkour, spec rev. 2). */
const ROOFED: ReadonlySet<Solid['kind']> = new Set(['building', 'hospital']);

/**
 * Solids as closed box meshes for recast: 8 corners and 12 outward-facing triangles each, rotation honoured, then the
 * `blockers` (axis-aligned access-zone volumes a tier may not enter) the same way. Roofs (building and hospital
 * solids) and blocker tops have their up-facing triangles wound to face down, which recast marks unwalkable whatever
 * the slope: they stop an agent like any solid but grow no unreachable navmesh island a closest-point query could snap
 * to.
 *
 * Recast rasterizes surfaces, not volumes, so a hollow box leaves walkable whatever is inside it (the ground under a
 * building or the terrace, the ramps and steps in a zone): an island inside the walls. A blocker is therefore filled
 * with horizontal, downward-facing (unwalkable) layers `layerStep` apart from its bottom up, which puts a ceiling less
 * than `layerStep` above every surface inside it; an axis-aligned solid, whose only inside surface is the floor it
 * stands on, gets one such layer `layerStep` above its bottom. `layerStep` must exceed the agent's climb (or recast
 * lifts a layer onto the surface below as a low-hanging obstacle) and be lower than the agent's height.
 */
export function solidsToTriangles(
  solids: readonly Solid[],
  blockers: readonly Solid[],
  layerStep: number,
): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = [];
  const indices: number[] = [];
  const corner = (base: number, k: number): number[] => [0, 1, 2].map((a) => positions[(base + k) * 3 + a]!);
  const addBox = (s: Solid, unwalkableTop: boolean, filled: boolean): void => {
    const base = positions.length / 3;
    const h = [s.size.x / 2, s.size.y / 2, s.size.z / 2] as const;
    const m = s.rotationDeg ? rotationMatrixXYZ(s.rotationDeg) : null;
    for (const c of CORNERS) {
      const l = [c[0] * h[0], c[1] * h[1], c[2] * h[2]] as const;
      const w = m ? m.map((row) => row[0]! * l[0] + row[1]! * l[1] + row[2]! * l[2]) : l;
      positions.push(s.center.x + w[0]!, s.center.y + w[1]!, s.center.z + w[2]!);
    }
    for (const [a, b, c] of TRIS) {
      const flip = unwalkableTop && upFacing(corner(base, a), corner(base, b), corner(base, c));
      indices.push(...(flip ? [base + a, base + c, base + b] : [base + a, base + b, base + c]));
    }
    if (m) return; // a rotated solid (a ramp slab) is thinner than any agent
    const [x0, x1] = [s.center.x - h[0], s.center.x + h[0]];
    const [z0, z1] = [s.center.z - h[2], s.center.z + h[2]];
    const [bottom, top] = [s.center.y - h[1], s.center.y + h[1]];
    for (let k = 1; bottom + k * layerStep < top && (filled || k === 1); k++) {
      const y = bottom + k * layerStep;
      const at = positions.length / 3;
      positions.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
      indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
    }
  };
  for (const s of solids) addBox(s, ROOFED.has(s.kind), false);
  for (const b of blockers) addBox(b, true, true);
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** Whether triangle abc's normal (b − a) × (c − a) points up. */
function upFacing(a: number[], b: number[], c: number[]): boolean {
  return (b[2]! - a[2]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[2]! - a[2]!) > 0;
}
