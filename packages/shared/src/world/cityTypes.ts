import { movementConfig } from '../config';
import type { Vec3 } from '../math/vec3';
import { solidRect } from './chunks';
import type { District, MapData, Rect } from './mapTypes';
import type { PieceCatalog } from './pieces';

export type RotY = 0 | 90 | 180 | 270;
export interface Prop { id: string; piece: string; position: Vec3; rotY: RotY; scale: number; palette: string | null }
/** `plaza`: inside the HUB exclusion (thieves never use it). */
export interface StreetNode { id: string; p: Vec3; plaza: boolean }
/** `halfWidth` covers road + sidewalks. */
export interface StreetEdge { a: string; b: string; halfWidth: number; long: boolean }
export interface NavLink { id: string; kind: 'pad' | 'zip' | 'mantle' | 'drop'; from: Vec3; to: Vec3; bidirectional: boolean }
export interface ThiefSpawn { id: string; node: string; district: District }
export interface DistrictArea { district: District; rect: Rect }

/** The generated placement file `map/city.json`. */
export interface CityMap extends MapData {
  kind: 'city';
  seed: number;
  chunkSize: number;
  districts: DistrictArea[];
  props: Prop[];
  streets: { nodes: StreetNode[]; edges: StreetEdge[] };
  navLinks: NavLink[];
  thiefSpawns: ThiefSpawn[];
}

const ROT_Y: readonly number[] = [0, 90, 180, 270];
const NAV_KINDS: readonly string[] = ['pad', 'zip', 'mantle', 'drop'];
const DISTRICTS: readonly string[] = ['hub', 'downtown', 'harbor', 'hillside', 'suburbs'];
/** Float slack when comparing extents and bounds (rotated boxes carry ~1e-14 error). */
const EPS = 1e-6;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.z);

