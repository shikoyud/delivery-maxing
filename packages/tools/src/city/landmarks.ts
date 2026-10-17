import {
  lotSize,
  vec3,
  type Area,
  type CatalogIndex,
  type CityConfig,
  type CityDistrict,
  type GasStation,
  type Hospital,
  type Lot,
  type Rng,
  type Road,
} from '@dm/shared';
import { blockPlacer, type BlockPlan, type LotPlacer } from './blocks';
import { roadId } from './frame';
import type { Palette } from './palettes';

// The fixed landmarks (city design section 2.2): the prototype's SPECIAL blocks (hospitals, gas stations, City Hall,
// Police, the Fire Station, the Church, the School and the Post Office), each built in place of a street block.

export interface SpecialResult {
  lots: Lot[];
  roads: Road[];
  areas: Area[];
  /** Whether the block keeps an alley (a gas block does; a hospital or plaza block does not) */
  alley: boolean;
  hospital?: Hospital;
  gasStation?: GasStation;
}
export type SpecialBuilder = (plan: BlockPlan, pal: Palette, rng: Rng, cat: CatalogIndex, cfg: CityConfig) => SpecialResult;

/** "Bayview General" -> "bayview-general" */
export const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * An 18 x 15 m gas lot with its south-west corner at (gx, gz): the canopy (`mega/Gas_Station_02`, an open lot so cars
 * drive under it, named after the station) and the kiosk (`mega/SmallMarket_01`) at their configured offsets, both
 * facing south, and two pumps `pumpSpacing` apart on the canopy's centre line.
 */
export function gasLot(
  placer: LotPlacer,
  name: string,
  gx: number,
  gz: number,
  y: number,
  district: CityDistrict,
  cat: CatalogIndex,
  cfg: CityConfig,
): { area: Area; station: GasStation; lots: Lot[] } {
  const g = cfg.gasStation;
  const canopy = placer.place(cat.get(g.canopy.asset), gx + g.canopy.x, gz + g.canopy.z, 'S', { open: true, name });
  const kiosk = placer.place(cat.get(g.kiosk.asset), gx + g.kiosk.x, gz + g.kiosk.z, 'S');
  const rect = { minX: gx, minZ: gz, maxX: gx + g.lotW, maxZ: gz + g.lotD };
  for (const l of [canopy, kiosk]) {
    const r = l.rect;
    if (r.minX < rect.minX || r.maxX > rect.maxX || r.minZ < rect.minZ || r.maxZ > rect.maxZ) throw new Error(`landmarks: ${l.asset} leaves the gas lot of ${name}`);
  }
  const cx = (canopy.rect.minX + canopy.rect.maxX) / 2;
  const cz = (canopy.rect.minZ + canopy.rect.maxZ) / 2;
  const id = `gas-${slug(name)}`;
  return {
    area: { id: `area-${id}`, kind: 'gasLot', rect, y, district },
    station: { id, name, position: vec3(cx, y, cz), pumps: [vec3(cx - g.pumpSpacing / 2, y, cz), vec3(cx + g.pumpSpacing / 2, y, cz)] },
    lots: [canopy, kiosk],
  };
}

/**
 * A hospital block: `mega/Hospital_01` centred across a `lot` x `lot` hospitalLot at the block's west end, its front on
 * the block's south street (the avenue: every hospital is in row 0). The `Hospital` record: the centre is the lot's,
 * the courier respawns `spawnOffset` in front of the door facing the avenue (yaw 0 faces -z), and the first bay is on
 * the avenue-side sidewalk `bayOffset` east of the hospitalLot and `bayBack` south of the kerb line, parked along the
 * avenue facing west (yaw pi/2), so the slots behind it run east along the sidewalk (Decision 6). The rest of the
 * block is two filler rows east of the hospitalLot and a north row behind it, as the prototype's hospital_block.
 */
export function hospitalBlock(name: string): SpecialBuilder {
  return (plan, pal, rng, cat, cfg) => {
    const h = cfg.hospital;
    const { minX: a, maxX: b, minZ: z0, maxZ: z1 } = plan.rect;
    const y = cfg.levels[plan.level].y;
    if (z1 - z0 < h.lot) throw new Error(`landmarks: block ${plan.id} is too shallow for ${name}`);
    const placer = blockPlacer(plan, pal, rng, cat, cfg);
    const e = cat.get(h.asset);
    const { w } = lotSize(e);
    const lot = placer.place(e, a + (h.lot - w) / 2, z0, 'S', { name });
    const depth = z1 - z0;
    placer.fillRow(a + h.lot, b, z0, 'S', depth / 2 - h.rowMargin);
    placer.fillRow(a + h.lot, b, z1, 'N', depth / 2 - h.rowMargin);
    placer.fillRow(a, a + h.lot, z1, 'N', depth - h.lot - h.behindGap);
    const cx = (lot.rect.minX + lot.rect.maxX) / 2;
    const id = `hospital-${slug(name)}`;
    return {
      lots: placer.lots,
      roads: [],
      areas: [{ id: `area-${id}`, kind: 'hospitalLot', rect: { minX: a, minZ: z0, maxX: a + h.lot, maxZ: z0 + h.lot }, y, district: plan.district }],
      alley: false,
      hospital: {
        id,
        name,
        center: vec3(cx, y, (lot.rect.minZ + lot.rect.maxZ) / 2),
        safeRadius: h.safeRadius,
        spawn: vec3(cx, y, lot.rect.minZ - h.spawnOffset),
        spawnYaw: 0,
        bay: vec3(a + h.lot + h.bayOffset, y, z0 - h.bayBack),
        bayYaw: Math.PI / 2,
      },
    };
  };
}

