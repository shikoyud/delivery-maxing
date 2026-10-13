import type { BandLimits } from '../config/types';
import type { Vec3 } from '../math/vec3';
import type { DistanceTable } from '../orders/distanceTable';
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

/** A board candidate: the POI, its one-way path distance from the HUB, the band that distance falls in. */
export interface PoiInfo { poi: Poi; hubDistance: number; band: Band; elevated: boolean }

/**
 * Board candidates for every POI in `map.pois` (pass a map holding only the reachable ones on the city). The band uses
 * the one-way `fromHub` distance (spec §3.4, §5.3).
 */
export function buildPoiInfo(map: Pick<MapData, 'pois'>, table: DistanceTable, bands: BandLimits): PoiInfo[] {
  return map.pois.map((poi) => {
    const hubDistance = table.fromHub(poi.id);
    return { poi, hubDistance, band: bandFor(hubDistance, bands), elevated: poi.elevated ?? false };
  });
}
