import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CatalogIndex, parseCatalog, parseCityLayout, type CityLayout } from '@dm/shared';
import { CATALOG, CITY_LAYOUT } from '../nav/files';
import { writeStableJson } from './stableJson';

/** map/catalog.json, validated and indexed. */
export function readCatalog(repo: string): CatalogIndex {
  return new CatalogIndex(parseCatalog(JSON.parse(readFileSync(join(repo, CATALOG), 'utf8'))));
}

/** The committed map/city.layout.json, validated. */
export function readLayout(repo: string): CityLayout {
  return parseCityLayout(JSON.parse(readFileSync(join(repo, CITY_LAYOUT), 'utf8')));
}

/** Writes map/city.layout.json with sorted keys (see stableStringify). */
export function writeLayout(repo: string, layout: CityLayout): void {
  writeStableJson(join(repo, CITY_LAYOUT), layout);
}
