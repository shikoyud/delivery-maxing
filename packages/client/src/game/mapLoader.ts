import {
  CatalogIndex,
  expandGreybox,
  layoutToMap,
  parseCatalog,
  parseCityLayout,
  type DistanceTable,
  type GreyboxSource,
  type MapData,
  type NavRouter,
} from '@dm/shared';
import greyboxJson from '../../../../map/greybox.json';
// The city layout (≈1.4 MB) and the catalog are fetched at boot, not inlined in the bundle: Vite emits them as assets.
import layoutUrl from '../../../../map/city.layout.json?url';
import catalogUrl from '../../../../map/catalog.json?url';
import { loadDistanceTable, loadNavRouter } from './navLoader';

/** Which map to play: `?map=greybox` is the SP4 town (kept for its e2e suite); anything else is the city. */
export type MapKind = 'city' | 'greybox';

/** `?map=` → the map kind; the city by default. */
export function parseMapKind(value: string | null): MapKind {
  return value === 'greybox' ? 'greybox' : 'city';
}

export interface LoadedMap {
  map: MapData;
  /** Paths on the map's five per-tier navmeshes. */
  nav: NavRouter;
  /** The city's build-time pickup→dropoff distances; null on the greybox (every leg asks the router). */
  distances: DistanceTable | null;
  /** The asset catalog: what the city's lots name (block boxes, pack models), and the pack car on either map. */
  catalog: CatalogIndex;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Loads a map with its navmeshes and the catalog (and, for the city, the distance table), in parallel. The city's layout is parsed
 * and expanded with `layoutToMap`; the greybox is the SP4 town exactly as before.
 */
export async function loadMap(kind: MapKind): Promise<LoadedMap> {
  if (kind === 'greybox') {
    const [nav, catalogJson] = await Promise.all([loadNavRouter('greybox'), fetchJson(catalogUrl)]);
    return { map: expandGreybox(greyboxJson as GreyboxSource), nav, distances: null, catalog: new CatalogIndex(parseCatalog(catalogJson)) };
  }
  const [layoutJson, catalogJson, nav, distances] = await Promise.all([
    fetchJson(layoutUrl),
    fetchJson(catalogUrl),
    loadNavRouter('city'),
    loadDistanceTable(),
  ]);
  const catalog = new CatalogIndex(parseCatalog(catalogJson));
  const map = layoutToMap(parseCityLayout(layoutJson), catalog);
  return { map, nav, distances, catalog };
}
