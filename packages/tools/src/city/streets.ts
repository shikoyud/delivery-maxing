import type { Hub, Rect, Solid, StreetEdge, StreetNode, Vec3 } from '@dm/shared';
import { type ArterialLines, r2, v2 } from './layout';
import type { StreetStyle } from './source';

export interface StreetGraph { nodes: StreetNode[]; edges: StreetEdge[] }

const EPS = 1e-6;
const posKey = (p: Vec3): string => `${r2(p.x)},${r2(p.y)},${r2(p.z)}`;

/** Builds a street graph; nodes at the same (rounded) position are shared. Ids are `<prefix><n>`. */
export class GraphBuilder {
  private readonly byPos = new Map<string, StreetNode>();
  private readonly edgeKeys = new Set<string>();
  readonly nodes: StreetNode[] = [];
  readonly edges: StreetEdge[] = [];

  constructor(private readonly prefix: string) {}

  node(p: Vec3, plaza = false, id?: string): string {
    const key = posKey(p);
    const found = this.byPos.get(key);
    if (found) {
      found.plaza ||= plaza;
      return found.id;
    }
    const n: StreetNode = { id: id ?? `${this.prefix}${this.nodes.length}`, p: v2(p), plaza };
    this.byPos.set(key, n);
    this.nodes.push(n);
    return n.id;
  }

  edge(a: string, b: string, halfWidth: number, long = false): void {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (this.edgeKeys.has(key)) return;
    this.edgeKeys.add(key);
    this.edges.push({ a, b, halfWidth, long });
  }

  /** A street through `points` in order: one edge between each consecutive pair. */
  street(points: Vec3[], halfWidth: number): void {
    const ids = points.map((p) => this.node(p));
    for (let i = 1; i < ids.length; i++) this.edge(ids[i - 1]!, ids[i]!, halfWidth);
  }

  graph(): StreetGraph {
    return { nodes: this.nodes, edges: this.edges };
  }
}

/**
 * The arterial grid across the land. Arterials through the hub stop at the plaza edge (nodes flagged `plaza`), and a
 * `hub` node at the plaza centre joins those ends so the graph stays connected through the plaza.
 */
export function arterialGraph(land: Rect, arterials: ArterialLines, hub: Hub, clearRadius: number): StreetGraph {
  const g = new GraphBuilder('art-');
  const c = hub.center;
  const hubId = g.node(c, true, 'hub');
  const lines: { fixed: number; along: number[]; vertical: boolean }[] = [
    ...arterials.xs.map((x) => ({ fixed: x, along: [land.minZ, ...arterials.zs, land.maxZ], vertical: true })),
    ...arterials.zs.map((z) => ({ fixed: z, along: [land.minX, ...arterials.xs, land.maxX], vertical: false })),
  ];
  for (const { fixed, along, vertical } of lines) {
    const off = fixed - (vertical ? c.x : c.z);
    const mid = vertical ? c.z : c.x;
    const at = (s: number): Vec3 => (vertical ? { x: fixed, y: 0, z: s } : { x: s, y: 0, z: fixed });
    if (Math.abs(off) > EPS) {
      if (Math.abs(off) < clearRadius) throw new Error(`arterial at ${fixed} grazes the plaza; it must pass through its centre or clear it`);
      g.street(along.map(at), arterials.halfWidth);
      continue;
    }
    // Through the plaza: two halves ending on the plaza edge, each joined to the hub node
    const r = hub.plazaRadius;
    const before = [...along.filter((s) => s < mid - r), mid - r].map(at);
    const after = [mid + r, ...along.filter((s) => s > mid + r)].map(at);
    g.street(before, arterials.halfWidth);
    g.street(after, arterials.halfWidth);
    for (const end of [at(mid - r), at(mid + r)]) g.edge(hubId, g.node(end, true), arterials.halfWidth);
  }
  return g.graph();
}

/**
 * Merges street graphs: nodes at the same position become one (the first graph's id wins), and an edge with another
 * node lying on it is split there, so a local street ending on an arterial joins it.
 */
