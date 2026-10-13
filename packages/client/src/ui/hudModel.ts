import type { MapData, Poi, Totals, Vec3 } from '@dm/shared';

/**
 * What the HUD shows. Transitional (SP3 Task 4): the old order loop is gone, so only the totals and the hospital safe
 * zone remain; Task 9 brings back active orders and offers.
 */
export interface HudModel {
  totals: Totals;
  /** Name of the hospital whose safe zone the player is in, or null. */
  safeZone: string | null;
}

/** "1 pt", "N pts". */
export function pointsText(n: number): string {
  return `${n} ${n === 1 ? 'pt' : 'pts'}`;
}

/** Looks up POIs by id, so labels and targets don't scan the whole list. */
export class PoiIndex {
  private readonly byId = new Map<string, Poi>();
  constructor(readonly map: MapData) {
    for (const p of map.pois) this.byId.set(p.id, p);
  }
  get(id: string): Poi {
    const p = this.byId.get(id);
    if (!p) throw new Error(`unknown POI ${id}`);
    return p;
  }
  target(id: string): Vec3 {
    return this.get(id).position;
  }
}

const indexes = new WeakMap<MapData, PoiIndex>();
export function poiIndex(map: MapData): PoiIndex {
  let idx = indexes.get(map);
  if (!idx) indexes.set(map, (idx = new PoiIndex(map)));
  return idx;
}

export function hudModel(totals: Totals, safeZone: string | null): HudModel {
  return { totals: { ...totals }, safeZone };
}
