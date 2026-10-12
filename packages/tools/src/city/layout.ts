import type { Rect, Solid, SolidKind, Vec3 } from '@dm/shared';
import type { CitySource, Edge } from './source';

/** Rounds to 0.01 (the precision of every coordinate in city.json); `+ 0` turns −0 into 0. */
export const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;
export const v2 = (v: Vec3): Vec3 => ({ x: r2(v.x), y: r2(v.y), z: r2(v.z) });

/** An axis-aligned solid over footprint `r`, from `y0` up to `y1` (rounded to 0.01 m). */
export const box = (id: string, kind: SolidKind, r: Rect, y0: number, y1: number): Solid => ({
  id,
  kind,
  center: v2({ x: (r.minX + r.maxX) / 2, y: (y0 + y1) / 2, z: (r.minZ + r.maxZ) / 2 }),
  size: v2({ x: r.maxX - r.minX, y: y1 - y0, z: r.maxZ - r.minZ }),
});
/** The top of an axis-aligned solid. */
export const top = (s: Solid): number => s.center.y + s.size.y / 2;
/** Horizontal distance from a point to a rect (0 inside it). */
export const distToRect = (p: { x: number; z: number }, r: Rect): number =>
  Math.hypot(Math.max(0, r.minX - p.x, p.x - r.maxX), Math.max(0, r.minZ - p.z, p.z - r.maxZ));
/** The smallest rect holding every rect of `rs`. */
export const union = (rs: readonly Rect[]): Rect => ({
  minX: Math.min(...rs.map((r) => r.minX)),
  minZ: Math.min(...rs.map((r) => r.minZ)),
  maxX: Math.max(...rs.map((r) => r.maxX)),
  maxZ: Math.max(...rs.map((r) => r.maxZ)),
});
/**
 * Local street lines sit on whole metres: then every road and sidewalk edge (line ± half-widths, chunk borders) is
 * exact in binary, and a slab's centre ± half-size lands exactly on a chunk border instead of a hair past it (a
 * 66.67 m line puts slab centres on half-centimetres, and float sums 1e-14 over the border).
 */
const snapLine = (v: number): number => Math.round(v) + 0;

export const intersectRect = (a: Rect, b: Rect): Rect => ({
  minX: Math.max(a.minX, b.minX),
  minZ: Math.max(a.minZ, b.minZ),
  maxX: Math.min(a.maxX, b.maxX),
  maxZ: Math.min(a.maxZ, b.maxZ),
});

/** Insets the map square by a per-edge amount (north is −z, west is −x). */
function insetSquare(size: number, inset: (e: Edge) => number): Rect {
  const h = size / 2;
  return { minX: -h + inset('west'), minZ: -h + inset('north'), maxX: h - inset('east'), maxZ: h - inset('south') };
}

/** Where ground tiles go: the map square minus the water beyond each quay line (cliffs stand on ground). */
export function groundRect(src: CitySource): Rect {
  const { waterEdges, quayInset } = src.boundary;
  return insetSquare(src.size, (e) => (waterEdges.includes(e) ? quayInset : 0));
}

/** Where streets and lots go: the ground minus the cliffs. */
export function landRect(src: CitySource): Rect {
  const { waterEdges, cliffEdges, quayInset, cliffDepth } = src.boundary;
  return insetSquare(src.size, (e) => (waterEdges.includes(e) ? quayInset : cliffEdges.includes(e) ? cliffDepth : 0));
}

/** City-wide arterial grid: x = const lines (running north–south) and z = const lines, every `pitch` m. */
export interface ArterialLines { xs: number[]; zs: number[]; halfWidth: number }

/** Arterials at every multiple of `pitch` strictly inside the land (they never run along an edge). */
export function arterialLines(src: CitySource, land: Rect): ArterialLines {
  const { pitch, halfWidth } = src.arterials;
  const multiples = (min: number, max: number): number[] => {
    const out: number[] = [];
    for (let k = Math.floor(min / pitch) + 1; k * pitch < max; k++) if (k * pitch > min) out.push(r2(k * pitch));
    return out;
  };
  return { xs: multiples(land.minX, land.maxX), zs: multiples(land.minZ, land.maxZ), halfWidth };
}

/**
 * One line of a district grid along one axis. `edge` lines are district or land borders with no street of their own;
 * `inset` is how far lots stay from the line (the street's half-width, or the edge margin).
 */
export interface GridLine { at: number; kind: 'arterial' | 'local' | 'edge'; inset: number }

/**
 * The street lines across [min, max] on one axis: the arterials inside it, and local streets splitting each span
 * between arterials (or edges) into equal blocks of about `pitch` m (each line snapped to a whole metre).
 */
export function gridLines(
  min: number,
  max: number,
  arterials: ArterialLines,
  axis: 'x' | 'z',
  local: { pitch: number; halfWidth: number; edgeMargin: number },
): GridLine[] {
  const art = (axis === 'x' ? arterials.xs : arterials.zs).filter((a) => a >= min && a <= max);
  const bounds: GridLine[] = [];
  const edgeOrArterial = (at: number): GridLine =>
    art.includes(at) ? { at, kind: 'arterial', inset: arterials.halfWidth } : { at, kind: 'edge', inset: local.edgeMargin };
  bounds.push(edgeOrArterial(r2(min)));
  for (const a of art) if (a !== r2(min) && a !== r2(max)) bounds.push({ at: a, kind: 'arterial', inset: arterials.halfWidth });
  bounds.push(edgeOrArterial(r2(max)));

  const out: GridLine[] = [];
  bounds.forEach((b, i) => {
    out.push(b);
    const next = bounds[i + 1];
    if (!next) return;
    const n = Math.max(1, Math.round((next.at - b.at) / local.pitch));
    for (let k = 1; k < n; k++) out.push({ at: snapLine(b.at + ((next.at - b.at) * k) / n), kind: 'local', inset: local.halfWidth });
  });
  return out;
}
