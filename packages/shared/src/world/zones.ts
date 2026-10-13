import type { OrdersConfig } from '../config/types';
import type { Vec3 } from '../math/vec3';
import { inSafeZone } from './hospitals';
import type { MapData } from './mapTypes';

/** Horizontal distance <= radius and base.y - 0.5 <= p.y <= base.y + height. */
export function inCylinder(p: Vec3, base: Vec3, radius: number, height: number): boolean {
  return Math.hypot(p.x - base.x, p.z - base.z) <= radius && p.y >= base.y - 0.5 && p.y <= base.y + height;
}

export interface PlayerZones {
  poiIds: ReadonlySet<string>;
  /** Id of the hospital whose safe zone contains the player, or null. */
  safeZone: string | null;
}

export function playerZones(p: Vec3, map: MapData, zonesCfg: OrdersConfig['zones']): PlayerZones {
  const poiIds = new Set<string>();
  for (const poi of map.pois) {
    if (inCylinder(p, poi.position, zonesCfg.poiRadius, zonesCfg.poiHeight)) poiIds.add(poi.id);
  }
  return { poiIds, safeZone: inSafeZone(map, p)?.id ?? null };
}
