import {
  movementConfig,
  mulberry32,
  worldConfig,
  type Checkpoint,
  type CityMap,
  type PieceCatalog,
} from '@dm/shared';
import { cliffs, groundTiles, quays } from './boundary';
import { buildFiller, type CityFrame, type DistrictContext, type DistrictOutput, type DistrictReport } from './district';
import { buildDowntown } from './districts/downtown';
import { buildHarbor } from './districts/harbor';
import { buildHillside } from './districts/hillside';
import { buildHub } from './hub';
import { arterialLines, landRect } from './layout';
import type { CitySource, QuadrantDistrict, Template } from './source';
import { arterialGraph, mergeStreetGraphs, streetSolids } from './streets';

export {
  buildFiller,
  type CityFrame,
  type DistrictContext,
  type DistrictOutput,
  type DistrictReport,
  type PoiSlot,
} from './district';

/** Test metadata from each district builder (see DistrictReport); never written to city.json. */
export interface GenerationReport { districts: Partial<Record<QuadrantDistrict, Partial<DistrictReport>>> }

const BUILDERS: Record<Template, (ctx: DistrictContext) => DistrictOutput> = {
  downtown: buildDowntown,
  harbor: buildHarbor,
  hillside: buildHillside,
  suburbs: buildFiller,
};

/** FNV-1a of the district name mixed with the seed: each district has its own random stream. */
export function districtSeed(seed: number, name: string): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * Expands the city source into the placement file: ground, cliffs and quays, the hub, arterials with a checkpoint at
 * every crossing, then each district's builder output, merged in source order. Deterministic for a given source.
 */
export function generateCity(src: CitySource, pieces: PieceCatalog): CityMap {
  return generateCityWithReport(src, pieces).city;
}

/** generateCity, plus each district's report of what it built (gaps, alleys, pad targets…) for content tests. */
export function generateCityWithReport(src: CitySource, pieces: PieceCatalog): { city: CityMap; report: GenerationReport } {
  const chunkSize = worldConfig.chunkSize;
  const land = landRect(src);
  const arterials = arterialLines(src, land);
  const hub = buildHub(src);
  const frame: CityFrame = {
    land,
    arterials,
    plaza: { center: hub.hub.center, clearRadius: src.hub.clearRadius },
    streets: src.streets,
    palettes: src.buildingPalettes,
    chunkSize,
    waterEdges: src.boundary.waterEdges,
    checkpointSpacing: src.checkpoints.spacing,
  };

  const outputs = src.districts.map((d) =>
    BUILDERS[d.template]({
      district: d.district,
      rect: d.rect,
      rng: mulberry32(districtSeed(src.seed, d.district)),
      pieces,
      move: movementConfig,
      params: d.params,
      city: frame,
    }),
  );
  const all = <K extends Exclude<keyof DistrictOutput, 'report'>>(k: K): DistrictOutput[K] =>
    outputs.flatMap((o) => o[k] as unknown[]) as DistrictOutput[K];

  const streets = mergeStreetGraphs([arterialGraph(land, arterials, hub.hub, src.hub.clearRadius), ...outputs.map((o) => o.streets)]);

  const c = hub.hub.center;
  const crossings: Checkpoint[] = [];
  for (const z of arterials.zs) {
    for (const x of arterials.xs) {
      if (Math.hypot(x - c.x, z - c.z) < src.hub.clearRadius) continue;
      crossings.push({ id: `cp-${crossings.length}`, position: { x, y: src.streets.roadTop, z } });
    }
  }

  const report: GenerationReport = { districts: {} };
  src.districts.forEach((d, k) => {
    const r = outputs[k]!.report;
    if (r) report.districts[d.district] = r;
  });

  const city: CityMap = {
    kind: 'city',
    seed: src.seed,
    size: src.size,
    chunkSize,
    districts: src.districts.map((d) => ({ district: d.district, rect: d.rect })),
    hub: hub.hub,
    solids: [
      ...groundTiles(src, chunkSize),
      ...cliffs(src, chunkSize),
      ...quays(src, chunkSize),
      ...hub.solids,
      ...streetSolids(streets, src.streets, chunkSize),
      ...all('solids'),
    ],
    props: all('props'),
    zipLines: all('zipLines'),
    jumpPads: all('jumpPads'),
    boostOrbs: all('boostOrbs'),
    rails: all('rails'),
    checkpoints: [hub.checkpoint, ...crossings, ...all('checkpoints')],
    pois: [],
    streets,
    navLinks: all('navLinks'),
    thiefSpawns: [],
  };
  return { city, report };
}
