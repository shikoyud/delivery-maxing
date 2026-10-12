import { solidRect, type PieceEntry, type Prop, type Rect, type Rng, type RotY, type Solid, type Vec3 } from '@dm/shared';
import { r2, v2 } from './layout';

type M3 = [[number, number, number], [number, number, number], [number, number, number]];
const RAD = Math.PI / 180;
const EPS = 1e-6;

/** XYZ Euler (degrees) → matrix, R = Rx · Ry · Rz (three.js 'XYZ' order). */
function eulerToMatrix(r: Vec3): M3 {
  const [a, b, c] = [r.x * RAD, r.y * RAD, r.z * RAD];
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
  ];
}

/** Matrix → XYZ Euler degrees (three.js Euler.setFromRotationMatrix, order 'XYZ'). */
function matrixToEuler(m: M3): Vec3 {
  const m13 = Math.min(1, Math.max(-1, m[0][2]));
  const y = Math.asin(m13);
  if (Math.abs(m13) < 0.9999999) return { x: Math.atan2(-m[1][2], m[2][2]) / RAD, y: y / RAD, z: Math.atan2(-m[0][1], m[0][0]) / RAD };
  return { x: Math.atan2(m[2][1], m[1][1]) / RAD, y: y / RAD, z: 0 };
}

const mul = (p: M3, q: M3): M3 =>
  [0, 1, 2].map((i) => [0, 1, 2].map((j) => p[i]![0] * q[0][j]! + p[i]![1] * q[1][j]! + p[i]![2] * q[2][j]!)) as M3;

/** cos and sin of a quarter-turn yaw, exact. */
const YAW: Record<RotY, [number, number]> = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };
const yawMatrix = (rotY: RotY): M3 => {
  const [c, s] = YAW[rotY];
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
};

/** Turns a piece-local point by `rotY` about y (three.js convention: +z turns toward +x at 90°). */
export function yawPoint(p: Vec3, rotY: RotY): Vec3 {
  const [c, s] = YAW[rotY];
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
}

/**
 * The prop's colliders as world solids (`hidden`: the prop draws them): each piece collider scaled, turned by `rotY`
 * and moved to the prop. A quarter turn swaps the box's x and z sizes, and its own rotation R becomes Ry · R · Ry⁻¹.
 * Ids are `<propId>-c<k>`.
 */
export function propSolids(prop: Prop, piece: PieceEntry): Solid[] {
  const quarter = prop.rotY === 90 || prop.rotY === 270;
  return piece.colliders.map((c, k) => {
    const local = yawPoint({ x: c.center.x * prop.scale, y: c.center.y * prop.scale, z: c.center.z * prop.scale }, prop.rotY);
    const s = { x: c.size.x * prop.scale, y: c.size.y * prop.scale, z: c.size.z * prop.scale };
    const solid: Solid = {
      id: `${prop.id}-c${k}`,
      kind: 'building',
      center: v2({ x: prop.position.x + local.x, y: prop.position.y + local.y, z: prop.position.z + local.z }),
      size: v2(quarter ? { x: s.z, y: s.y, z: s.x } : s),
      hidden: true,
    };
    if (c.rotationDeg) {
      const y = yawMatrix(prop.rotY);
      const yInv = yawMatrix(((360 - prop.rotY) % 360) as RotY);
      solid.rotationDeg = v2(matrixToEuler(mul(mul(y, eulerToMatrix(c.rotationDeg)), yInv)));
    }
    return solid;
  });
}

/** Filler parameters of one district (`params` in city.source.json). */
export interface FillerParams {
  /** Local street pitch, m: each span between arterials is split into blocks of about this size. */
  pitch: number;
  /** Local street half-width (road + sidewalks), m. */
  streetHalfWidth: number;
  scaleMin: number;
  scaleMax: number;
  /** Chance that each frontage slot gets a building. */
  fillChance: number;
  /** Gap between a building's front and its lot edge (the sidewalk), m. */
  setback: number;
  gapMin: number;
  gapMax: number;
  /** Gap kept between lots and a land edge with no street, m. */
  edgeMargin: number;
  /** How far in front of the door the door slot stands, m. */
  doorOffset: number;
  /** Building piece ids to pick from (uniformly). */
  pieces: string[];
}

/** A lot: the rectangle between streets; `streets` says which of its sides face a street (north is −z). */
export interface Lot { rect: Rect; streets: { n: boolean; s: boolean; w: boolean; e: boolean } }

export interface PlacedBuilding { prop: Prop; solids: Solid[]; door: Vec3 }

export interface FillContext {
  params: FillerParams;
  pieces: readonly PieceEntry[];
  palettes: readonly string[];
  /** No building comes within `radius` of the plaza centre. */
  plaza: { center: Vec3; radius: number };
  newId: () => string;
}

