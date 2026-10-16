import {
  lotSize,
  type Area,
  type Block,
  type CatalogEntry,
  type CatalogIndex,
  type CityConfig,
  type Facing,
  type Lot,
  type NamesConfig,
  type Rect,
  type Rng,
  type Road,
} from '@dm/shared';
import { blockColumns, districtOf, roadId, type BuiltLevel } from './frame';
import { pickLot, type Palette } from './palettes';

// Street blocks (city design section 4): rows of blocks from the avenue up to the top street in every column, and the
// lots that fill a block wall to wall, as the prototype's build_level / block / fill_row.

export type OpenKind = 'park' | 'sports' | 'parking' | 'plaza';
const OPEN_KINDS: readonly OpenKind[] = ['park', 'sports', 'parking', 'plaza'];

/** A block as the generator plans it; `Block` is what the layout stores. */
export interface BlockPlan extends Block {
  level: BuiltLevel;
  k: number;
  row: number;
  /** Not null for an open block (no buildings): what it is instead */
  open: OpenKind | null;
  /** Ids of the east-west roads along the block's south and north sides */
  south: string;
  north: string;
}

/**
 * The blocks of a built level, column by column and south to north. Rows are `blockDepth.dense` deep in a dense
 * district and `blockDepth.alley` elsewhere, with a street between rows; a remainder too small for another row and its
 * street is absorbed into the last row. In `blockFill.openDistricts`, every `openEvery`-th block is open, the kind
 * cycling park / sports / parking / plaza.
 */
export function levelBlocks(level: BuiltLevel, cfg: CityConfig): BlockPlan[] {
  const { z0, z1 } = cfg.levels[level];
  const shallow = cfg.blockDepth.alley;
  const top = z1 - cfg.street;
  const out: BlockPlan[] = [];
  for (const { k, x0, x1 } of blockColumns(cfg)) {
    const district = districtOf(level, (x0 + x1) / 2, cfg);
    const denseDistrict = cfg.blockFill.denseDistricts.includes(district);
    const openable = cfg.blockFill.openDistricts.includes(district);
    const depth = denseDistrict ? cfg.blockDepth.dense : shallow;
    let z = z0 + cfg.avenue;
    let row = 0;
    while (top - z >= shallow) {
      let d = top - z >= depth ? depth : shallow;
      const rest = top - z - d;
      if (rest > 0 && rest < shallow + cfg.street) d = top - z;
      const zEnd = z + d;
      const dense = denseDistrict && d >= cfg.blockDepth.dense;
      const open = openable && (k + row) % cfg.openEvery === 0 ? OPEN_KINDS[(k * 7 + row * 3) % OPEN_KINDS.length]! : null;
      out.push({
        id: `block-${level}-${k}-${row}`,
        rect: { minX: x0, minZ: z, maxX: x1, maxZ: zEnd },
        level,
        district,
        alley: !dense && open === null,
        k,
        row,
        open,
        south: row === 0 ? roadId.avenue(level) : roadId.row(level, k, row - 1),
        north: zEnd < top ? roadId.row(level, k, row) : roadId.top(level),
      });
      z = zEnd + cfg.street;
      row++;
    }
  }
  return out;
}

/** The east-west streets between a column's rows (the one north of each block that is not the last). */
export function blockStreets(level: BuiltLevel, blocks: BlockPlan[], cfg: CityConfig, names: NamesConfig): Road[] {
  const y = cfg.levels[level].y;
  const roads: Road[] = [];
  for (const b of blocks) {
    if (b.level !== level || b.north === roadId.top(level)) continue;
    const name = names.streets.rows[level][b.row];
    if (name === undefined) throw new Error(`names: no street name for row ${b.row} of ${level}`);
    roads.push({ id: b.north, kind: 'street', rect: { minX: b.rect.minX, minZ: b.rect.maxZ, maxX: b.rect.maxX, maxZ: b.rect.maxZ + cfg.street }, y, name });
  }
  return roads;
}

/** The layout's record of a planned block. */
export function toBlock(b: BlockPlan): Block {
  return { id: b.id, rect: b.rect, level: b.level, district: b.district, alley: b.alley };
}

/**
 * The lots of a block: two rows facing the block's south and north streets, wall to wall from the west end, with an
 * alley road between them unless the block is dense. An open block is an area instead, with the two sports courts or
 * the car park as open lots. Names and addresses are left empty (generate.ts gives them).
 */
export function fillBlock(
  block: BlockPlan,
  pal: Palette,
  rng: Rng,
  cat: CatalogIndex,
  cfg: CityConfig,
): { lots: Lot[]; roads: Road[]; areas: Area[] } {
  const { level, k, row, district } = block;
  const { minX: x0, maxX: x1, minZ: z0, maxZ: z1 } = block.rect;
  const y = cfg.levels[level].y;
  const lots: Lot[] = [];
  const place = (e: CatalogEntry, x: number, zFront: number, facing: Facing, open = false): number => {
    const { w, d } = lotSize(e);
    const rect: Rect = facing === 'S' ? { minX: x, minZ: zFront, maxX: x + w, maxZ: zFront + d } : { minX: x, minZ: zFront - d, maxX: x + w, maxZ: zFront };
    lots.push({
      id: `lot-${level}-${k}-${row}-${lots.length}`,
      asset: e.id,
      rect,
      y,
      facing,
      level,
      district,
      block: block.id,
      name: '',
      address: '',
      door: null,
      upperDoor: null,
      prop: e.category === 'prop',
      open,
    });
    return w;
  };
  const fillRow = (zFront: number, facing: Facing, maxD: number): void => {
    let x = x0;
    while (x1 - x >= cfg.blockFill.minGap) {
      const e = pickLot(pal, rng, x1 - x, maxD, cat);
      if (!e) break;
      x += place(e, x, zFront, facing);
    }
  };

  if (block.open) {
    const f = cfg.blockFill;
    if (block.open === 'sports') {
      place(cat.get('mega/FootballPlayground_01'), x0 + f.sportsInset, z0 + f.sportsInset, 'S', true);
      place(cat.get('mega/BasketballPlayground_01'), x0 + f.sportsInset + f.sportsSpacing, z0 + f.sportsInset, 'S', true);
    } else if (block.open === 'parking') {
      place(cat.get('mega/ParkingZone_01'), x0 + f.parkingInset, z0, 'S', true);
    }
    return { lots, roads: [], areas: [{ id: `area-${level}-${k}-${row}`, kind: block.open, rect: block.rect, y, district }] };
  }
  const depth = z1 - z0;
  if (!block.alley) {
    fillRow(z0, 'S', depth / 2);
    fillRow(z1, 'N', depth / 2);
    return { lots, roads: [], areas: [] };
  }
  const mid = (z0 + z1) / 2;
  const alley: Road = { id: roadId.alley(level, k, row), kind: 'alley', rect: { minX: x0, minZ: mid - cfg.alley / 2, maxX: x1, maxZ: mid + cfg.alley / 2 }, y, name: null };
  const half = depth / 2 - cfg.alley / 2;
  fillRow(z0, 'S', half);
  fillRow(z1, 'N', half);
  return { lots, roads: [alley], areas: [] };
}
