import type { District, Hub, Rect, Vec3 } from '@dm/shared';

export type Template = 'downtown' | 'harbor' | 'hillside' | 'suburbs';
export type Edge = 'north' | 'south' | 'east' | 'west';
export type QuadrantDistrict = Exclude<District, 'hub'>;

export interface DistrictSource {
  district: QuadrantDistrict;
  rect: Rect;
  /** Until Tasks 9–12 every template runs the filler. */
  template: Template;
  /** Template-specific values; each builder validates its own. */
  params: Record<string, unknown>;
}

/** Road and sidewalk heights (top y) and the sidewalk width on each side of a street. */
export interface StreetStyle { roadTop: number; sidewalkTop: number; sidewalkWidth: number }

/** The hand-authored generator input, `map/city.source.json`. Coordinates: x east, z south (−z is north). */
export interface CitySource {
  seed: number;
  size: number;
  /** The SP1 hub values, plus the kiosk box size and the radius kept free of lots. */
  hub: Hub & { kioskSize: Vec3; clearRadius: number };
  arterials: { pitch: number; halfWidth: number };
  streets: StreetStyle;
  districts: DistrictSource[];
  boundary: {
    cliffEdges: Edge[];
    waterEdges: Edge[];
    cliffHeight: number;
    /** Cliff thickness, standing inside the map edge. */
    cliffDepth: number;
    /** Land stops this far inside a water edge (the quay line). */
    quayInset: number;
    /** Quay walls and cliffs reach this far below y = 0. */
    quayDepth: number;
    quayWallThickness: number;
  };
  /** Palette basenames buildings may use (the ten non-sign palettes of assets.config.json). */
  buildingPalettes: string[];
  /** Hand-placed landmarks, filled by the district tasks. */
  landmarks: unknown[];
  pois: {
    total: number;
    elevatedTarget: number;
    minSpacing: number;
    perDistrict: Partial<Record<District, number>>;
    perBandMin: number;
  };
  checkpoints: { spacing: number };
}

const TEMPLATES: readonly string[] = ['downtown', 'harbor', 'hillside', 'suburbs'];
const EDGES: readonly string[] = ['north', 'south', 'east', 'west'];
const QUADRANTS: readonly string[] = ['downtown', 'harbor', 'hillside', 'suburbs'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.z);
const isRect = (v: unknown): v is Rect =>
  isObj(v) && isNum(v.minX) && isNum(v.minZ) && isNum(v.maxX) && isNum(v.maxZ) && v.minX < v.maxX && v.minZ < v.maxZ;

/** Validates map/city.source.json. Throws naming the offending field. */
export function parseCitySource(json: unknown): CitySource {
  const fail = (why: string): never => {
    throw new Error(`city source: ${why}`);
  };
  const obj = (v: unknown, name: string): Record<string, unknown> => (isObj(v) ? v : fail(`${name} must be an object`));
  const pos = (o: Record<string, unknown>, keys: string[], name: string, allowZero = false): void => {
    for (const k of keys) {
      const v = o[k];
      if (!isNum(v) || v < 0 || (!allowZero && v === 0)) fail(`${name}.${k} must be a ${allowZero ? 'non-negative' : 'positive'} number`);
    }
  };

  const root = obj(json, 'root');
  if (!Number.isInteger(root.seed)) fail('seed must be an integer');
  pos(root, ['size'], 'root');

  const hub = obj(root.hub, 'hub');
  for (const k of ['center', 'kiosk', 'spawn', 'kioskSize']) if (!isVec3(hub[k])) fail(`hub.${k} must be a vec3`);
  pos(hub, ['plazaRadius', 'dropZoneRadius', 'zoneHeight', 'kioskRange', 'clearRadius'], 'hub');
  if (!isNum(hub.spawnYaw)) fail('hub.spawnYaw must be a number');
  if ((hub.clearRadius as number) < (hub.plazaRadius as number)) fail('hub.clearRadius must be at least plazaRadius');

  pos(obj(root.arterials, 'arterials'), ['pitch', 'halfWidth'], 'arterials');
  const streets = obj(root.streets, 'streets');
  pos(streets, ['roadTop', 'sidewalkTop', 'sidewalkWidth'], 'streets');

  if (!Array.isArray(root.districts)) fail('districts must be an array');
  const seen = new Set<string>();
  for (const [i, d] of (root.districts as unknown[]).entries()) {
    const dd = obj(d, `districts[${i}]`);
    if (!QUADRANTS.includes(dd.district as string)) fail(`districts[${i}].district ${String(dd.district)} is unknown`);
    if (seen.has(dd.district as string)) fail(`district ${String(dd.district)} is listed twice`);
    seen.add(dd.district as string);
    if (!TEMPLATES.includes(dd.template as string)) fail(`district ${String(dd.district)}: unknown template ${String(dd.template)}`);
    if (!isRect(dd.rect)) fail(`district ${String(dd.district)}: rect is malformed`);
    obj(dd.params, `district ${String(dd.district)}.params`);
  }

  const b = obj(root.boundary, 'boundary');
  for (const k of ['cliffEdges', 'waterEdges']) {
    if (!Array.isArray(b[k]) || !(b[k] as unknown[]).every((e) => EDGES.includes(e as string))) {
      fail(`boundary.${k} must list north/south/east/west`);
    }
  }
  if ((b.cliffEdges as string[]).some((e) => (b.waterEdges as string[]).includes(e))) fail('an edge cannot be both cliff and water');
  pos(b, ['cliffHeight', 'cliffDepth', 'quayInset', 'quayDepth', 'quayWallThickness'], 'boundary');

  const palettes = root.buildingPalettes;
  if (!Array.isArray(palettes) || palettes.length === 0 || !palettes.every((p) => typeof p === 'string' && p !== '')) {
    fail('buildingPalettes must be a non-empty list of palette names');
  }
  if (!Array.isArray(root.landmarks)) fail('landmarks must be an array');

  const pois = obj(root.pois, 'pois');
  pos(pois, ['total', 'elevatedTarget', 'minSpacing', 'perBandMin'], 'pois');
  obj(pois.perDistrict, 'pois.perDistrict');
  pos(obj(root.checkpoints, 'checkpoints'), ['spacing'], 'checkpoints');

  return root as unknown as CitySource;
}
