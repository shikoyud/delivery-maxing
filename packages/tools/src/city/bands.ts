import {
  connectorExtent,
  lotSize,
  switchbackGeometry,
  vec3,
  type Area,
  type BandId,
  type Block,
  type CatalogIndex,
  type CityConfig,
  type Connector,
  type Level,
  type Lot,
  type Rng,
} from '@dm/shared';
import { crossStreetXs } from './frame';
import { PALETTES, pickLot } from './palettes';

// The slope bands (city design section 2.1): where the switchbacks, steep lanes and staircases go (the prototype's
// SW_K, LANE_K and STAIR_X), the band gaps they cut, and the walk-ups built into bands B and C.

export const BANDS: readonly BandId[] = ['A', 'B', 'C', 'D'];
/** The level at the foot of each band. */
export const BAND_LOWER: Record<BandId, Level> = { A: 'L0', B: 'L1', C: 'L2', D: 'L3' };

type Span = [number, number];
const EPS = 1e-9;
const overlaps = (a: Span, b: Span): boolean => a[0] < b[1] - EPS && b[0] < a[1] - EPS;

/**
 * The band's connectors, west to east within each kind: switchbacks on the `switchbackK` cross streets, steep lanes
 * `laneOffset` east of the `laneK` cross streets (moved `laneShift` east while they overlap, or west from where they
 * started when that runs off the city), staircases at `stairX` (moved `stairShift` east while they overlap; at the
 * city edge, to the nearest free spot beside what they overlap). No two connectors' extents overlap.
 */
export function bandConnectors(band: BandId, cfg: CityConfig): Connector[] {
  const b = cfg.bands[band];
  const sb = cfg.slopeBands;
  const xs = crossStreetXs(cfg);
  const used: Span[] = [];
  const out: Connector[] = [];
  const make = (kind: Connector['kind'], i: number, x: number): Connector => ({ id: `conn-${band}-${kind}-${i}`, kind, band, x, ...b });
  const inCity = (e: Span) => e[0] >= -EPS && e[1] <= cfg.size + EPS;
  const free = (e: Span) => inCity(e) && !used.some((u) => overlaps(u, e));
  const take = (c: Connector): void => {
    const e = connectorExtent(c, cfg);
    if (!free(e)) throw new Error(`bands: ${c.id} at x ${c.x} overlaps another connector or leaves the city`);
    used.push(e);
    out.push(c);
  };
  sb.switchbackK[band].forEach((k, i) => {
    const sw = make('switchback', i, xs[k]!);
    // each leg is given its configured x span, or more when half the rise needs a longer run at the grade
    const deep = b.z1 - b.z0 >= cfg.switchback.deepBandMin;
    sw.legLength = Math.max(deep ? cfg.switchback.legLength : cfg.switchback.legLengthShallow, switchbackGeometry({ ...sw, legLength: 0 }, cfg.switchback).run);
    take(sw);
  });
  sb.laneK[band].forEach((k, i) => {
    const start = xs[k]! + sb.laneOffset;
    const east = (() => {
      for (let x = start; ; x += sb.laneShift) {
        const e = connectorExtent(make('steepLane', i, x), cfg);
        if (!inCity(e)) return null;
        if (free(e)) return x;
      }
    })();
    let x = east;
    for (let w = start - sb.laneShift; x === null && w >= 0; w -= sb.laneShift) if (free(connectorExtent(make('steepLane', i, w), cfg))) x = w;
    if (x === null) throw new Error(`bands: no room for steep lane ${i} of band ${band}`);
    take(make('steepLane', i, x));
  });
  sb.stairX[band].forEach((sx, i) => {
    const east = (() => {
      for (let x = sx; ; x += sb.stairShift) {
        const e = connectorExtent(make('stairs', i, x), cfg);
        if (!inCity(e)) return null;
        if (free(e)) return x;
      }
    })();
    if (east !== null) return take(make('stairs', i, east));
    // At the city edge: the free spot nearest sx that touches one of the connectors already placed.
    const half = cfg.stairs.width / 2;
    const spots = used.flatMap(([a, e]) => [a - half, e + half]).filter((x) => free([x - half, x + half]));
    if (spots.length === 0) throw new Error(`bands: no room for staircase ${i} of band ${band}`);
    spots.sort((p, q) => Math.abs(p - sx) - Math.abs(q - sx) || p - q);
    take(make('stairs', i, spots[0]!));
  });
  return out;
}

