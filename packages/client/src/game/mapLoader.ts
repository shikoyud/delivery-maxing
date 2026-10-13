import {
  expandGreybox,
  parseCityMap,
  parsePieceCatalog,
  parsePoiTable,
  type CityMap,
  type GreyboxSource,
  type MapData,
  type PieceCatalog,
  type PoiTableFile,
} from '@dm/shared';
// `?url`: the JSON files ship as separate assets and are fetched at start, so they never enter the JS bundle.
import cityUrl from '../../../../map/city.json?url';
import cityPoiUrl from '../../../../map/city.poi.json?url';
import greyboxUrl from '../../../../map/greybox.json?url';
import piecesUrl from '../../../../map/pieces.json?url';
import paletteAtlasUrl from '../../../../assets/city/palette-atlas.png?url';

export { paletteAtlasUrl };

export type MapKind = 'city' | 'greybox';

export interface LoadedMap {
  map: MapData;
  /** The city placement file and its piece catalog (null for the greybox). */
  city: CityMap | null;
  pieces: PieceCatalog | null;
  /** The city's navmesh POI table, map/city.poi.json (null for the greybox, which uses street distances). */
  poiTable: PoiTableFile | null;
}

/** Every runtime city model, by its path relative to the repo's assets/ dir (the piece catalog's lod0/lod1). */
const ASSET_PREFIX = '../../../../assets/';
const cityModels = import.meta.glob<string>(
  ['../../../../assets/city/buildings/*.glb', '../../../../assets/city/parts/*.glb'],
  { query: '?url', import: 'default', eager: true },
);

/** The served URL of a city model (works under the Pages sub-path). Throws for a file that isn't bundled. */
export function cityAssetUrl(path: string): string {
  const url = cityModels[ASSET_PREFIX + path];
  if (url === undefined) throw new Error(`city asset ${path} is not bundled`);
  return url;
}

/** The `?map=` query value: the city by default, or the SP1 greybox (`?map=greybox`). */
export function parseMapKind(value: string | null): MapKind {
  if (value === null || value === 'city') return 'city';
  if (value === 'greybox') return 'greybox';
  throw new Error(`unknown map "${value}" (expected city or greybox)`);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetches and validates a map: the city (map/city.json against map/pieces.json, with its POI table) or the expanded
 * SP1 greybox.
 */
export async function loadMap(kind: MapKind): Promise<LoadedMap> {
  if (kind === 'greybox') {
    const map = expandGreybox((await fetchJson(greyboxUrl)) as GreyboxSource);
    return { map, city: null, pieces: null, poiTable: null };
  }
  const [cityJson, piecesJson, poiJson] = await Promise.all([fetchJson(cityUrl), fetchJson(piecesUrl), fetchJson(cityPoiUrl)]);
  const pieces = parsePieceCatalog(piecesJson);
  const city = parseCityMap(cityJson, pieces);
  return { map: city, city, pieces, poiTable: parsePoiTable(poiJson) };
}
