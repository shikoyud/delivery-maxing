import { DistanceTable, type MapData, type NavRouter, type Poi } from '@dm/shared';

// The city's pickup→dropoff distance table (Decision 14): offer rolls read the on-foot path distance of a pair from it
// instead of asking the router at runtime.

const isPickup = (p: Poi): boolean => p.roles.includes('foodPickup') || p.roles.includes('packagePickup');
const isDropoff = (p: Poi): boolean => p.roles.includes('dropoffFood') || p.roles.includes('dropoffPackage');

/**
 * The walk path distance (`router.distance('walk', …)`, Infinity when not reachable) from every pickup door of `map`
 * to every dropoff door, in `map.pois` order; a door that is both is 0 from itself.
 */
export function buildDistanceTable(map: MapData, router: NavRouter): DistanceTable {
  const pickups = map.pois.filter(isPickup);
  const dropoffs = map.pois.filter(isDropoff);
  const values = new Float32Array(pickups.length * dropoffs.length);
  pickups.forEach((p, i) => {
    dropoffs.forEach((d, j) => {
      values[i * dropoffs.length + j] = p.id === d.id ? 0 : router.distance('walk', p.position, d.position);
    });
  });
  return new DistanceTable(
    pickups.map((p) => p.id),
    dropoffs.map((d) => d.id),
    values,
  );
}

/** The table's bytes (format in packages/shared/src/orders/distanceTable.ts), before gzip. */
export const serialize = (t: DistanceTable): Uint8Array => t.toBytes();
