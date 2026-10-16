import {
  connectorExtent,
  freeSpans,
  mulberry32,
  type Area,
  type Block,
  type CatalogIndex,
  type CityConfig,
  type CityDistrict,
  type CityLayout,
  type Connector,
  type GasStation,
  type Hospital,
  type Lot,
  type NamesConfig,
  type Rng,
  type Road,
} from '@dm/shared';
import { BAND_LOWER, BANDS, bandBlock, bandConnectors, bandGaps, slopeLots } from './bands';
import { blockStreets, fillBlock, levelBlocks, toBlock } from './blocks';
import { BUILT_LEVELS, levelRoads, roadId } from './frame';
import { buildHillcrest } from './hillcrest';
import { specialBlocks } from './landmarks';
import { Namer } from './names';
import { assignDoors, pickPois } from './pois';
import { PALETTES } from './palettes';
import { buildWaterfront } from './waterfront';

// The deterministic city generator (city design section 7.1; the prototype city-map-prototype/layout.py is its
// starting point). Part 1: the frame, the blocks and their lots, names and addresses. Part 2: the slope bands (their
// connectors, gaps and walk-ups). Part 3: the landmarks (special blocks), the waterfront and Hillcrest. Last, the
// doors and the POI selection (pois.ts).

/** FNV-1a of a stream name mixed with the seed: each district (and the namer) has its own random stream. */
export function districtSeed(seed: number, name: string): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export function generateLayout(cfg: CityConfig, names: NamesConfig, cat: CatalogIndex): CityLayout {
  if (cfg.size !== 1200) throw new Error(`generate: the city is 1200 m square (config size ${cfg.size})`);
  const rngs = new Map<string, Rng>();
  const rngOf = (stream: CityDistrict | 'waterfront'): Rng => {
    let r = rngs.get(stream);
    if (!r) rngs.set(stream, (r = mulberry32(districtSeed(cfg.seed, stream))));
    return r;
  };
  const namer = new Namer(names, mulberry32(districtSeed(cfg.seed, 'names')));
  const specials = specialBlocks(cfg);

  const blocks: Block[] = [];
  const roads: Road[] = [];
  const areas: Area[] = [];
  const hospitals: Hospital[] = [];
  const gasStations: GasStation[] = [];
  /** Every lot with the road it takes its address from (null: a prop, no name or address) */
  const placed: { lot: Lot; front: Road | null }[] = [];
  for (const level of BUILT_LEVELS) {
    const plans = levelBlocks(level, cfg);
    const levelRoadList = [...levelRoads(level, cfg, names), ...blockStreets(level, plans, cfg, names)];
    roads.push(...levelRoadList);
    const roadById = new Map(levelRoadList.map((r) => [r.id, r]));
    for (const plan of plans) {
      const special = specials.get(`${plan.level}:${plan.k}:${plan.row}`);
      const pal = PALETTES[plan.district];
      let filled: { lots: Lot[]; roads: Road[]; areas: Area[] };
      let alley = plan.alley;
      if (special) {
        const r = special(plan, pal, rngOf(plan.district), cat, cfg);
        if (r.hospital) hospitals.push(r.hospital);
        if (r.gasStation) gasStations.push(r.gasStation);
        alley = r.alley;
        filled = r;
      } else {
        filled = fillBlock(plan, pal, rngOf(plan.district), cat, cfg);
      }
      blocks.push({ ...toBlock(plan), alley });
      roads.push(...filled.roads);
      areas.push(...filled.areas);
      for (const lot of filled.lots) {
        const front = roadById.get(lot.facing === 'S' ? plan.south : plan.north);
        if (!front) throw new Error(`generate: lot ${lot.id} faces no road`);
        placed.push({ lot, front });
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
    const segments = freeSpans(0, cfg.size, used);
    const blockIds = new Set(slope.map((l) => l.block));
    segments.forEach((seg, i) => {
      const b = bandBlock(band, i, seg, cfg);
      if (blockIds.has(b.id)) blocks.push(b);
    });
    for (const lot of slope) placed.push({ lot, front });
  }

  const wf = buildWaterfront(cfg, rngOf('waterfront'), cat, names);
  const hc = buildHillcrest(cfg, rngOf('hillcrest'), cat, names);
  for (const part of [wf, hc]) {
    blocks.push(...part.blocks);
    areas.push(...part.areas);
    gasStations.push(part.gasStation);
    for (const lot of part.lots) placed.push({ lot, front: part.fronts.get(lot.id) ?? null });
  }
  roads.push(...wf.roads);

  // names last, so that no generated name takes a landmark's
  for (const { lot } of placed) if (lot.name !== '') namer.reserve(lot.name);
  const lots = placed.map(({ lot, front }): Lot => {
    if (lot.prop) return lot;
    const entry = cat.get(lot.asset);
    if (!front) throw new Error(`generate: lot ${lot.id} has no road for its address`);
    return { ...lot, name: lot.name || namer.lotName(entry), address: namer.address(lot, front, entry) };
  });
  const withPois = pickPois(assignDoors(lots, cat, cfg), cat, cfg, mulberry32(districtSeed(cfg.seed, 'pois')));

  return {
    version: 1,
    seed: cfg.seed,
    size: 1200,
    levels: cfg.levels,
    bands: cfg.bands,
    blocks,
    lots: withPois,
    roads,
    curvedRoads: [hc.curvedRoad],
    connectors,
    areas,
    hospitals,
    gasStations,
    orderRules: cfg.orderRules,
  };
}