export function mergeStreetGraphs(graphs: StreetGraph[]): StreetGraph {
  const g = new GraphBuilder('');
  const rename = new Map<string, string>();
  for (const graph of graphs) for (const n of graph.nodes) rename.set(n.id, g.node(n.p, n.plaza, n.id));
  const pos = new Map(g.nodes.map((n) => [n.id, n.p]));

  for (const graph of graphs) {
    for (const e of graph.edges) {
      const a = rename.get(e.a);
      const b = rename.get(e.b);
      if (!a || !b) throw new Error(`street edge ${e.a}-${e.b} names an unknown node`);
      const pa = pos.get(a)!;
      const pb = pos.get(b)!;
      const len2 = (pb.x - pa.x) ** 2 + (pb.y - pa.y) ** 2 + (pb.z - pa.z) ** 2;
      const inner: { t: number; id: string }[] = [];
      for (const n of g.nodes) {
        if (n.id === a || n.id === b) continue;
        const t = ((n.p.x - pa.x) * (pb.x - pa.x) + (n.p.y - pa.y) * (pb.y - pa.y) + (n.p.z - pa.z) * (pb.z - pa.z)) / len2;
        if (t <= 0 || t >= 1) continue;
        const d = Math.hypot(pa.x + (pb.x - pa.x) * t - n.p.x, pa.y + (pb.y - pa.y) * t - n.p.y, pa.z + (pb.z - pa.z) * t - n.p.z);
        if (d < 0.01) inner.push({ t, id: n.id });
      }
      const chain = [a, ...inner.sort((p, q) => p.t - q.t).map((i) => i.id), b];
      for (let i = 1; i < chain.length; i++) g.edge(chain[i - 1]!, chain[i]!, e.halfWidth, e.long);
    }
  }
  return g.graph();
}

type Kind = 'road' | 'sidewalk';
/** A road or sidewalk cell of a street level (the street's y: the slab's top is that much above it). */
interface Cell { kind: Kind; r: Rect; level: number }
interface Arms { n: number; s: number; e: number; w: number }

const rect = (x0: number, x1: number, z0: number, z1: number): Rect => ({
  minX: r2(Math.min(x0, x1)),
  maxX: r2(Math.max(x0, x1)),
  minZ: r2(Math.min(z0, z1)),
  maxZ: r2(Math.max(z0, z1)),
});