/** The band gap under each switchback and steep lane: its x-extent, the band deep, floored at the lower level. */
export function bandGaps(band: BandId, connectors: Connector[], cfg: CityConfig): Area[] {
  const b = cfg.bands[band];
  return connectors
    .filter((c) => c.band === band && c.kind !== 'stairs')
    .map((c) => {
      const [minX, maxX] = connectorExtent(c, cfg);
      return { id: `area-gap-${c.id}`, kind: 'bandGap', rect: { minX, minZ: b.z0, maxX, maxZ: b.z1 }, y: b.y0, district: 'slope' };
    });
}

/** The stretches of band terrain between the connector extents, west to east (the band's blocks). */
export function bandSegments(used: Span[], size: number): Span[] {
  const out: Span[] = [];
  let x = 0;
  for (const [a, e] of [...used].sort((p, q) => p[0] - q[0])) {
    if (a - x > 1e-3) out.push([x, a]);
    x = Math.max(x, e);
  }
  if (size - x > 1e-3) out.push([x, size]);
  return out;
}

export const bandBlockId = (band: BandId, i: number): string => `block-band-${band}-${i}`;

/** The layout block of band segment `i`: the stretch of terrace the walk-ups stand in. */
export function bandBlock(band: BandId, i: number, seg: Span, cfg: CityConfig): Block {
  const b = cfg.bands[band];
  return { id: bandBlockId(band, i), rect: { minX: seg[0], minZ: b.z0, maxX: seg[1], maxZ: b.z1 }, level: BAND_LOWER[band], district: 'slope', alley: false };
}

/**
 * The walk-ups built into a band (`slopeLots.bands`: B and C), as the prototype: 8 m slots from the west, skipping
 * slots within `clearance` of a connector extent, `chance` of a walk-up from the `slope` palette in each free slot.
 * A walk-up stands on the lower street (front at z0, base at y0) with its roofline at the upper level and an upper door
 * on its back wall at y1. Names, addresses and front doors are left empty (generate.ts and the POI pass give them).
 */
export function slopeLots(band: BandId, used: Span[], rng: Rng, cat: CatalogIndex, cfg: CityConfig): Lot[] {
  const sl = cfg.slopeBands.slopeLots;
  if (!sl.bands.includes(band)) return [];
  const b = cfg.bands[band];
  const segments = bandSegments(used, cfg.size);
  const blocked = (a: number, e: number) => used.some(([u0, u1]) => a < u1 + sl.clearance && u0 - sl.clearance < e);
  const lots: Lot[] = [];
  let x = sl.x0;
  while (x < cfg.size - sl.endMargin) {
    if (blocked(x, x + sl.slot)) {
      x += sl.skip;
      continue;
    }
    if (rng() >= sl.chance) {
      x += sl.slot;
      continue;
    }
    const e = pickLot(PALETTES.slope, rng, sl.slot, b.z1 - b.z0, cat);
    if (!e) throw new Error('bands: no slope walk-up fits an 8 m slot');
    const { w, d } = lotSize(e);
    const seg = segments.findIndex(([a, s]) => x >= a - EPS && x + w <= s + EPS);
    if (seg < 0) throw new Error(`bands: walk-up at x ${x} of band ${band} is in no band segment`);
    lots.push({
      id: `lot-band-${band}-${lots.length}`,
      asset: e.id,
      rect: { minX: x, minZ: b.z0, maxX: x + w, maxZ: b.z0 + d },
      y: b.y0,
      facing: 'S',
      level: BAND_LOWER[band],
      district: 'slope',
      block: bandBlockId(band, seg),
      name: '',
      address: '',
      door: null,
      upperDoor: { position: vec3(x + w / 2, b.y1, b.z0 + d), y: b.y1 },
      prop: false,
      open: false,
    });
    x += w + sl.spacing;
  }
  return lots;
}
