import {
  lotSize,
  type Area,
  type Block,
  type CatalogEntry,
  type CatalogIndex,
  type CityConfig,
  type CityDistrict,
  type Facing,
  type Level,
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

/** A lot's rectangle: S / N front on z (its south / north edge), W / E front on x (its west / east edge), z its south end. */
export function lotRect(x: number, z: number, facing: Facing, w: number, d: number): Rect {
  switch (facing) {
    case 'S':
      return { minX: x, minZ: z, maxX: x + w, maxZ: z + d };
    case 'N':
      return { minX: x, minZ: z - d, maxX: x + w, maxZ: z };
    case 'W':
      return { minX: x, minZ: z, maxX: x + d, maxZ: z + w };
    case 'E':
      return { minX: x - d, minZ: z, maxX: x, maxZ: z + w };
  }
}

export interface PlaceOptions {
  open?: boolean;
  /** Base height when not the level's (beach bars on the sand) */
  y?: number;
  /** A fixed name (a landmark, a hospital, a gas station); empty lets generate.ts name the lot */
  name?: string;
  stack?: number;
}

/** Places lots of one block (ids `<idPrefix>-<n>`) and fills rows of them wall to wall from a palette. */
export interface LotPlacer {
  readonly lots: Lot[];
  /** A lot of the entry's `lotSize` with its front at (x, zFront) (see `lotRect`) */
  place(e: CatalogEntry, x: number, zFront: number, facing: Facing, opts?: PlaceOptions): Lot;
  /**
   * A row facing `facing` with its fronts on `zFront`, wall to wall from x0 until less than `blockFill.minGap` is left
   * before x1 or nothing from the palette fits in `maxD`, as the prototype's fill_row.
   */
  fillRow(x0: number, x1: number, zFront: number, facing: 'N' | 'S', maxD: number): void;
}

export function lotPlacer(
  at: { idPrefix: string; level: Level; district: CityDistrict; block: string; y: number },
  pal: Palette,
  rng: Rng,
  cat: CatalogIndex,
  cfg: CityConfig,
): LotPlacer {
  const lots: Lot[] = [];
  const place = (e: CatalogEntry, x: number, zFront: number, facing: Facing, opts: PlaceOptions = {}): Lot => {
    const { w, d } = lotSize(e);
    const lot: Lot = {
      id: `${at.idPrefix}-${lots.length}`,
      asset: e.id,
      rect: lotRect(x, zFront, facing, w, d),
      y: opts.y ?? at.y,
      facing,
      level: at.level,
      district: at.district,
      block: at.block,
      name: opts.name ?? '',
      address: '',
      door: null,
      upperDoor: null,
      prop: e.category === 'prop',
      open: opts.open ?? false,
      ...(opts.stack !== undefined ? { stack: opts.stack } : {}),
    };
    lots.push(lot);
    return lot;
  };
  const fillRow = (x0: number, x1: number, zFront: number, facing: 'N' | 'S', maxD: number): void => {
    let x = x0;
    while (x1 - x >= cfg.blockFill.minGap) {
      const e = pickLot(pal, rng, x1 - x, maxD, cat);
      if (!e) break;
      x = place(e, x, zFront, facing).rect.maxX;
    }
  };
  return { lots, place, fillRow };
}

/** The placer for a planned block: ids `lot-<level>-<k>-<row>-<n>`, the block's level height and district. */
export function blockPlacer(block: BlockPlan, pal: Palette, rng: Rng, cat: CatalogIndex, cfg: CityConfig): LotPlacer {
  const { level, k, row, district } = block;
  return lotPlacer({ idPrefix: `lot-${level}-${k}-${row}`, level, district, block: block.id, y: cfg.levels[level].y }, pal, rng, cat, cfg);
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
  const { lots, place, fillRow } = blockPlacer(block, pal, rng, cat, cfg);

  if (block.open) {
    const f = cfg.blockFill;
    if (block.open === 'sports') {
      place(cat.get(f.sportsAssets[0]), x0 + f.sportsInset, z0 + f.sportsInset, 'S', { open: true });
      place(cat.get(f.sportsAssets[1]), x0 + f.sportsInset + f.sportsSpacing, z0 + f.sportsInset, 'S', { open: true });
    } else if (block.open === 'parking') {
      place(cat.get(f.parkingAsset), x0 + f.parkingInset, z0, 'S', { open: true });
    }
    return { lots, roads: [], areas: [{ id: `area-${level}-${k}-${row}`, kind: block.open, rect: block.rect, y, district }] };
  }
  const depth = z1 - z0;
  if (!block.alley) {
    fillRow(x0, x1, z0, 'S', depth / 2);
    fillRow(x0, x1, z1, 'N', depth / 2);
    return { lots, roads: [], areas: [] };
  }
  const mid = (z0 + z1) / 2;
  const alley: Road = { id: roadId.alley(level, k, row), kind: 'alley', rect: { minX: x0, minZ: mid - cfg.alley / 2, maxX: x1, maxZ: mid + cfg.alley / 2 }, y, name: null };
  const half = depth / 2 - cfg.alley / 2;
  fillRow(x0, x1, z0, 'S', half);
  fillRow(x0, x1, z1, 'N', half);
  return { lots, roads: [alley], areas: [] };
}