/** Joins same-kind rects that touch along `axis` and share the same extent across it. */
function mergeAlong(cells: Cell[], axis: 'x' | 'z'): Cell[] {
  const groups = new Map<string, Cell[]>();
  for (const c of cells) {
    const key = axis === 'x' ? `${c.kind}|${c.level}|${c.r.minZ}|${c.r.maxZ}` : `${c.kind}|${c.level}|${c.r.minX}|${c.r.maxX}`;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  const lo = axis === 'x' ? 'minX' : 'minZ';
  const hi = axis === 'x' ? 'maxX' : 'maxZ';
  const out: Cell[] = [];
  for (const list of groups.values()) {
    list.sort((p, q) => p.r[lo] - q.r[lo]);
    let cur: Cell | null = null;
    for (const c of list) {
      if (cur && c.r[lo] <= cur.r[hi] + EPS) cur.r[hi] = Math.max(cur.r[hi], c.r[hi]);
      else {
        cur = { kind: c.kind, r: { ...c.r }, level: c.level };
        out.push(cur);
      }
    }
  }
  return out;
}

/** Cuts a rect at every chunk border it crosses. */
export function splitAtChunks(r: Rect, size: number): Rect[] {
  const cuts = (min: number, max: number): number[] => {
    const out = [min];
    for (let k = Math.floor(min / size) + 1; k * size < max - EPS; k++) if (k * size > min + EPS) out.push(k * size);
    out.push(max);
    return out;
  };
  const xs = cuts(r.minX, r.maxX);
  const zs = cuts(r.minZ, r.maxZ);
  const out: Rect[] = [];
  for (let i = 1; i < xs.length; i++) {
    for (let j = 1; j < zs.length; j++) out.push({ minX: xs[i - 1]!, maxX: xs[i]!, minZ: zs[j - 1]!, maxZ: zs[j]! });
  }
  return out;
}

/**
 * Road and sidewalk solids for the flat, axis-aligned edges of a street graph, split at chunk borders. Each edge is a
 * road strip with a sidewalk on each side (`halfWidth` covers both). Where streets cross, the junction box gets road
 * toward each arm and sidewalk at its corners and on armless sides, so sidewalks run unbroken past T-junctions.
 * Each slab stands at its street's level (the nodes' y). Edges inside the plaza (both ends `plaza`) and sloped or
 * diagonal edges get no solids here.
 */
export function streetSolids(graph: StreetGraph, style: StreetStyle, chunkSize: number): Solid[] {
  const pos = new Map(graph.nodes.map((n) => [n.id, n]));
  const arms = new Map<string, Arms>(graph.nodes.map((n) => [n.id, { n: 0, s: 0, e: 0, w: 0 }]));
  const flat: { a: StreetNode; b: StreetNode; hw: number; horizontal: boolean }[] = [];
  for (const e of graph.edges) {
    const a = pos.get(e.a)!;
    const b = pos.get(e.b)!;
    if (a.plaza && b.plaza) continue;
    if (Math.abs(a.p.y - b.p.y) > EPS) continue;
    const horizontal = Math.abs(a.p.z - b.p.z) < EPS;
    if (!horizontal && Math.abs(a.p.x - b.p.x) > EPS) continue;
    const [lo, hi] = (horizontal ? a.p.x < b.p.x : a.p.z < b.p.z) ? [a, b] : [b, a];
    const al = arms.get(lo.id)!;
    const ah = arms.get(hi.id)!;
    if (horizontal) [al.e, ah.w] = [Math.max(al.e, e.halfWidth), Math.max(ah.w, e.halfWidth)];
    else [al.s, ah.n] = [Math.max(al.s, e.halfWidth), Math.max(ah.n, e.halfWidth)];
    flat.push({ a: lo, b: hi, hw: e.halfWidth, horizontal });
  }
  const sw = style.sidewalkWidth;
  /** Half-size of the junction box at a node, or 0 along both axes when the streets do not cross there. */
  const box = (id: string): { hx: number; hz: number } => {
    const m = arms.get(id)!;
    const hx = Math.max(m.n, m.s);
    const hz = Math.max(m.e, m.w);
    return hx > 0 && hz > 0 ? { hx, hz } : { hx: 0, hz: 0 };
  };

  const cells: Cell[] = [];
  /** Adds cells to the street level `level` (empty rects are dropped). */
  const adder =
    (level: number) =>
    (kind: Kind, r: Rect): void => {
      if (r.maxX - r.minX > EPS && r.maxZ - r.minZ > EPS) cells.push({ kind, r, level });
    };
  for (const { a, b, hw, horizontal } of flat) {
    const add = adder(a.p.y);
    const rw = hw - sw;
    if (horizontal) {
      const x0 = a.p.x + box(a.id).hx;
      const x1 = b.p.x - box(b.id).hx;
      if (x1 <= x0) continue;
      const z = a.p.z;
      add('road', rect(x0, x1, z - rw, z + rw));
      add('sidewalk', rect(x0, x1, z - hw, z - rw));
      add('sidewalk', rect(x0, x1, z + rw, z + hw));
    } else {
      const z0 = a.p.z + box(a.id).hz;
      const z1 = b.p.z - box(b.id).hz;
      if (z1 <= z0) continue;
      const x = a.p.x;
      add('road', rect(x - rw, x + rw, z0, z1));
      add('sidewalk', rect(x - hw, x - rw, z0, z1));
      add('sidewalk', rect(x + rw, x + hw, z0, z1));
    }
  }
  for (const n of graph.nodes) {
    const { hx, hz } = box(n.id);
    if (hx === 0) continue;
    const m = arms.get(n.id)!;
    const { x, z } = n.p;
    const add = adder(n.p.y);
    const [rx, rz] = [hx - sw, hz - sw];
    const xs = [x - hx, x - rx, x + rx, x + hx];
    const zs = [z - hz, z - rz, z + rz, z + hz];
    // 3 × 3 cells: centre road, corners sidewalk. A side cell is sidewalk, except where an arm leaves that way: there
    // it carries that arm's own road width (an arm narrower than the box keeps sidewalk beside its road).
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const r = rect(xs[col]!, xs[col + 1]!, zs[row]!, zs[row + 1]!);
        const arm = row === 0 && col === 1 ? m.n : row === 2 && col === 1 ? m.s : row === 1 && col === 0 ? m.w : row === 1 && col === 2 ? m.e : -1;
        if (row === 1 && col === 1) add('road', r);
        else if (arm <= 0) add('sidewalk', r);
        else if (col === 1) {
          const rw = Math.min(arm - sw, rx);
          add('road', rect(x - rw, x + rw, r.minZ, r.maxZ));
          add('sidewalk', rect(x - rx, x - rw, r.minZ, r.maxZ));
          add('sidewalk', rect(x + rw, x + rx, r.minZ, r.maxZ));
        } else {
          const rw = Math.min(arm - sw, rz);
          add('road', rect(r.minX, r.maxX, z - rw, z + rw));
          add('sidewalk', rect(r.minX, r.maxX, z - rz, z - rw));
          add('sidewalk', rect(r.minX, r.maxX, z + rw, z + rz));
        }
      }
    }
  }

  const merged = mergeAlong(mergeAlong(cells, 'x'), 'z');
  const pieces = merged.flatMap((c) => splitAtChunks(c.r, chunkSize).map((r) => ({ kind: c.kind, r, level: c.level })));
  pieces.sort((p, q) =>
    p.kind === q.kind ? p.level - q.level || p.r.minZ - q.r.minZ || p.r.minX - q.r.minX : p.kind === 'road' ? -1 : 1,
  );
  const counters = { road: 0, sidewalk: 0 };
  return pieces.map(({ kind, r, level: y }) => {
    const top = kind === 'road' ? style.roadTop : style.sidewalkTop;
    // Slabs reach as far below their level (into the ground) as above it, so the centre stays on the 0.01 grid
    return {
      id: `${kind === 'road' ? 'road' : 'walk'}-${counters[kind]++}`,
      kind,
      center: v2({ x: (r.minX + r.maxX) / 2, y, z: (r.minZ + r.maxZ) / 2 }),
      size: v2({ x: r.maxX - r.minX, y: 2 * top, z: r.maxZ - r.minZ }),
    };
  });
}