/**
 * A gas block: the gas lot at the block's west (or east) end on its south street, an alley down the middle beside it
 * (it stops at the gas lot), filler lots on the rest of the south row and a full north row, as the prototype's gas_block.
 */
export function gasBlock(name: string, side: 'W' | 'E'): SpecialBuilder {
  return (plan, pal, rng, cat, cfg) => {
    const g = cfg.gasStation;
    const { minX: a, maxX: b, minZ: z0, maxZ: z1 } = plan.rect;
    const y = cfg.levels[plan.level].y;
    const placer = blockPlacer(plan, pal, rng, cat, cfg);
    const gx = side === 'W' ? a : b - g.lotW;
    const gas = gasLot(placer, name, gx, z0, y, plan.district, cat, cfg);
    const half = (z1 - z0) / 2 - cfg.alley / 2;
    const [rx0, rx1] = side === 'W' ? [a + g.lotW, b] : [a, b - g.lotW];
    placer.fillRow(rx0, rx1, z0, 'S', half);
    placer.fillRow(a, b, z1, 'N', half);
    const mid = (z0 + z1) / 2;
    const alley: Road = {
      id: roadId.alley(plan.level, plan.k, plan.row),
      kind: 'alley',
      rect: { minX: rx0, minZ: mid - cfg.alley / 2, maxX: rx1, maxZ: mid + cfg.alley / 2 },
      y,
      name: null,
    };
    return { lots: placer.lots, roads: [alley], areas: [gas.area], alley: true, gasStation: gas.station };
  };
}

/**
 * A landmark on a plaza: the model centred on the block's front, filler lots `sideGap` either side of it up to
 * `fillerDepth` deep, and a north row behind (at least `backMin` deep, `backGap` clear of the landmark and the fillers),
 * as the prototype's landmark_block. `label` names the lot.
 */
export function landmarkBlock(id: string, label: string): SpecialBuilder {
  return (plan, pal, rng, cat, cfg) => {
    const p = cfg.landmarks.plaza;
    const { minX: a, maxX: b, minZ: z0, maxZ: z1 } = plan.rect;
    const y = cfg.levels[plan.level].y;
    const placer = blockPlacer(plan, pal, rng, cat, cfg);
    const e = cat.get(id);
    const { w, d } = lotSize(e);
    const cx = (a + b) / 2 - w / 2;
    placer.place(e, cx, z0, 'S', { name: label });
    const depth = z1 - z0;
    const southD = Math.min(p.fillerDepth, depth - p.backMin - p.backGap);
    placer.fillRow(a, cx - p.sideGap, z0, 'S', southD);
    placer.fillRow(cx + w + p.sideGap, b, z0, 'S', southD);
    const northD = Math.max(p.backMin, depth - Math.max(d, southD) - p.backGap);
    if (d + northD > depth) throw new Error(`landmarks: ${label} leaves no room for the row behind it in ${plan.id}`);
    placer.fillRow(a, b, z1, 'N', northD);
    return {
      lots: placer.lots,
      roads: [],
      areas: [{ id: `area-${plan.id.slice('block-'.length)}`, kind: 'plaza', rect: plan.rect, y, district: plan.district }],
      alley: false,
    };
  };
}

/** The special blocks of config `landmarks`, keyed "<level>:<k>:<row>" (the prototype's SPECIAL). */
export function specialBlocks(cfg: CityConfig): Map<string, SpecialBuilder> {
  const m = new Map<string, SpecialBuilder>();
  const add = (at: string, f: SpecialBuilder): void => {
    if (m.has(at)) throw new Error(`landmarks: two special blocks at ${at}`);
    m.set(at, f);
  };
  const l = cfg.landmarks;
  for (const h of l.hospitals) add(h.at, hospitalBlock(h.name));
  for (const g of l.gas) add(g.at, gasBlock(g.name, g.side));
  for (const c of l.civic) add(c.at, landmarkBlock(c.asset, c.name));
  return m;
}
