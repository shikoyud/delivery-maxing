import type { PoiRole } from './mapTypes';

/** The asset catalog (map/catalog.json): one entry per model of the owner's packs, plus the models the design still lacks. */
export type CatalogCategory =
  | 'food'
  | 'shop'
  | 'residential'
  | 'office'
  | 'civic'
  | 'leisure'
  | 'industrial'
  | 'service'
  | 'landmark'
  | 'prop'
  | 'road'
  | 'terrain'
  | 'nature'
  | 'vehicle'
  | 'orderItem'
  | 'courierVehicle'
  | 'fx';

export type FrontAxis = '+z' | '-z' | '+x' | '-x';

export interface CatalogEntry {
  id: string;
  /** Path under the packs folder; null for a model the packs lack */
  file: string | null;
  category: CatalogCategory;
  kind?: string;
  size: { w: number; h: number; d: number };
  pivot?: { x: number; z: number; minY: number };
  tris?: number;
  bytes?: number;
  use: 'placed' | 'prop' | 'unused';
  status?: 'missing' | 'empty';
  duplicateOf?: string;
  districts?: string[];
  poi?: { roles: PoiRole[]; items?: string; weightKg?: [number, number] };
  /** The side of the model that faces the street */
  front?: FrontAxis;
  notes?: string;
}

export interface AssetCatalog {
  version: 1;
  packs: Record<string, string>;
  entries: CatalogEntry[];
}

export const BUILDING_CATEGORIES: readonly CatalogCategory[] = [
  'food',
  'shop',
  'residential',
  'office',
  'civic',
  'leisure',
  'industrial',
  'service',
  'landmark',
];

const CATEGORIES: ReadonlySet<string> = new Set<CatalogCategory>([
  ...BUILDING_CATEGORIES,
  'prop',
  'road',
  'terrain',
  'nature',
  'vehicle',
  'orderItem',
  'courierVehicle',
  'fx',
]);
const USES: ReadonlySet<string> = new Set(['placed', 'prop', 'unused']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates map/catalog.json; the plural categories `vehicles`/`props` become `vehicle`/`prop`. Throws naming the offending id. */
export function parseCatalog(json: unknown): AssetCatalog {
  if (!isObj(json) || json.version !== 1 || !Array.isArray(json.entries)) throw new Error('catalog: expected { version: 1, entries: [] }');
  const packs = isObj(json.packs) ? (json.packs as Record<string, string>) : {};
  const seen = new Set<string>();
  const entries = json.entries.map((raw: unknown, i): CatalogEntry => {
    if (!isObj(raw) || typeof raw.id !== 'string') throw new Error(`catalog: entry #${i} has no id`);
    const id = raw.id;
    if (seen.has(id)) throw new Error(`catalog: duplicate id ${id}`);
    seen.add(id);
    if (raw.file !== null && typeof raw.file !== 'string') throw new Error(`catalog: ${id}: file must be a string or null`);
    const category = raw.category === 'vehicles' ? 'vehicle' : raw.category === 'props' ? 'prop' : raw.category;
    if (typeof category !== 'string' || !CATEGORIES.has(category)) throw new Error(`catalog: ${id}: unknown category ${String(raw.category)}`);
    if (typeof raw.use !== 'string' || !USES.has(raw.use)) throw new Error(`catalog: ${id}: unknown use ${String(raw.use)}`);
    // particle-only models have no geometry and so no size in the file: they get a zero size
    const s = raw.size === undefined && raw.status === 'empty' ? { w: 0, h: 0, d: 0 } : raw.size;
    if (!isObj(s) || !isNum(s.w) || !isNum(s.h) || !isNum(s.d)) throw new Error(`catalog: ${id}: size must be { w, h, d } numbers`);
    return { ...raw, category, size: { w: s.w, h: s.h, d: s.d } } as unknown as CatalogEntry;
  });
  return { version: 1, packs, entries };
}

export class CatalogIndex {
  private readonly byId = new Map<string, CatalogEntry>();

  constructor(readonly catalog: AssetCatalog) {
    for (const e of catalog.entries) this.byId.set(e.id, e);
  }

  get(id: string): CatalogEntry {
    const e = this.byId.get(id);
    if (!e) throw new Error(`catalog: unknown id ${id}`);
    return e;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  placedBuildings(): CatalogEntry[] {
    return this.catalog.entries.filter((e) => e.use === 'placed' && BUILDING_CATEGORIES.includes(e.category));
  }

  byCategory(c: CatalogCategory): CatalogEntry[] {
    return this.catalog.entries.filter((e) => e.category === c);
  }
}

const up = (v: number): number => Math.ceil(v * 2 - 1e-9) / 2;

/** Lot footprint of a building: w and d rounded up to 0.5 m (city design section 7.2). */
export function lotSize(e: CatalogEntry): { w: number; d: number } {
  return { w: up(e.size.w), d: up(e.size.d) };
}
