import { streetDistance } from '../world/distance';
import type { MapData, Poi } from '../world/mapTypes';
import type { PoiTableFile } from '../world/poiTable';

/** Path metres an order's route needs, by POI id: HUB centre → POI, POI → HUB centre, and POI → POI. */
export interface DistanceTable {
  fromHub(poiId: string): number;
  toHub(poiId: string): number;
  between(a: string, b: string): number;
}

/** The SP1 greybox's distances: street (Manhattan |dx| + |dz|) metres, the same both ways. Throws on an unknown id. */
export function streetDistanceTable(map: MapData): DistanceTable {
  const at = new Map(map.pois.map((p) => [p.id, p.position]));
  const pos = (id: string) => {
    const p = at.get(id);
    if (!p) throw new Error(`distance table: unknown poi ${id}`);
    return p;
  };
  const hub = map.hub.center;
  return {
    fromHub: (id) => streetDistance(hub, pos(id)),
    toHub: (id) => streetDistance(pos(id), hub),
    between: (a, b) => streetDistance(pos(a), pos(b)),
  };
}

/**
 * The city's measured navmesh distances (map/city.poi.json). Throws on an unknown id and on a −1 ("no path") entry,
 * so an unreachable POI can never be priced as a 0 m or negative route.
 */
export function navDistanceTable(file: PoiTableFile): DistanceTable {
  const index = new Map(file.pois.map((p, i) => [p.id, i]));
  const idx = (id: string): number => {
    const i = index.get(id);
    if (i === undefined) throw new Error(`distance table: unknown poi ${id}`);
    return i;
  };
  const path = (d: number | undefined, what: string): number => {
    if (d === undefined || d < 0) throw new Error(`distance table: no path ${what}`);
    return d;
  };
  return {
    fromHub: (id) => path(file.pois[idx(id)]?.fromHub, `from the HUB to ${id}`),
    toHub: (id) => path(file.pois[idx(id)]?.toHub, `from ${id} to the HUB`),
    between: (a, b) => path(file.between[idx(a)]?.[idx(b)], `from ${a} to ${b}`),
  };
}

/** The map's POIs that passed the build-time reachability check (spec §5.3). Throws for a POI the table lacks. */
export function reachablePois(map: MapData, file: PoiTableFile): Poi[] {
  const reachable = new Map(file.pois.map((p) => [p.id, p.reachable]));
  return map.pois.filter((p) => {
    const r = reachable.get(p.id);
    if (r === undefined) throw new Error(`poi table has no row for ${p.id}`);
    return r;
  });
}
