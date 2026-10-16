import { cityConfig } from '../config';
import type { CityConfig } from '../config';
import { slab } from './slab';
import type { CityLayout, Connector, Level } from './cityLayout';
import type { Solid } from './mapTypes';

const LEVEL_ORDER: Level[] = ['L0', 'L1', 'L2', 'L3', 'ridge'];

/**
 * A steep lane is a diagonal ramp at a fixed grade: its horizontal run is (y1 - y0) * 100 / gradePct, and it climbs
 * `z1 - z0` northward, so it drifts east by sqrt(run^2 - dz^2). A lane whose run is no longer than dz goes straight north.
 */
export function steepLaneGeometry(
  c: Pick<Connector, 'x' | 'z0' | 'z1' | 'y0' | 'y1'>,
  gradePct: number,
): { run: number; endX: number } {
  const dz = c.z1 - c.z0;
  const run = (Math.abs(c.y1 - c.y0) * 100) / gradePct;
  if (run <= dz) return { run: dz, endX: c.x };
  return { run, endX: c.x + Math.sqrt(run * run - dz * dz) };
}

/**
 * The static terrain: one ground per level (L0 split so the water has none). Tasks 7-8 add the slope-band blocks,
 * parapets and connector solids here.
 */
export function terrainSolids(layout: CityLayout, cfg?: { city: CityConfig }): Solid[] {
  const c = (cfg?.city ?? cityConfig).terrain;
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
