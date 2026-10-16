import {
  lotSize,
  type Area,
  type Block,
  type CatalogIndex,
  type CityConfig,
  type CityDistrict,
  type GasStation,
  type Lot,
  type NamesConfig,
  type Rect,
  type Rng,
  type Road,
} from '@dm/shared';
import { lotPlacer, type LotPlacer } from './blocks';
import { roadId } from './frame';
import { gasLot } from './landmarks';
import { PALETTES, pickLot } from './palettes';

// The waterfront, L0 (city design sections 2 and 4): Harbor Road, the docks (quay, rail, container yard, cranes,
// warehouses, factories, silos, the station, the dock lanes and Depot Street), the beach (sand, boardwalk, bars,
// hotels, the Ferris wheel) and Old Harbor (quay, pier, breakwater, lighthouse, marina, Quay Street, the alley, three
// rows of harbour lots), as the prototype's waterfront section.

export interface Waterfront {
  lots: Lot[];
  roads: Road[];
  areas: Area[];
  blocks: Block[];
  gasStation: GasStation;
  /** The road each lot takes its address from (a street, or the boardwalk / breakwater for the bars and the lighthouse); null for a prop */
  fronts: Map<string, Road | null>;
}

/** The shoreline: the docks quay, the beach crescent (shoreZ + crescent * sin), the Old Harbor quay. */
export function shore(x: number, cfg: CityConfig): number {
  const b = cfg.beach;
  if (x < b.x0) return cfg.docks.quayZ;
  if (x <= b.x1) return b.shoreZ + b.crescent * Math.sin((Math.PI * (x - b.x0)) / (b.x1 - b.x0));
  return cfg.harbor.quayZ;
}

const EPS = 1e-9;
const rect = (minX: number, minZ: number, maxX: number, maxZ: number): Rect => ({ minX, minZ, maxX, maxZ });

/**
 * The nearest road on the side a lot faces that its front edge runs along: S looks south, N north, W west, E east.
 * Null when there is none.
 */
export function frontRoad(lot: Lot, roads: Road[]): Road | null {
  const l = lot.rect;
  let best: Road | null = null;
  let bestD = Infinity;
  for (const r of roads) {
    const q = r.rect;
    const alongX = q.minX < l.maxX - EPS && l.minX < q.maxX - EPS;
    const alongZ = q.minZ < l.maxZ - EPS && l.minZ < q.maxZ - EPS;
    const d =
      lot.facing === 'S' ? (alongX && q.maxZ <= l.minZ + EPS ? l.minZ - q.maxZ : Infinity)
      : lot.facing === 'N' ? (alongX && q.minZ >= l.maxZ - EPS ? q.minZ - l.maxZ : Infinity)
      : lot.facing === 'W' ? (alongZ && q.maxX <= l.minX + EPS ? l.minX - q.maxX : Infinity)
      : alongZ && q.minX >= l.maxX - EPS ? q.minX - l.maxX : Infinity;
    if (d < bestD) [best, bestD] = [r, d];
  }
  return best;
}

/** The smallest rect holding `base` and every lot of the block. */
function blockOf(id: string, base: Rect, lots: Lot[], district: CityDistrict, alley: boolean): Block {
  const r = { ...base };
  for (const l of lots) {
    r.minX = Math.min(r.minX, l.rect.minX);
    r.minZ = Math.min(r.minZ, l.rect.minZ);
    r.maxX = Math.max(r.maxX, l.rect.maxX);
    r.maxZ = Math.max(r.maxZ, l.rect.maxZ);
  }
  return { id, rect: r, level: 'L0', district, alley };
}

