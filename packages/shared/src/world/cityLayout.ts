import type { Vec3 } from '../math/vec3';
import type { CityDistrict, GasStation, Hospital, OrderRules, PoiRole, Rect } from './mapTypes';

export type { CityDistrict } from './mapTypes';

export type Level = 'L0' | 'L1' | 'L2' | 'L3' | 'ridge';
export type Facing = 'N' | 'S' | 'E' | 'W';
export type BandId = 'A' | 'B' | 'C' | 'D';

export interface Lot {
  id: string;
  /** Catalog id */
  asset: string;
  rect: Rect;
  /** Base height of the building */
  y: number;
  facing: Facing;
  level: Level;
  district: CityDistrict;
  block: string;
  name: string;
  address: string;
  door: Vec3 | null;
  /**
   * The door's roles when fewer than the catalog's: a restaurant or shop past the pickup cap keeps only its dropoff
   * roles. Absent: the catalog's `poi.roles`.
   */
  roles?: PoiRole[];
  upperDoor: { position: Vec3; y: number } | null;
  /** Rendered and collided as a prop instead of a building */
  prop: boolean;
  /** An empty lot: no solid */
  open: boolean;
  /** A stack of this many (a container stack): the solid is `stack` catalog heights tall */
  stack?: number;
}

export type RoadKind = 'avenue' | 'street' | 'lane' | 'dockLane' | 'alley';
export interface Road {
  id: string;
  kind: RoadKind;
  rect: Rect;
  y: number;
  name: string | null;
}
/** Hillcrest Drive: a polyline instead of a rect. */
export interface CurvedRoad {
  id: string;
  polyline: Vec3[];
  width: number;
}

export type ConnectorKind = 'switchback' | 'steepLane' | 'stairs';
export interface Connector {
  id: string;
  kind: ConnectorKind;
  band: BandId;
  x: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  /** Switchbacks only */
  legLength?: number;
}

export type AreaKind =
  | 'park'
  | 'sports'
  | 'parking'
  | 'plaza'
  | 'quay'
  | 'containerYard'
  | 'rail'
  | 'sand'
  | 'boardwalk'
  | 'pier'
  | 'breakwater'
  | 'marina'
  | 'cliff'
  | 'bandGap'
  | 'hospitalLot'
  | 'gasLot';
export interface Area {
  id: string;
  kind: AreaKind;
  rect: Rect;
  y: number;
  district: CityDistrict;
}

export interface Block {
  id: string;
  rect: Rect;
  level: Level;
  district: CityDistrict;
  alley: boolean;
}

export interface CityLayout {
  version: 1;
  seed: number;
  size: 1200;
  levels: Record<Level, { y: number; z0: number; z1: number }>;
  bands: Record<BandId, { z0: number; z1: number; y0: number; y1: number }>;
  blocks: Block[];
  lots: Lot[];
  roads: Road[];
  curvedRoads: CurvedRoad[];
  connectors: Connector[];
  areas: Area[];
  hospitals: Hospital[];
  gasStations: GasStation[];
  orderRules: OrderRules;
}

const LEVELS: readonly string[] = ['L0', 'L1', 'L2', 'L3', 'ridge'];
const BANDS: readonly string[] = ['A', 'B', 'C', 'D'];
const FACINGS: readonly string[] = ['N', 'S', 'E', 'W'];
const DISTRICTS: readonly string[] = [
  'docks', 'beach', 'harbor', 'industrial', 'downtown', 'market', 'rowhouses', 'highstreet', 'apartments', 'uptown', 'hillcrest', 'slope',
];
const POI_ROLES: readonly string[] = ['foodPickup', 'packagePickup', 'dropoffFood', 'dropoffPackage'];
const ROAD_KINDS: readonly string[] = ['avenue', 'street', 'lane', 'dockLane', 'alley'];
const CONNECTOR_KINDS: readonly string[] = ['switchback', 'steepLane', 'stairs'];
const AREA_KINDS: readonly string[] = [
  'park', 'sports', 'parking', 'plaza', 'quay', 'containerYard', 'rail', 'sand', 'boardwalk', 'pier', 'breakwater', 'marina', 'cliff', 'bandGap', 'hospitalLot', 'gasLot',
];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown): boolean => isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.z);

function fail(what: string, id: string, why: string): never {
  throw new Error(`city layout: ${what} ${id}: ${why}`);
}

function checkRect(what: string, id: string, r: unknown): void {
  if (!isObj(r) || !isNum(r.minX) || !isNum(r.minZ) || !isNum(r.maxX) || !isNum(r.maxZ)) fail(what, id, 'rect must be { minX, minZ, maxX, maxZ } numbers');
  if (r.maxX <= r.minX || r.maxZ <= r.minZ) fail(what, id, 'rect must have maxX > minX and maxZ > minZ');
}

function list(json: Obj, key: string): Obj[] {
  const a = json[key];
  if (!Array.isArray(a)) throw new Error(`city layout: ${key} must be an array`);
  return a.map((raw: unknown, i) => {
    if (!isObj(raw)) throw new Error(`city layout: ${key}[${i}] must be an object`);
    if (typeof raw.id !== 'string' || raw.id === '') throw new Error(`city layout: ${key}[${i}] has no id`);
    return raw;
  });
}

