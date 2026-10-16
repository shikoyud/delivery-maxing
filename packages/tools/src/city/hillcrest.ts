import {
  lotSize,
  vec3,
  type Area,
  type Block,
  type CatalogIndex,
  type CityConfig,
  type CurvedRoad,
  type GasStation,
  type Lot,
  type NamesConfig,
  type Rng,
  type Road,
} from '@dm/shared';
import { bandConnectors } from './bands';
import { lotPlacer } from './blocks';
import { gasLot } from './landmarks';
import { PALETTES, pickLot } from './palettes';

// The ridge (city design sections 2 and 4): Hillcrest Drive winding along it, detached houses on 15 x 16 m plots both
// sides of the drive, the lookout park, the Hillcrest gas station and the cliff behind, as the prototype's ridge section.

export interface Hillcrest {
  curvedRoad: CurvedRoad;
  lots: Lot[];
  areas: Area[];
  blocks: Block[];
  gasStation: GasStation;
  /** The road each lot takes its address from: Hillcrest Drive where the lot is (a thin east-west rect at the drive's z) */
  fronts: Map<string, Road | null>;
}

/** The drive's centre line: driveZ + driveAmplitude * sin(2 pi x / drivePeriod). */
export function driveZ(x: number, cfg: CityConfig): number {
  const h = cfg.hillcrest;
  return h.driveZ + h.driveAmplitude * Math.sin((2 * Math.PI * x) / h.drivePeriod);
}

/**
 * The z range the drive covers over x in [x0, x1]: its centre line +- half its width, taken over x0 - half .. x1 + half
 * (a point of the edge is at most half a width from its centre point in x and in z), sampled every 0.25 m.
 */
export function driveSpan(x0: number, x1: number, cfg: CityConfig): [number, number] {
  const half = cfg.hillcrest.driveWidth / 2;
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = x0 - half; ; x += 0.25) {
    const xs = Math.min(x, x1 + half);
    const z = driveZ(xs, cfg);
    lo = Math.min(lo, z - half);
    hi = Math.max(hi, z + half);
    if (xs >= x1 + half) break;
  }
  return [lo, hi];
}

const overlaps = (a0: number, a1: number, b0: number, b1: number): boolean => a0 < b1 && b0 < a1;
/** Away from the drive to the next 0.5 m, so lot and park edges are round numbers */
const north = (z: number): number => Math.ceil(z * 2 - 1e-9) / 2;
const south = (z: number): number => Math.floor(z * 2 + 1e-9) / 2;

export function buildHillcrest(cfg: CityConfig, rng: Rng, cat: CatalogIndex, names: NamesConfig): Hillcrest {
  const h = cfg.hillcrest;
  const ridge = cfg.levels.ridge;
  const y = ridge.y;
  const name = names.streets.avenues[4]!;
  const polyline = Array.from({ length: Math.floor(cfg.size / h.driveStep) + 1 }, (_, i) => vec3(i * h.driveStep, y, driveZ(i * h.driveStep, cfg)));
  const curvedRoad: CurvedRoad = { id: 'road-ridge-drive', polyline, width: h.driveWidth };
  const blockId = 'block-ridge-hillcrest';
  const placer = lotPlacer({ idPrefix: 'lot-ridge', level: 'ridge', district: 'hillcrest', block: blockId, y }, PALETTES.hillcrest, rng, cat, cfg);
  const fronts = new Map<string, Road | null>();
  const addressRoad = (lot: Lot): Road => {
    const z = driveZ((lot.rect.minX + lot.rect.maxX) / 2, cfg);
    return { id: curvedRoad.id, kind: 'lane', rect: { minX: 0, minZ: z - h.driveWidth / 2, maxX: cfg.size, maxZ: z + h.driveWidth / 2 }, y, name };
  };

  // the gas station south of the drive, beside the band D switchback at x 876; no houses between it and the drive
  const gas = gasLot(placer, h.gas.name, h.gas.x, h.gas.z, y, 'hillcrest', cat, cfg);
  for (const l of gas.lots) fronts.set(l.id, addressRoad(l));
  // keep the south side open where a car comes up a band D switchback, and in front of the gas station
  const sw = cfg.switchback.width / 2;
  const gaps: [number, number][] = [
    ...bandConnectors('D', cfg)
      .filter((c) => c.kind === 'switchback')
      .map((c): [number, number] => [c.x - sw - h.mouthClearance, c.x + sw + h.mouthClearance]),
    [gas.area.rect.minX - h.mouthClearance, gas.area.rect.maxX + h.mouthClearance],
  ];

  for (let x = h.x0; x < cfg.size - h.endMargin; x += h.slot) {
    if (overlaps(x, x + h.lot, h.parkX0, h.parkX1)) continue;
    const [lo, hi] = driveSpan(x, x + h.lot, cfg);
    for (const facing of ['S', 'N'] as const) {
      if (facing === 'N' && gaps.some(([a, e]) => overlaps(x, x + h.lot, a, e))) continue;
      const e = pickLot(PALETTES.hillcrest, rng, h.lot, h.depth, cat);
      if (!e) throw new Error('hillcrest: no house fits a plot');
      const { w } = lotSize(e);
      const lot = placer.place(e, x + (h.lot - w) / 2, facing === 'S' ? north(hi + h.setback) : south(lo - h.setback), facing);
      fronts.set(lot.id, addressRoad(lot));
    }
  }

  // the lookout park either side of the drive (the drive itself stays a road)
  const [plo, phi] = driveSpan(h.parkX0, h.parkX1, cfg);
  const areas: Area[] = [
    gas.area,
    { id: 'area-ridge-park-south', kind: 'park', rect: { minX: h.parkX0, minZ: h.parkZ0, maxX: h.parkX1, maxZ: south(plo - h.setback) }, y, district: 'hillcrest' },
    { id: 'area-ridge-park-north', kind: 'park', rect: { minX: h.parkX0, minZ: north(phi + h.setback), maxX: h.parkX1, maxZ: h.parkZ1 }, y, district: 'hillcrest' },
    { id: 'area-ridge-cliff', kind: 'cliff', rect: { minX: 0, minZ: h.cliff.z0, maxX: cfg.size, maxZ: h.cliff.z1 }, y: h.cliff.y, district: 'hillcrest' },
  ];
  const block: Block = { id: blockId, rect: { minX: 0, minZ: ridge.z0, maxX: cfg.size, maxZ: h.cliff.z0 }, level: 'ridge', district: 'hillcrest', alley: false };
  return { curvedRoad, lots: placer.lots, areas, blocks: [block], gasStation: gas.station, fronts };
}
