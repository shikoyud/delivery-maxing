import type { Vec3 } from '@dm/shared';

/** Indices into the item list, per LOD ring. */
export interface LodRings {
  lod0: number[];
  lod1: number[];
  lod2: number[];
}

/**
 * SP2's ring sort: items by horizontal distance from `center` (height is ignored): LOD0 up to radii[0], LOD1 up to
 * radii[1], LOD2 up to radii[2] (edges inclusive). Items beyond radii[2] are in no ring (not drawn).
 */
export function assignLods(items: readonly { position: Vec3 }[], center: Vec3, radii: readonly [number, number, number]): LodRings {
  const out: LodRings = { lod0: [], lod1: [], lod2: [] };
  const [r0, r1, r2] = radii.map((r) => r * r) as [number, number, number];
  for (let i = 0; i < items.length; i++) {
    const p = items[i]!.position;
    const dx = p.x - center.x;
    const dz = p.z - center.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= r0) out.lod0.push(i);
    else if (d2 <= r1) out.lod1.push(i);
    else if (d2 <= r2) out.lod2.push(i);
  }
  return out;
}