function oneOf(what: string, id: string, field: string, v: unknown, allowed: readonly string[]): void {
  if (typeof v !== 'string' || !allowed.includes(v)) fail(what, id, `${field} must be one of ${allowed.join('/')}`);
}

/** Validates map/city.layout.json. Throws naming the offending id. */
export function parseCityLayout(json: unknown): CityLayout {
  if (!isObj(json) || json.version !== 1) throw new Error('city layout: expected { version: 1, ... }');
  if (!isNum(json.seed)) throw new Error('city layout: seed must be a number');
  if (json.size !== 1200) throw new Error('city layout: size must be 1200');
  if (!isObj(json.levels)) throw new Error('city layout: levels missing');
  for (const l of LEVELS) {
    const v = (json.levels as Obj)[l];
    if (!isObj(v) || !isNum(v.y) || !isNum(v.z0) || !isNum(v.z1) || v.z1 <= v.z0) fail('level', l, 'must be { y, z0, z1 } with z1 > z0');
  }
  if (!isObj(json.bands)) throw new Error('city layout: bands missing');
  for (const b of BANDS) {
    const v = (json.bands as Obj)[b];
    if (!isObj(v) || !isNum(v.y0) || !isNum(v.y1) || !isNum(v.z0) || !isNum(v.z1) || v.z1 <= v.z0) fail('band', b, 'must be { z0, z1, y0, y1 } with z1 > z0');
  }
  for (const b of list(json, 'blocks')) {
    checkRect('block', b.id as string, b.rect);
    oneOf('block', b.id as string, 'level', b.level, LEVELS);
    oneOf('block', b.id as string, 'district', b.district, DISTRICTS);
    if (typeof b.alley !== 'boolean') fail('block', b.id as string, 'alley must be a boolean');
  }
  for (const l of list(json, 'lots')) {
    const id = l.id as string;
    if (typeof l.asset !== 'string') fail('lot', id, 'asset must be a string');
    checkRect('lot', id, l.rect);
    if (!isNum(l.y)) fail('lot', id, 'y must be a number');
    oneOf('lot', id, 'facing', l.facing, FACINGS);
    oneOf('lot', id, 'level', l.level, LEVELS);
    oneOf('lot', id, 'district', l.district, DISTRICTS);
    for (const f of ['block', 'name', 'address'] as const) if (typeof l[f] !== 'string') fail('lot', id, `${f} must be a string`);
    if (l.door !== null && !isVec(l.door)) fail('lot', id, 'door must be a Vec3 or null');
    if (l.roles !== undefined && !(Array.isArray(l.roles) && l.roles.every((r) => typeof r === 'string' && POI_ROLES.includes(r)))) {
      fail('lot', id, `roles must be a list of ${POI_ROLES.join('/')}`);
    }
    if (l.upperDoor !== null && !(isObj(l.upperDoor) && isVec(l.upperDoor.position) && isNum(l.upperDoor.y))) fail('lot', id, 'upperDoor must be { position, y } or null');
    if (typeof l.prop !== 'boolean' || typeof l.open !== 'boolean') fail('lot', id, 'prop and open must be booleans');
    if (l.stack !== undefined && !(isNum(l.stack) && Number.isInteger(l.stack) && l.stack >= 1)) fail('lot', id, 'stack must be a whole number from 1');
  }
  for (const r of list(json, 'roads')) {
    const id = r.id as string;
    oneOf('road', id, 'kind', r.kind, ROAD_KINDS);
    checkRect('road', id, r.rect);
    if (!isNum(r.y)) fail('road', id, 'y must be a number');
    if (r.name !== null && typeof r.name !== 'string') fail('road', id, 'name must be a string or null');
  }
  for (const r of list(json, 'curvedRoads')) {
    const id = r.id as string;
    if (!Array.isArray(r.polyline) || r.polyline.length < 2 || !r.polyline.every(isVec)) fail('curved road', id, 'polyline needs at least 2 Vec3 points');
    if (!isNum(r.width) || r.width <= 0) fail('curved road', id, 'width must be positive');
  }
  for (const c of list(json, 'connectors')) {
    const id = c.id as string;
    oneOf('connector', id, 'kind', c.kind, CONNECTOR_KINDS);
    oneOf('connector', id, 'band', c.band, BANDS);
    for (const f of ['x', 'z0', 'z1', 'y0', 'y1'] as const) if (!isNum(c[f])) fail('connector', id, `${f} must be a number`);
    if ((c.z1 as number) <= (c.z0 as number)) fail('connector', id, 'z1 must be greater than z0');
    if (c.legLength !== undefined && !isNum(c.legLength)) fail('connector', id, 'legLength must be a number');
  }
  for (const a of list(json, 'areas')) {
    const id = a.id as string;
    oneOf('area', id, 'kind', a.kind, AREA_KINDS);
    checkRect('area', id, a.rect);
    if (!isNum(a.y)) fail('area', id, 'y must be a number');
    oneOf('area', id, 'district', a.district, DISTRICTS);
  }
  for (const key of ['hospitals', 'gasStations'] as const) list(json, key);
  if (!isObj(json.orderRules)) throw new Error('city layout: orderRules missing');
  return json as unknown as CityLayout;
}
