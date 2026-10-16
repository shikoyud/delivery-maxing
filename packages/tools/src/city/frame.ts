import type { CityConfig, CityDistrict, Level, NamesConfig, Road } from '@dm/shared';

// The city frame (city design sections 2-4): the cross-street grid, the block columns between the cross streets, the
// districts by level and x, and the streets every built level has.

/** The levels made of street blocks (L0 and the ridge are built by hand, Task 8). */
export type BuiltLevel = 'L1' | 'L2' | 'L3';
export const BUILT_LEVELS: readonly BuiltLevel[] = ['L1', 'L2', 'L3'];

const AVENUE_INDEX: Record<Level, number> = { L0: 0, L1: 1, L2: 2, L3: 3, ridge: 4 };

/** Centre lines of the north-south cross streets: crossStreetFirst + crossStreetPitch * k. */
export function crossStreetXs(cfg: CityConfig): number[] {
  return Array.from({ length: cfg.crossStreets }, (_, k) => cfg.crossStreetFirst + cfg.crossStreetPitch * k);
}

/** The x-extent of block column k: from the east kerb of cross street k to the next one's west kerb (or the edge street). */
export function blockColumns(cfg: CityConfig): { k: number; x0: number; x1: number }[] {
  const xs = crossStreetXs(cfg);
  return xs.map((x, k) => ({
    k,
    x0: x + cfg.street / 2,
    x1: k + 1 < xs.length ? xs[k + 1]! - cfg.street / 2 : cfg.eastEdgeStreetX,
  }));
}

/** The district at `xCentre` on a level (the prototype's district_of, with L0 split at the beach). */
export function districtOf(level: Level, xCentre: number, cfg: CityConfig): CityDistrict {
  switch (level) {
    case 'L0':
      return xCentre < cfg.beach.x0 ? 'docks' : xCentre < cfg.beach.x1 ? 'beach' : 'harbor';
    case 'L1': {
      const s = cfg.districtSplits.L1;
      return xCentre < s.industrialMaxX ? 'industrial' : xCentre < s.downtownMaxX ? 'downtown' : 'market';
    }
    case 'L2': {
      const s = cfg.districtSplits.L2;
      return xCentre < s.rowhousesMaxX ? 'rowhouses' : xCentre < s.highstreetMaxX ? 'highstreet' : 'apartments';
    }
    case 'L3':
      return 'uptown';
    case 'ridge':
      return 'hillcrest';
  }
}

export const roadId = {
  avenue: (level: Level): string => `road-${level}-avenue`,
  cross: (level: Level, k: number): string => `road-${level}-cross-${k}`,
  edge: (level: Level): string => `road-${level}-edge`,
  top: (level: Level): string => `road-${level}-top`,
  /** The east-west street north of block (k, row) */
  row: (level: Level, k: number, row: number): string => `road-${level}-row-${k}-${row}`,
  alley: (level: Level, k: number, row: number): string => `road-${level}-alley-${k}-${row}`,
};

/**
 * A built level's frame streets: the avenue along its south edge, the cross streets and the east edge street from the
 * avenue to the top, and the top street along its north edge. L0 and the ridge have none here (Task 8 builds them).
 */
export function levelRoads(level: Level, cfg: CityConfig, names: NamesConfig): Road[] {
  if (level === 'L0' || level === 'ridge') return [];
  const { y, z0, z1 } = cfg.levels[level];
  const zs = z0 + cfg.avenue;
  const roads: Road[] = [
    { id: roadId.avenue(level), kind: 'avenue', rect: { minX: 0, minZ: z0, maxX: cfg.size, maxZ: zs }, y, name: names.streets.avenues[AVENUE_INDEX[level]]! },
  ];
  crossStreetXs(cfg).forEach((x, k) => {
    const name = names.streets.cross[k];
    if (name === undefined) throw new Error(`names: no cross street name for k = ${k}`);
    roads.push({ id: roadId.cross(level, k), kind: 'street', rect: { minX: x - cfg.street / 2, minZ: zs, maxX: x + cfg.street / 2, maxZ: z1 }, y, name });
  });
  roads.push({ id: roadId.edge(level), kind: 'street', rect: { minX: cfg.eastEdgeStreetX, minZ: zs, maxX: cfg.size, maxZ: z1 }, y, name: names.streets.edge });
  roads.push({ id: roadId.top(level), kind: 'street', rect: { minX: 0, minZ: z1 - cfg.street, maxX: cfg.size, maxZ: z1 }, y, name: names.streets.terraces[level] });
  return roads;
}
