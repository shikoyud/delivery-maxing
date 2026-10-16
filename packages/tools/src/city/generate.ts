import {
  connectorExtent,
  mulberry32,
  type Area,
  type Block,
  type CatalogIndex,
  type CityConfig,
  type CityDistrict,
  type CityLayout,
  type Connector,
  type Lot,
  type NamesConfig,
  type Rng,
  type Road,
} from '@dm/shared';
import { BAND_LOWER, BANDS, bandBlock, bandConnectors, bandGaps, bandSegments, slopeLots } from './bands';
import { blockStreets, fillBlock, levelBlocks, toBlock } from './blocks';
import { BUILT_LEVELS, levelRoads, roadId } from './frame';
import { Namer } from './names';
import { PALETTES } from './palettes';

// The deterministic city generator (city design section 7.1; the prototype city-map-prototype/layout.py is its
// starting point). Part 1: the frame, the blocks and their lots, names and addresses. Part 2: the slope bands (their
// connectors, gaps and walk-ups). Tasks 8-9 add the landmarks, waterfront and Hillcrest, and the doors.

/** FNV-1a of a stream name mixed with the seed: each district (and the namer) has its own random stream. */
export function districtSeed(seed: number, name: string): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export function generateLayout(cfg: CityConfig, names: NamesConfig, cat: CatalogIndex): CityLayout {
  if (cfg.size !== 1200) throw new Error(`generate: the city is 1200 m square (config size ${cfg.size})`);
  const rngs = new Map<CityDistrict, Rng>();
  const rngOf = (d: CityDistrict): Rng => {
    let r = rngs.get(d);
    if (!r) rngs.set(d, (r = mulberry32(districtSeed(cfg.seed, d))));
    return r;
  };
  const namer = new Namer(names, mulberry32(districtSeed(cfg.seed, 'names')));

  const blocks: Block[] = [];
  const lots: Lot[] = [];
  const roads: Road[] = [];
  const areas: Area[] = [];
  for (const level of BUILT_LEVELS) {
    const plans = levelBlocks(level, cfg);
    const levelRoadList = [...levelRoads(level, cfg, names), ...blockStreets(level, plans, cfg, names)];
    roads.push(...levelRoadList);
    const roadById = new Map(levelRoadList.map((r) => [r.id, r]));
    for (const plan of plans) {
      blocks.push(toBlock(plan));
      const filled = fillBlock(plan, PALETTES[plan.district], rngOf(plan.district), cat, cfg);
      roads.push(...filled.roads);
      areas.push(...filled.areas);
      for (const lot of filled.lots) {
        const entry = cat.get(lot.asset);
        const front = roadById.get(lot.facing === 'S' ? plan.south : plan.north);
        if (!front) throw new Error(`generate: lot ${lot.id} faces no road`);
        lots.push({ ...lot, name: namer.lotName(entry), address: namer.address(lot, front, entry) });
      }
    }
  }

  const connectors: Connector[] = [];
  for (const band of BANDS) {
    const cs = bandConnectors(band, cfg);
    connectors.push(...cs);
    areas.push(...bandGaps(band, cs, cfg));
    const used = cs.map((c) => connectorExtent(c, cfg));
    const slope = slopeLots(band, used, rngOf('slope'), cat, cfg);
    if (slope.length === 0) continue;
    const front = roads.find((r) => r.id === roadId.top(BAND_LOWER[band]));
    if (!front) throw new Error(`generate: band ${band} walk-ups face no street`);
    const segments = bandSegments(used, cfg.size);
    const blockIds = new Set(slope.map((l) => l.block));
    segments.forEach((seg, i) => {
      const b = bandBlock(band, i, seg, cfg);
      if (blockIds.has(b.id)) blocks.push(b);
    });
    for (const lot of slope) {
      const entry = cat.get(lot.asset);
      lots.push({ ...lot, name: namer.lotName(entry), address: namer.address(lot, front, entry) });
    }
  }

  return {
    version: 1,
    seed: cfg.seed,
    size: 1200,
    levels: cfg.levels,
    bands: cfg.bands,
    blocks,
    lots,
    roads,
    curvedRoads: [],
    connectors,
    areas,
    hospitals: [],
    gasStations: [],
    orderRules: cfg.orderRules,
  };
}
