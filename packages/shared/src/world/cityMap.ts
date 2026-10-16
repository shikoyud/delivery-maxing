import { cityConfig, worldConfig } from '../config';
import type { CityConfig, WorldConfig } from '../config';
import { vec3 } from '../math/vec3';
import type { CatalogIndex } from './catalog';
import type { CityLayout, Connector } from './cityLayout';
import type { AccessZone, MapData, Poi, Rect, Solid } from './mapTypes';
import { slab } from './slab';
import { steepLaneGeometry, terrainSolids } from './terrainSolids';

export interface CityMap extends MapData {
  kind: 'city';
  layout: CityLayout;
}

const TERRAIN_AREAS: ReadonlySet<string> = new Set(['sand', 'pier', 'breakwater']);
const PATH_AREAS: ReadonlySet<string> = new Set(['boardwalk', 'pier', 'park', 'sports']);

/** Expands a city layout into the MapData the sim, physics and orders use. */
export function layoutToMap(layout: CityLayout, cat: CatalogIndex, cfg?: { world: WorldConfig; city: CityConfig }): CityMap {
  const world = cfg?.world ?? worldConfig;
  const city = cfg?.city ?? cityConfig;

  const solids: Solid[] = terrainSolids(layout, { city });
  for (const a of layout.areas) {
    if (TERRAIN_AREAS.has(a.kind)) {
      solids.push(slab(a.id, 'terrain', a.rect.minX, a.rect.maxX, a.rect.minZ, a.rect.maxZ, a.y, city.terrain.terrainThickness));
    }
  }
  for (const lot of layout.lots) {
    if (lot.open) continue;
    const h = cat.get(lot.asset).size.h * (lot.stack ?? 1);
    const r = lot.rect;
    solids.push({
      id: lot.id,
      kind: lot.prop ? 'prop' : 'building',
      center: vec3((r.minX + r.maxX) / 2, lot.y + h / 2, (r.minZ + r.maxZ) / 2),
      size: vec3(r.maxX - r.minX, h, r.maxZ - r.minZ),
    });
  }

  const accessZones: AccessZone[] = [];
  for (const road of layout.roads) {
    if (road.kind === 'alley') accessZones.push({ id: `zone-${road.id}`, kind: 'alley', rect: road.rect, minY: road.y, maxY: road.y });
  }
  for (const c of layout.connectors) {
    const lo = Math.min(c.y0, c.y1);
    const hi = Math.max(c.y0, c.y1);
    if (c.kind === 'stairs') {
      const rect: Rect = { minX: c.x - city.stairs.width / 2, maxX: c.x + city.stairs.width / 2, minZ: c.z0, maxZ: c.z1 };
      accessZones.push({ id: `zone-${c.id}`, kind: 'stairs', rect, minY: lo, maxY: hi });
    } else if (c.kind === 'steepLane') {
      accessZones.push(...steepLaneZones(c, city));
    }
  }
  for (const a of layout.areas) {
    if (PATH_AREAS.has(a.kind)) accessZones.push({ id: `zone-${a.id}`, kind: 'path', rect: a.rect, minY: a.y, maxY: a.y });
  }

  const pois: Poi[] = [];
  for (const lot of layout.lots) {
    const poi = cat.get(lot.asset).poi;
    if (lot.door && poi && poi.roles.length > 0) {
      pois.push({
        id: lot.id,
        position: lot.door,
        district: lot.district,
        kind: 'door',
        name: lot.name,
        address: lot.address,
        lotId: lot.id,
        roles: [...poi.roles],
        ...(poi.items ? { items: [poi.items] } : {}),
        ...(poi.weightKg ? { weightKg: poi.weightKg } : {}),
      });
    }
    if (lot.upperDoor) {
      pois.push({
        id: `${lot.id}-upper`,
        position: lot.upperDoor.position,
        district: lot.district,
        kind: 'door',
        name: lot.name,
        address: lot.address,
        lotId: lot.id,
        upper: true,
        roles: ['dropoffFood'],
      });
    }
  }

  return {
    kind: 'city',
    layout,
    chunkSize: world.chunkSize,
    size: layout.size,
    solids,
    pois,
    hospitals: layout.hospitals,
    accessZones,
    gasStations: layout.gasStations,
    orderRules: layout.orderRules,
  };
}

/**
 * A steep lane's access zones (Decision 8): one axis-aligned rect per `zoneStep` metres of the deck's centre line from
 * where it crosses z0 to where it crosses z1, each widened to the whole 6 m deck (corners included) over its z range
 * and the next rect's first half lane width, with the deck's height range there.
 */
function steepLaneZones(c: Connector, city: CityConfig): AccessZone[] {
  const g = steepLaneGeometry(c, city.steepLane);
  const half = city.steepLane.width / 2;
  // centre-line distance s from the ramp's foot edge; the deck height there
  const at = (s: number) => ({ x: g.start.x + s * g.dx, z: g.start.z + s * g.dz });
  const height = (s: number) => c.y0 + ((c.y1 - c.y0) * Math.min(g.run, Math.max(0, s))) / g.run;
  const sOfZ = (z: number) => (z - g.start.z) / g.dz;
  const s0 = sOfZ(c.z0);
  const s1 = sOfZ(c.z1);
  const n = Math.max(1, Math.ceil((s1 - s0) / city.steepLane.zoneStep - 1e-9));
  const out: AccessZone[] = [];
  for (let i = 0; i < n; i++) {
    const za = at(s0 + ((s1 - s0) * i) / n).z;
    const zb = i === n - 1 ? c.z1 : Math.min(c.z1, at(s0 + ((s1 - s0) * (i + 1)) / n).z + half);
    // centre points whose deck reaches into [za, zb]
    const sa = sOfZ(za - g.corner);
    const sb = sOfZ(zb + g.corner);
    const wx = half * g.dz;
    const rect: Rect = { minX: at(sa).x - wx, maxX: at(sb).x + wx, minZ: za, maxZ: zb };
    out.push({ id: `zone-${c.id}-${i}`, kind: 'steepLane', rect, minY: height(sa), maxY: height(sb) });
  }
  return out;
}