export function buildWaterfront(cfg: CityConfig, rng: Rng, cat: CatalogIndex, names: NamesConfig): Waterfront {
  const y = cfg.levels.L0.y;
  const size = cfg.size;
  const roadZ = cfg.levels.L0.z1 - cfg.avenue;
  const roads: Road[] = [];
  const areas: Area[] = [];
  const blocks: Block[] = [];
  const fronts = new Map<string, Road | null>();
  const area = (id: string, kind: Area['kind'], r: Rect, district: CityDistrict, ay = y): void => {
    areas.push({ id: `area-L0-${id}`, kind, rect: r, y: ay, district });
  };
  const placer = (name: string, district: CityDistrict, pal = PALETTES[district]): LotPlacer =>
    lotPlacer({ idPrefix: `lot-L0-${name}`, level: 'L0', district, block: `block-L0-${name}`, y }, pal, rng, cat, cfg);

  const harborRoad: Road = { id: roadId.avenue('L0'), kind: 'avenue', rect: rect(0, roadZ, size, cfg.levels.L0.z1), y, name: names.streets.avenues[0]! };
  roads.push(harborRoad);

  // ------------------------------------------------------------------ the docks
  const d = cfg.docks;
  const b = cfg.beach;
  const docks = placer('docks', 'docks');
  area('docks-quay', 'quay', rect(0, d.quayZ, b.x0, roadZ), 'docks');
  area('rail', 'rail', rect(0, d.railZ0, d.railX1, d.railZ1), 'docks');
  area('container-yard', 'containerYard', rect(d.yard.x0, d.yard.z0, d.yard.x1, d.yard.z1), 'docks');
  const container = cat.get('missing/Container_01');
  for (let i = 0; i < d.containerCols; i++) {
    for (let j = 0; j < d.containerRows; j++) {
      // lengthwise along x: a W-facing lot is its catalog depth along x
      docks.place(container, d.containers.x0 + i * d.containers.dx, d.containers.z0 + j * d.containers.dz, 'W', { stack: 1 + ((i + j) % d.containers.stackMax) });
    }
  }
  for (const c of d.cranes) docks.place(cat.get('missing/Crane_01'), c.x, c.z, 'W');
  for (const bd of d.buildings) docks.place(cat.get(bd.asset), bd.x, bd.z, bd.facing);
  const dockRoads: Road[] = [
    { id: 'road-L0-docks-street', kind: 'street', rect: rect(d.street.x0, d.street.z0, d.street.x1, roadZ), y, name: names.streets.docks.street },
    ...d.lanes.map((l, i): Road => {
      const name = names.streets.docks.lanes[i];
      if (name === undefined) throw new Error(`names: no name for dock lane ${i}`);
      return { id: `road-L0-docks-lane-${i}`, kind: 'dockLane', rect: rect(l.x0, l.z0, l.x1, l.z1), y, name };
    }),
  ];
  roads.push(...dockRoads);
  for (const l of docks.lots) fronts.set(l.id, l.prop ? null : frontRoad(l, [harborRoad, ...dockRoads]));
  const dockGas = gasLot(docks, d.gas.name, d.gas.x, d.gas.z, y, 'docks', cat, cfg);
  areas.push(dockGas.area);
  for (const l of dockGas.lots) fronts.set(l.id, harborRoad);
  blocks.push(blockOf('block-L0-docks', rect(0, d.quayZ, b.x0, roadZ), docks.lots, 'docks', false));

  // ------------------------------------------------------------------ the beach
  const beach = placer('beach', 'beach');
  for (let x = b.x0, i = 0; x < b.x1 - EPS; x += b.sandStep, i++) {
    area(`sand-${i}`, 'sand', rect(x, shore(x + b.sandStep / 2, cfg), Math.min(x + b.sandStep, b.x1), b.boardwalkZ0), 'beach', b.sandY);
  }
  const boardwalk = rect(b.x0, b.boardwalkZ0, b.x1, b.boardwalkZ1);
  area('boardwalk', 'boardwalk', boardwalk, 'beach');
  const boardwalkRoad: Road = { id: 'boardwalk', kind: 'street', rect: boardwalk, y, name: names.streets.boardwalk };
  for (let x = b.bars.x0, i = 0; x < b.bars.x1; x += b.bars.slot, i++) {
    if (i % b.bars.every !== 0) continue;
    const asset = b.bars.assets[Math.floor(rng() * b.bars.assets.length)]!;
    fronts.set(beach.place(cat.get(asset), x, b.boardwalkZ0 - b.bars.gap, 'N', { y: b.sandY }).id, boardwalkRoad);
  }
  // hotels front Harbor Road and back onto the boardwalk
  for (let x = b.hotels.x0; x < b.hotels.x1; ) {
    const e = pickLot(PALETTES.beach, rng, b.hotels.x1 - x, Math.min(b.hotels.maxD, roadZ - b.boardwalkZ1), cat);
    if (!e) break;
    const lot = beach.place(e, x, roadZ, 'N');
    fronts.set(lot.id, harborRoad);
    x = lot.rect.maxX + b.hotels.gap;
  }
  const fw = b.ferrisWheel;
  if (cat.has(fw.asset)) fronts.set(beach.place(cat.get(fw.asset), fw.x, fw.z, 'S', { y: b.sandY }).id, null);
  blocks.push(blockOf('block-L0-beach', rect(b.x0, shore((b.x0 + b.x1) / 2, cfg), b.x1, roadZ), beach.lots, 'beach', false));

  // ------------------------------------------------------------------ Old Harbor
  const h = cfg.harbor;
  const bw = h.breakwater;
  area('harbor-quay', 'quay', rect(b.x1, h.quayZ, size, roadZ), 'harbor');
  area('pier', 'pier', rect(h.pierX, h.pierZ0, h.pierX + h.pierWidth, h.quayZ), 'harbor');
  area('breakwater', 'breakwater', rect(bw.x0, bw.z0, bw.x1, bw.z1), 'harbor');
  // the breakwater's arm back to the quay, so the lighthouse can be walked to
  area('breakwater-arm', 'breakwater', rect(bw.armX0, bw.z1, bw.x1, h.quayZ), 'harbor');
  area('marina', 'marina', rect(h.marina.x0, h.marina.z0, h.marina.x1, h.marina.z1), 'harbor', h.marina.y);
  const quayStreet: Road = { id: 'road-L0-quay', kind: 'street', rect: rect(b.x1, h.quayStreet.z0, size, h.quayStreet.z1), y, name: names.streets.quay };
  const alley: Road = { id: 'road-L0-harbor-alley', kind: 'alley', rect: rect(b.x1, h.alley.z0, size, h.alley.z1), y, name: null };
  roads.push(quayStreet, alley);

  const quay = placer('harbor-quay', 'harbor');
  const lh = cat.get(h.lighthouse.asset);
  const breakwaterRoad: Road = { id: 'breakwater', kind: 'street', rect: rect(bw.x0, bw.z0, bw.x1, bw.z1), y, name: names.streets.breakwater };
  fronts.set(quay.place(lh, h.lighthouse.x, (bw.z0 + bw.z1) / 2 + lotSize(lh).d / 2, 'N', { name: 'Lighthouse' }).id, breakwaterRoad);
  const inner = placer('harbor', 'harbor');
  for (const row of h.rows) {
    const p = row.z <= h.quayStreet.z0 ? quay : inner;
    for (let x = h.x0; x < h.x1; ) {
      const e = pickLot(PALETTES.harbor, rng, h.x1 - x, row.maxD, cat);
      if (!e) break;
      const lot = p.place(e, x, row.z, row.facing);
      fronts.set(lot.id, frontRoad(lot, [quayStreet, harborRoad]));
      x = lot.rect.maxX;
    }
  }
  blocks.push(blockOf('block-L0-harbor-quay', rect(b.x1, h.quayZ, size, h.quayStreet.z0), quay.lots, 'harbor', false));
  blocks.push(blockOf('block-L0-harbor', rect(b.x1, h.quayStreet.z1, size, roadZ), inner.lots, 'harbor', true));

  return { lots: [...docks.lots, ...beach.lots, ...quay.lots, ...inner.lots], roads, areas, blocks, gasStation: dockGas.station, fronts };
}
