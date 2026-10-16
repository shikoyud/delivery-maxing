import { vec3 } from '../math/vec3';
import { cityConfigDefaults } from './cityDefaults';
import type { CityConfig } from '../config';
import type { CityLayout, Level } from './cityLayout';
import type { Solid } from './mapTypes';

const LEVEL_ORDER: Level[] = ['L0', 'L1', 'L2', 'L3', 'ridge'];

/** A slab whose top face is at `top`. */
export function slab(id: string, kind: Solid['kind'], x0: number, x1: number, z0: number, z1: number, top: number, thickness: number): Solid {
  return {
    id,
    kind,
    center: vec3((x0 + x1) / 2, top - thickness / 2, (z0 + z1) / 2),
    size: vec3(x1 - x0, thickness, z1 - z0),
  };
}

/**
 * The static terrain: one ground per level (L0 split so the water has none). Tasks 7-8 add the slope-band blocks,
 * parapets and connector solids here.
 */
export function terrainSolids(layout: CityLayout, cfg?: { city: CityConfig }): Solid[] {
  const c = (cfg?.city ?? cityConfigDefaults).layout;
  const out: Solid[] = [];
  for (const lv of LEVEL_ORDER) {
    const { y, z0, z1 } = layout.levels[lv];
    if (lv === 'L0') {
      for (const g of c.l0Ground) out.push(slab(`ground-L0-${g.id}`, 'ground', g.x0, g.x1, g.z0, z1, y, c.slabThickness));
    } else {
      out.push(slab(`ground-${lv}`, 'ground', 0, layout.size, z0, z1, y, c.slabThickness));
    }
  }
  return out;
}
