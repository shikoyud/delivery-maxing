import { bandFor, worldConfig, type Band, type CityMap, type OrdersConfig, type PoiRow, type PoiTableFile } from '@dm/shared';
import type { NavMesh } from 'recast-navigation';
import { NavPaths } from './navmesh';

const BANDS: readonly Band[] = ['short', 'medium', 'long'];

/** Path metres rounded to 0.1 m; −1 (no path) stays −1. */
const round1 = (d: number): number => (d < 0 ? -1 : Math.round(d * 10) / 10);

/**
 * The POI table (map/city.poi.json): for every POI, the navmesh path metres from the HUB centre and back, and the
 * N × N matrix of POI-to-POI paths in `city.pois` order (both directions measured; 0 on the diagonal). A path counts
 * only when it starts within `tol` of its start and ends within `tol` of its target. A POI is reachable only when both
 * the way there and the way back exist.
 */
export function computePoiTable(city: CityMap, navMesh: NavMesh, tol = worldConfig.nav.reachTolerance): PoiTableFile {
  const paths = new NavPaths(navMesh);
  try {
    const hub = city.hub.center;
    const unreachable: PoiTableFile['unreachable'] = [];
    const pois = city.pois.map((poi): PoiRow => {
      const fromHub = round1(paths.distance(hub, poi.position, tol));
      const toHub = round1(paths.distance(poi.position, hub, tol));
      const why = [fromHub < 0 ? 'no path from the HUB' : '', toHub < 0 ? 'no path back to the HUB' : ''].filter(Boolean);
      if (why.length > 0) unreachable.push({ id: poi.id, reason: why.join('; ') });
      return { id: poi.id, district: poi.district, elevated: poi.elevated ?? false, fromHub, toHub, reachable: why.length === 0 };
    });
    const between = city.pois.map((a, i) =>
      city.pois.map((b, j) => (i === j ? 0 : round1(paths.distance(a.position, b.position, tol)))),
    );
    return { version: 1, pois, between, unreachable };
  } finally {
    paths.destroy();
  }
}

/**
 * What the build requires of the table (spec §5.3, plan Task 14), one message per failure: the table lists the city's
 * POIs in order; every POI is reachable; at least `minReachable` are; elevated POIs are at least `minElevatedShare` of
 * the reachable ones; every distance band (`bands.city`, by `fromHub`) has `minPerBand`; every pair of reachable POIs has
 * a path both ways (a Chain between them is priced with it, and a −1 would throw in the game loop); no drop link falls
 * further than the Fragile limit.
 */
export function validatePoiTable(table: PoiTableFile, city: CityMap, orders: OrdersConfig): string[] {
  const errors: string[] = [];
  const rules = orders.poiChecks;
  if (table.pois.map((p) => p.id).join() !== city.pois.map((p) => p.id).join()) errors.push('the table does not list the city POIs in order');
  for (const u of table.unreachable) errors.push(`${u.id} is unreachable: ${u.reason}`);

  const reachable = table.pois.filter((p) => p.reachable);
  if (reachable.length < rules.minReachable) errors.push(`only ${reachable.length} reachable POIs (need ${rules.minReachable})`);
  const share = reachable.length === 0 ? 0 : reachable.filter((p) => p.elevated).length / reachable.length;
  if (share < rules.minElevatedShare) {
    errors.push(`elevated share ${share.toFixed(2)} of reachable POIs is below ${rules.minElevatedShare}`);
  }
  for (const band of BANDS) {
    const n = reachable.filter((p) => bandFor(p.fromHub, orders.bands.city) === band).length;
    if (n < rules.minPerBand) errors.push(`only ${n} POIs in the ${band} band (need ${rules.minPerBand})`);
  }

  errors.push(...missingPairs(table));

  const maxFall = orders.fragile.maxFallMeters;
  for (const l of city.navLinks) {
    const fall = l.from.y - l.to.y;
    if (l.kind === 'drop' && fall > maxFall) {
      errors.push(`drop link ${l.id} falls ${Number(fall.toFixed(2))} m (the Fragile limit is ${maxFall} m)`);
    }
  }
  return errors;
}

/** At most this many "no path" pairs are listed one by one; the rest are counted in one line. */
const MAX_PAIR_MESSAGES = 10;

/** One message per ordered pair of distinct reachable POIs with no path (−1) between them, capped at MAX_PAIR_MESSAGES. */
function missingPairs(table: PoiTableFile): string[] {
  const missing: string[] = [];
  let count = 0;
  table.pois.forEach((a, i) => {
    if (!a.reachable) return;
    table.pois.forEach((b, j) => {
      if (i === j || !b.reachable || (table.between[i]?.[j] ?? -1) >= 0) return;
      count++;
      if (missing.length < MAX_PAIR_MESSAGES) missing.push(`no path from ${a.id} to ${b.id}`);
    });
  });
  if (count > missing.length) missing.push(`… and ${count - missing.length} more reachable POI pairs with no path`);
  return missing;
}