/** Validates map/city.json against the piece catalog. Throws naming the offending id. */
export function parseCityMap(json: unknown, pieces: PieceCatalog): CityMap {
  const fail = (why: string): never => {
    throw new Error(`city map: ${why}`);
  };
  if (!isObj(json)) return fail('not an object');
  if (json.kind !== 'city') fail(`kind must be "city", got ${String(json.kind)}`);
  if (!isNum(json.size) || json.size <= 0) fail('size must be positive');
  if (!isNum(json.seed)) fail('seed must be a number');
  if (!isNum(json.chunkSize) || json.chunkSize <= 0) fail('chunkSize must be positive');
  const size = json.size as number;
  const chunkSize = json.chunkSize as number;
  const limit = size / 2 + movementConfig.fall.boundsMargin;

  const list = (name: string, v: unknown): Record<string, unknown>[] => {
    if (!Array.isArray(v)) return fail(`${name} must be an array`);
    v.forEach((e, i) => {
      if (!isObj(e)) fail(`${name}[${i}] is not an object`);
    });
    return v as Record<string, unknown>[];
  };
  /** Each collection's ids are unique and non-empty strings; returns the id set. */
  const idsOf = (name: string, items: Record<string, unknown>[]): Set<string> => {
    const seen = new Set<string>();
    for (const it of items) {
      if (typeof it.id !== 'string' || it.id === '') fail(`${name} entry without an id`);
      if (seen.has(it.id as string)) fail(`duplicate ${name} id ${String(it.id)}`);
      seen.add(it.id as string);
    }
    return seen;
  };
  const point = (what: string, id: string, v: unknown): Vec3 => {
    if (!isVec3(v)) return fail(`${what} ${id}: position is malformed`);
    if (Math.abs(v.x) > limit + EPS || Math.abs(v.z) > limit + EPS) fail(`${what} ${id}: lies outside the map bounds`);
    return v;
  };

  const solids = list('solids', json.solids);
  idsOf('solid', solids);
  for (const s of solids) {
    const id = s.id as string;
    if (typeof s.kind !== 'string') fail(`solid ${id}: kind must be a string`);
    if (!isVec3(s.center) || !isVec3(s.size) || s.size.x <= 0 || s.size.y <= 0 || s.size.z <= 0) {
      fail(`solid ${id}: center/size are malformed`);
    }
    if (s.rotationDeg !== undefined && !isVec3(s.rotationDeg)) fail(`solid ${id}: rotationDeg is malformed`);
    const r = solidRect(s as unknown as Parameters<typeof solidRect>[0]);
    if (r.maxX - r.minX > chunkSize + EPS || r.maxZ - r.minZ > chunkSize + EPS) {
      fail(`solid ${id}: horizontal extent exceeds chunkSize ${chunkSize}`);
    }
    if (r.minX < -limit - EPS || r.maxX > limit + EPS || r.minZ < -limit - EPS || r.maxZ > limit + EPS) {
      fail(`solid ${id}: lies outside the map bounds`);
    }
  }

  for (const [name, key, keys] of [
    ['zipLine', 'zipLines', ['a', 'b']],
    ['jumpPad', 'jumpPads', ['position']],
    ['boostOrb', 'boostOrbs', ['position']],
    ['checkpoint', 'checkpoints', ['position']],
  ] as const) {
    const items = list(key, json[key]);
    idsOf(name, items);
    for (const it of items) for (const k of keys) point(name, it.id as string, it[k]);
  }
  const rails = list('rails', json.rails);
  idsOf('rail', rails);
  for (const r of rails) {
    if (!Array.isArray(r.points) || r.points.length < 2) fail(`rail ${String(r.id)}: needs at least 2 points`);
    for (const p of r.points as unknown[]) point('rail', r.id as string, p);
  }
  const pois = list('pois', json.pois);
  idsOf('poi', pois);
  for (const p of pois) point('poi', p.id as string, p.position);
  if (!isObj(json.hub)) fail('hub is missing');

  const districts = list('districts', json.districts);
  for (const d of districts) {
    const rect = d.rect;
    if (!DISTRICTS.includes(d.district as string)) fail(`unknown district ${String(d.district)}`);
    if (!isObj(rect) || !isNum(rect.minX) || !isNum(rect.minZ) || !isNum(rect.maxX) || !isNum(rect.maxZ)) {
      fail(`district ${String(d.district)}: rect is malformed`);
    }
  }

  const props = list('props', json.props);
  idsOf('prop', props);
  for (const p of props) {
    const id = p.id as string;
    if (typeof p.piece !== 'string' || !Object.hasOwn(pieces, p.piece)) {
      fail(`prop ${id}: unknown piece ${String(p.piece)}`);
    }
    if (!ROT_Y.includes(p.rotY as number)) fail(`prop ${id}: rotY must be 0, 90, 180 or 270, got ${String(p.rotY)}`);
    if (!isNum(p.scale) || p.scale <= 0) fail(`prop ${id}: scale must be positive`);
    if (p.palette !== null && typeof p.palette !== 'string') fail(`prop ${id}: palette must be a string or null`);
    point('prop', id, p.position);
  }

  if (!isObj(json.streets)) return fail('streets is missing');
  const nodes = list('streets.nodes', json.streets.nodes);
  const nodeIds = idsOf('street node', nodes);
  for (const n of nodes) {
    point('street node', n.id as string, n.p);
    if (typeof n.plaza !== 'boolean') fail(`street node ${String(n.id)}: plaza must be a boolean`);
  }
  for (const e of list('streets.edges', json.streets.edges)) {
    for (const end of [e.a, e.b]) {
      if (typeof end !== 'string' || !nodeIds.has(end)) fail(`street edge ${String(e.a)}-${String(e.b)}: unknown node ${String(end)}`);
    }
    if (!isNum(e.halfWidth) || e.halfWidth <= 0) fail(`street edge ${String(e.a)}-${String(e.b)}: halfWidth must be positive`);
    if (typeof e.long !== 'boolean') fail(`street edge ${String(e.a)}-${String(e.b)}: long must be a boolean`);
  }

  const navLinks = list('navLinks', json.navLinks);
  idsOf('navLink', navLinks);
  for (const l of navLinks) {
    const id = l.id as string;
    if (!NAV_KINDS.includes(l.kind as string)) fail(`navLink ${id}: unknown kind ${String(l.kind)}`);
    if (typeof l.bidirectional !== 'boolean') fail(`navLink ${id}: bidirectional must be a boolean`);
    point('navLink', id, l.from);
    point('navLink', id, l.to);
  }

  const spawns = list('thiefSpawns', json.thiefSpawns);
  idsOf('thiefSpawn', spawns);
  for (const t of spawns) {
    if (typeof t.node !== 'string' || !nodeIds.has(t.node)) fail(`thiefSpawn ${String(t.id)}: unknown node ${String(t.node)}`);
    if (!DISTRICTS.includes(t.district as string)) fail(`thiefSpawn ${String(t.id)}: unknown district ${String(t.district)}`);
  }

  return json as unknown as CityMap;
}
