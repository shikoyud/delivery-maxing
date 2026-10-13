import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { movementConfig, ordersConfig, parseCityMap, parsePieceCatalog, parsePoiTable, worldConfig, type CityMap, type PoiTableFile } from '@dm/shared';
import { exportNavMesh } from 'recast-navigation';
import { generateCity } from '../city/generate';
import { parseCitySource } from '../city/source';
import { stableStringify } from '../city/stableJson';
import { buildCityNavMesh, initNav } from './navmesh';
import { computePoiTable, validatePoiTable } from './poiTable';

/** The committed outputs of `map:build`, by path relative to the repository root. */
export const MAP_OUTPUTS = { city: 'map/city.json', poi: 'map/city.poi.json', navMesh: 'map/city.navmesh.bin' } as const;

/** The navmesh size budget's message when `bytes` is over it (nav.maxNavMeshMB), else null. */
export function navMeshBudgetError(bytes: number): string | null {
  const mb = bytes / 1024 / 1024;
  return mb > worldConfig.nav.maxNavMeshMB ? `navmesh is ${mb.toFixed(2)} MB, over the ${worldConfig.nav.maxNavMeshMB} MB budget` : null;
}

export interface MapBuild {
  city: CityMap;
  table: PoiTableFile;
  /** File contents by output path (MAP_OUTPUTS values) */
  files: Record<string, Uint8Array>;
  /** validatePoiTable's messages (empty when the map passes) */
  errors: string[];
  /** Wall seconds spent generating the city and building the navmesh and the POI table */
  seconds: { city: number; navMesh: number; table: number };
}

/**
 * Generates the city from map/city.source.json, builds its navmesh and POI table, and validates them; writes nothing.
 * Every output is parsed back (a parse failure throws).
 */
export async function buildMapOutputs(repo: string): Promise<MapBuild> {
  const readJson = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), 'utf8'));
  const clock = (): (() => number) => {
    const t = performance.now();
    return () => (performance.now() - t) / 1000;
  };

  let lap = clock();
  const src = parseCitySource(readJson('map/city.source.json'));
  const pieces = parsePieceCatalog(readJson('map/pieces.json'));
  const cityJson = stableStringify(generateCity(src, pieces));
  const city = parseCityMap(JSON.parse(cityJson), pieces);
  const citySeconds = lap();

  lap = clock();
  await initNav();
  const navMesh = buildCityNavMesh(city, movementConfig);
  const navMeshSeconds = lap();

  lap = clock();
  const poiJson = stableStringify(computePoiTable(city, navMesh));
  const table = parsePoiTable(JSON.parse(poiJson));
  const tableSeconds = lap();

  const bin = exportNavMesh(navMesh);
  navMesh.destroy();
  const enc = new TextEncoder();
  return {
    city,
    table,
    files: { [MAP_OUTPUTS.city]: enc.encode(cityJson), [MAP_OUTPUTS.poi]: enc.encode(poiJson), [MAP_OUTPUTS.navMesh]: bin },
    errors: validatePoiTable(table, city, ordersConfig),
    seconds: { city: citySeconds, navMesh: navMeshSeconds, table: tableSeconds },
  };
}
