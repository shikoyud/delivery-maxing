import type { OrdersConfig } from '../config/types';
import type { Vec3 } from '../math/vec3';
import type { PoiInfo } from '../world/distance';
import type { District } from '../world/mapTypes';

/** What the POI selection rules (spec §5.3) need to know about the player when a board is generated. */
export interface SelectionContext {
  /** Sim time, s */
  now: number;
  /** POI id → when an order with that POI was last accepted, s */
  recentUse: ReadonlyMap<string, number>;
  /** Every POI (every step) of the player's active orders */
  activePois: readonly Vec3[];
  /** Districts of the accepted POIs, most recent first */
  recentDistricts: readonly District[];
}

export type SelectionConfig = OrdersConfig['selection'];

/** Horizontal (x/z) distance: a roof POI right above another is as close as one beside it. */
export const horizontalDistance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * The POIs a board may offer: not accepted within the last `reuseSeconds`, and at least `spreadMeters` (horizontally)
 * from every POI of an active order. Keeps the input order.
 */
export function eligiblePois(pois: readonly PoiInfo[], ctx: SelectionContext, cfg: SelectionConfig): PoiInfo[] {
  return pois.filter((p) => {
    const usedAt = ctx.recentUse.get(p.poi.id);
    if (usedAt !== undefined && ctx.now - usedAt < cfg.reuseSeconds) return false;
    return ctx.activePois.every((a) => horizontalDistance(a, p.poi.position) >= cfg.spreadMeters);
  });
}

/** District balance: 1 / (1 + n), n = how often `d` is among the last `districtWindow` accepted POIs' districts. */
export function districtWeight(d: District, ctx: SelectionContext, cfg: SelectionConfig): number {
  const n = ctx.recentDistricts.slice(0, cfg.districtWindow).filter((x) => x === d).length;
  return 1 / (1 + n);
}
