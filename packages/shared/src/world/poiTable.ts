import type { District } from './mapTypes';

/** One POI's row of the generated table: navmesh path metres from and to the HUB centre (−1 when there is no path). */
export interface PoiRow { id: string; district: District; elevated: boolean; fromHub: number; toHub: number; reachable: boolean }

/**
 * The generated POI table `map/city.poi.json` (built with the navmesh by `map:build`). `between[i][j]` is the path
 * metres from `pois[i]` to `pois[j]` (index order of `pois`), −1 when there is no path. A POI is `reachable` only when
 * paths lead both from the HUB to it and back.
 */
export interface PoiTableFile { version: 1; pois: PoiRow[]; between: number[][]; unreachable: { id: string; reason: string }[] }

const DISTRICTS: readonly string[] = ['hub', 'downtown', 'harbor', 'hillside', 'suburbs'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A path length: a finite number ≥ 0, or −1 for "no path". */
const isDistance = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && (v >= 0 || v === -1);

/** Validates map/city.poi.json. Throws naming the offending row or cell. */
export function parsePoiTable(json: unknown): PoiTableFile {
  const fail = (why: string): never => {
    throw new Error(`poi table: ${why}`);
  };
  if (!isObj(json)) return fail('not an object');
  if (json.version !== 1) fail(`version must be 1, got ${String(json.version)}`);
  if (!Array.isArray(json.pois)) return fail('pois must be an array');
  const ids = new Set<string>();
  for (const [i, p] of (json.pois as unknown[]).entries()) {
    if (!isObj(p) || typeof p.id !== 'string' || p.id === '') return fail(`pois[${i}] has no id`);
    const id = p.id;
    if (ids.has(id)) fail(`duplicate poi id ${id}`);
    ids.add(id);
    if (!DISTRICTS.includes(p.district as string)) fail(`poi ${id}: unknown district ${String(p.district)}`);
    if (typeof p.elevated !== 'boolean') fail(`poi ${id}: elevated must be a boolean`);
    if (typeof p.reachable !== 'boolean') fail(`poi ${id}: reachable must be a boolean`);
    for (const k of ['fromHub', 'toHub'] as const) if (!isDistance(p[k])) fail(`poi ${id}: ${k} must be ≥ 0 or −1`);
  }
  const n = ids.size;
  const between = json.between;
  if (!Array.isArray(between) || between.length !== n) return fail(`between must have ${n} rows`);
  between.forEach((row: unknown, i) => {
    if (!Array.isArray(row) || row.length !== n) return fail(`between[${i}] must have ${n} entries`);
    row.forEach((d: unknown, j) => {
      if (!isDistance(d)) fail(`between[${i}][${j}] must be ≥ 0 or −1`);
    });
  });
  if (!Array.isArray(json.unreachable)) return fail('unreachable must be an array');
  for (const u of json.unreachable as unknown[]) {
    if (!isObj(u) || typeof u.id !== 'string' || typeof u.reason !== 'string') return fail('unreachable entry is malformed');
    if (!ids.has(u.id)) fail(`unreachable names unknown poi ${u.id}`);
  }
  return json as unknown as PoiTableFile;
}
