import type { BandLimits } from '../config/types';
import type { Vec3 } from '../math/vec3';
import type { MapData, Poi } from './mapTypes';

export type PathDistance = (from: Vec3, to: Vec3) => number;

/** Manhattan distance on the x/z plane (street grid); ignores height. */
export const streetDistance: PathDistance = (from, to) =>
  Math.abs(from.x - to.x) + Math.abs(from.z - to.z);

export type Band = 'short' | 'medium' | 'long';

export function bandFor(d: number, bands: BandLimits): Band {
  if (d < bands.shortMax) return 'short';
  if (d <= bands.mediumMax) return 'medium';
  return 'long';
}

export interface PoiInfo { poi: Poi; hubDistance: number; band: Band }

export function buildPoiTable(map: MapData, dist: PathDistance, bands: BandLimits): PoiInfo[] {
  return map.pois.map((poi) => {
    const hubDistance = dist(map.hub.center, poi.position);
    return { poi, hubDistance, band: bandFor(hubDistance, bands) };
  });
}
