import type { OrdersConfig } from '../config/types';
import type { Vec3 } from '../math/vec3';
import type { MapData } from './mapTypes';

/** Horizontal distance <= radius and base.y - 0.5 <= p.y <= base.y + height. */
export function inCylinder(p: Vec3, base: Vec3, radius: number, height: number): boolean {
  return Math.hypot(p.x - base.x, p.z - base.z) <= radius && p.y >= base.y - 0.5 && p.y <= base.y + height;
}

export interface PlayerZones { inPlaza: boolean; inDropZone: boolean; poiIds: ReadonlySet<string> }

export function playerZones(p: Vec3, map: MapData, zonesCfg: OrdersConfig['zones']): PlayerZones {
  const { hub } = map;
  const poiIds = new Set<string>();
  for (const poi of map.pois) {
    if (inCylinder(p, poi.position, zonesCfg.poiRadius, zonesCfg.poiHeight)) poiIds.add(poi.id);
  }
  return {
    inPlaza: inCylinder(p, hub.center, hub.plazaRadius, hub.zoneHeight),
    inDropZone: inCylinder(p, hub.center, hub.dropZoneRadius, hub.zoneHeight),
    poiIds,
  };
}
