import { DistanceTable, gunzip, initNav, isGzip, NAV_TIERS, NavRouter, type MapData, type VehicleTier } from '@dm/shared';
import distancesUrl from '../../../../map/city.distances.bin.gz?url';

/** The ten gzipped navmeshes built by `pnpm map:build` (Vite emits them as assets under the base path), by file name. */
const NAV_FILES = import.meta.glob<string>('../../../../map/nav/*.bin.gz', { query: '?url', import: 'default', eager: true });

/** The URL of a map's tier navmesh (map/nav/<kind>-<tier>.bin.gz). */
export function navUrl(kind: MapData['kind'], tier: VehicleTier): string {
  const name = `/${kind}-${tier}.bin.gz`;
  const key = Object.keys(NAV_FILES).find((k) => k.endsWith(name));
  if (!key) throw new Error(`navmesh ${kind}-${tier}.bin.gz is not built (run pnpm map:build)`);
  return NAV_FILES[key]!;
}

/** A gzipped file's inflated bytes (passed through when the server already inflated it: Content-Encoding gzip). */
async function fetchGz(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return isGzip(bytes) ? gunzip(bytes) : bytes;
}

/** Loads the recast WASM and the five per-tier navmeshes of a map (in parallel) and builds the router. */
export async function loadNavRouter(kind: MapData['kind'] = 'greybox'): Promise<NavRouter> {
  const [, ...bytes] = await Promise.all([initNav(), ...NAV_TIERS.map((t) => fetchGz(navUrl(kind, t)))]);
  const bins = {} as Record<VehicleTier, Uint8Array>;
  NAV_TIERS.forEach((t, i) => (bins[t] = bytes[i]!));
  return NavRouter.fromBinaries(bins);
}

/** The city's pickup→dropoff distance table (map/city.distances.bin.gz) for offer rolls. */
export async function loadDistanceTable(): Promise<DistanceTable> {
  return DistanceTable.parse(await fetchGz(distancesUrl));
}