const inside = (r: Rect, outer: Rect): boolean =>
  r.minX >= outer.minX - EPS && r.maxX <= outer.maxX + EPS && r.minZ >= outer.minZ - EPS && r.maxZ <= outer.maxZ + EPS;
const near = (a: Rect, b: Rect, gap: number): boolean =>
  a.minX < b.maxX + gap - EPS && a.maxX > b.minX - gap + EPS && a.minZ < b.maxZ + gap - EPS && a.maxZ > b.minZ - gap + EPS;
const distToRect = (p: Vec3, r: Rect): number =>
  Math.hypot(Math.max(0, r.minX - p.x, p.x - r.maxX), Math.max(0, r.minZ - p.z, p.z - r.maxZ));
const union = (rs: Rect[]): Rect => ({
  minX: Math.min(...rs.map((r) => r.minX)),
  minZ: Math.min(...rs.map((r) => r.minZ)),
  maxX: Math.max(...rs.map((r) => r.maxX)),
  maxZ: Math.max(...rs.map((r) => r.maxZ)),
});

type Side = 'n' | 's' | 'w' | 'e';
/** Facing each street side: the door (+z) turned toward it. */
const FACING: Record<Side, RotY> = { n: 180, s: 0, w: 270, e: 90 };

/**
 * Fills a lot with rows of buildings along each street side (north, south, west, then east), doors to the street,
 * `setback` m back from the lot edge. Rows stop `setback + gapMin` short of a side street, so every building is
 * nearer the street it faces than any other. A slot is skipped with chance 1 − fillChance; a building that would leave
 * the lot, crowd another (closer than gapMin) or enter the plaza is not placed.
 */
export function fillLot(lot: Lot, rng: Rng, ctx: FillContext): PlacedBuilding[] {
  const { params: p, pieces, palettes, plaza } = ctx;
  const { rect } = lot;
  const placed: PlacedBuilding[] = [];
  const taken: Rect[] = [];
  const reserve = p.setback + p.gapMin;

  for (const side of ['n', 's', 'w', 'e'] as const) {
    if (!lot.streets[side]) continue;
    const alongX = side === 'n' || side === 's';
    const start = alongX ? rect.minX + (lot.streets.w ? reserve : 0) : rect.minZ + (lot.streets.n ? reserve : 0);
    const end = alongX ? rect.maxX - (lot.streets.e ? reserve : 0) : rect.maxZ - (lot.streets.s ? reserve : 0);
    const rotY = FACING[side];
    let cursor = start;
    while (cursor < end) {
      const piece = pieces[Math.floor(rng() * pieces.length)]!;
      const scale = r2(p.scaleMin + rng() * (p.scaleMax - p.scaleMin));
      const width = piece.size.x * scale;
      const depth = piece.size.z * scale;
      const gap = p.gapMin + rng() * (p.gapMax - p.gapMin);
      if (cursor + width > end) {
        cursor += 1;
        continue;
      }
      if (rng() >= p.fillChance) {
        cursor += width + gap;
        continue;
      }
      const along = cursor + width / 2;
      const across =
        side === 'n' ? rect.minZ + p.setback + depth / 2
        : side === 's' ? rect.maxZ - p.setback - depth / 2
        : side === 'w' ? rect.minX + p.setback + depth / 2
        : rect.maxX - p.setback - depth / 2;
      const palette = palettes[Math.floor(rng() * palettes.length)]!;
      const position = v2(alongX ? { x: along, y: 0, z: across } : { x: across, y: 0, z: along });
      const prop: Prop = { id: '', piece: piece.id, position, rotY, scale, palette };
      const solids = propSolids(prop, piece);
      const [hx, hz] = alongX ? [width / 2, depth / 2] : [depth / 2, width / 2];
      const footprint = union([
        { minX: position.x - hx, maxX: position.x + hx, minZ: position.z - hz, maxZ: position.z + hz },
        ...solids.map(solidRect),
      ]);
      const fits =
        inside(footprint, rect) &&
        !taken.some((t) => near(footprint, t, p.gapMin)) &&
        distToRect(plaza.center, footprint) > plaza.radius;
      if (!fits) {
        cursor += 1;
        continue;
      }
      prop.id = ctx.newId();
      solids.forEach((s, k) => (s.id = `${prop.id}-c${k}`));
      const front = yawPoint({ x: 0, y: 0, z: depth / 2 + p.doorOffset }, rotY);
      placed.push({ prop, solids, door: v2({ x: position.x + front.x, y: 0, z: position.z + front.z }) });
      taken.push(footprint);
      cursor += width + gap;
    }
  }
  return placed;
}
