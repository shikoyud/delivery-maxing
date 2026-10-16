import { worldConfig } from '../config';
import type { CityConfig, WorldConfig } from '../config';
import { vec3 } from '../math/vec3';
import type { CatalogIndex } from './catalog';
import { cityConfigDefaults } from './cityDefaults';
import type { CityLayout } from './cityLayout';
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
  const city = cfg?.city ?? cityConfigDefaults;
  const lc = city.layout;

  const solids: Solid[] = terrainSolids(layout, { city });
  for (const a of layout.areas) {
    if (TERRAIN_AREAS.has(a.kind)) {
      solids.push(slab(a.id, 'terrain', a.rect.minX, a.rect.maxX, a.rect.minZ, a.rect.maxZ, a.y, lc.terrainThickness));
    }
  }
  for (const lot of layout.lots) {
    if (lot.open) continue;
    const h = cat.get(lot.asset).size.h;
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
      const rect: Rect = { minX: c.x - lc.stairsWidth / 2, maxX: c.x + lc.stairsWidth / 2, minZ: c.z0, maxZ: c.z1 };
      accessZones.push({ id: `zone-${c.id}`, kind: 'stairs', rect, minY: lo, maxY: hi });
    } else if (c.kind === 'steepLane') {
      const { run, endX } = steepLaneGeometry(c, lc.steepLaneGradePct);
      const n = Math.max(1, Math.ceil(run / lc.zoneStep - 1e-9));
      const half = lc.steepLaneWidth / 2;
      for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        const xa = c.x + (endX - c.x) * t0;
        const xb = c.x + (endX - c.x) * t1;
        const za = c.z0 + (c.z1 - c.z0) * t0;
        const zb = c.z0 + (c.z1 - c.z0) * t1;
        const ya = c.y0 + (c.y1 - c.y0) * t0;
        const yb = c.y0 + (c.y1 - c.y0) * t1;
        // each rect overlaps the next by half a lane width
        const rect: Rect = {
          minX: Math.min(xa, xb) - half,
          maxX: Math.max(xa, xb) + half,
          minZ: za,
          maxZ: i === n - 1 ? c.z1 : Math.min(c.z1, zb + half),
        };
        accessZones.push({ id: `zone-${c.id}-${i}`, kind: 'steepLane', rect, minY: Math.min(ya, yb), maxY: Math.max(ya, yb) });
      }
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
