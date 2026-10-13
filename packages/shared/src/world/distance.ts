import type { OrdersConfig } from '../config/types';
import type { Vec3 } from '../math/vec3';
import type { Poi } from './mapTypes';

export type PathDistance = (from: Vec3, to: Vec3) => number;

/** Manhattan distance on the x/z plane (street grid); ignores height. */
export const streetDistance: PathDistance = (from, to) =>
  Math.abs(from.x - to.x) + Math.abs(from.z - to.z);

export type Band = 'short' | 'medium' | 'long';

export function bandFor(d: number, bands: OrdersConfig['bands']): Band {
  if (d < bands.shortMax) return 'short';
  if (d <= bands.mediumMax) return 'medium';
  return 'long';
}

/** Transitional: still used by the old order system, which Task 5 deletes. */
export interface PoiInfo { poi: Pick<Poi, 'id' | 'position' | 'district' | 'kind'>; hubDistance: number; band: Band }
