import { vec3, type Vec3 } from '../math/vec3';
import type { Rng } from '../util/rng';
import type { CityMap } from './cityTypes';
import type { Hub } from './mapTypes';

/** Side of a cell of the projection grid, m (a few street half-widths). */
const CELL = 25;
/** Distances this close count as equal when comparing projections. */
const TIE = 1e-9;

interface Edge { a: number; b: number; ax: number; ay: number; az: number; bx: number; by: number; bz: number; hw: number; len2: number }
/** Accept only strip points whose height is within `maxDy` of `y` (one street level). */
interface Level { y: number; maxDy: number }
/** A projection query: an optional level, and an edge preferred among the strips holding the point (−1: none). */
interface Query { level: Level | null; prefer: number }
/**
 * A point of a strip: `out` is how far (horizontally) the query lies outside it, `dy` the height difference, `capped`
 * whether it lies on the strip's round end cap (past an end node, where the edge's height stays the node's).
 */
interface Hit { x: number; y: number; z: number; edge: number; out: number; dy: number; centre: number; capped: boolean }

/**
 * The street graph as thieves see it (spec §7.3): they walk only on the edge strips (a capsule of `halfWidth` around
 * each edge, horizontally), never on plaza nodes or inside the HUB exclusion (`hub.plazaRadius + plazaMargin`).
 * Edges joining two such blocked nodes are not thief streets at all.
 */
export class StreetGraph {
  private readonly ids: string[];
  private readonly index = new Map<string, number>();
  private readonly pos: Vec3[];
  private readonly blocked: boolean[];
  /** Per node: [neighbour, edge length] for the thief streets. */
  private readonly adj: [number, number][][];
  private readonly edges: (Edge | null)[];
  private readonly centre: Vec3;
  private readonly exclusion: number;
  /** The steepest thief street: rise over horizontal run. */
  readonly maxSlope: number;
  private readonly grid: Map<number, number[]> = new Map();
  private readonly gx0: number;
  private readonly gz0: number;
  private readonly gw: number;
  private readonly gh: number;
  /** Per edge, the query that last visited it (so a ring search tests each edge once). */
  private readonly stamp: number[];
  private query = 0;

  constructor(data: CityMap['streets'], hub: Hub, plazaMargin: number) {
    this.centre = hub.center;
    this.exclusion = hub.plazaRadius + plazaMargin;
    this.ids = data.nodes.map((n) => n.id);
    this.ids.forEach((id, i) => this.index.set(id, i));
    this.pos = data.nodes.map((n) => vec3(n.p.x, n.p.y, n.p.z));
    this.blocked = data.nodes.map((n) => n.plaza || this.inExclusion(n.p.x, n.p.z));
    this.adj = data.nodes.map(() => []);
    this.edges = data.edges.map((e) => {
      const a = this.node(e.a);
      const b = this.node(e.b);
      if (a === b || (this.blocked[a] && this.blocked[b])) return null;
      const [pa, pb] = [this.pos[a]!, this.pos[b]!];
      const len2 = (pb.x - pa.x) ** 2 + (pb.z - pa.z) ** 2;
      if (len2 === 0) return null;
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
      if (!this.blocked[a] && !this.blocked[b]) {
        this.adj[a]!.push([b, len]);
        this.adj[b]!.push([a, len]);
      }
      return { a, b, ax: pa.x, ay: pa.y, az: pa.z, bx: pb.x, by: pb.y, bz: pb.z, hw: e.halfWidth, len2 };
    });
    this.stamp = this.edges.map(() => 0);
    this.maxSlope = Math.max(0, ...this.edges.map((e) => (e ? Math.abs(e.by - e.ay) / Math.sqrt(e.len2) : 0)));

    const live = this.edges.filter((e): e is Edge => e !== null);
    const minX = Math.min(...live.map((e) => Math.min(e.ax, e.bx) - e.hw));
    const minZ = Math.min(...live.map((e) => Math.min(e.az, e.bz) - e.hw));
    const maxX = Math.max(...live.map((e) => Math.max(e.ax, e.bx) + e.hw));
    const maxZ = Math.max(...live.map((e) => Math.max(e.az, e.bz) + e.hw));
    this.gx0 = minX;
    this.gz0 = minZ;
    this.gw = Math.max(1, Math.ceil((maxX - minX) / CELL));
    this.gh = Math.max(1, Math.ceil((maxZ - minZ) / CELL));
    this.edges.forEach((e, k) => {
      if (!e) return;
      const [i0, i1] = [this.cellX(Math.min(e.ax, e.bx) - e.hw), this.cellX(Math.max(e.ax, e.bx) + e.hw)];
      const [j0, j1] = [this.cellZ(Math.min(e.az, e.bz) - e.hw), this.cellZ(Math.max(e.az, e.bz) + e.hw)];
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const key = j * this.gw + i;
          const list = this.grid.get(key);
          if (list) list.push(k);
          else this.grid.set(key, [k]);
        }
      }
    });
  }

  /** Whether thieves may stand on this node (it is no plaza node and lies outside the HUB exclusion). */
  isThiefNode(id: string): boolean {
    return !this.blocked[this.node(id)];
  }

  /** The thief-street neighbours of a node, in edge order. */
  neighbours(id: string): string[] {
    return this.adj[this.node(id)]!.map(([n]) => this.ids[n]!);
  }

  position(id: string): Vec3 {
    const p = this.pos[this.node(id)]!;
    return vec3(p.x, p.y, p.z);
  }

  /** The edge's end nodes. */
  edgeEnds(edge: number): [string, string] {
    const e = this.edges[edge];
    if (!e) throw new Error(`street edge ${edge} is not a thief street`);
    return [this.ids[e.a]!, this.ids[e.b]!];
  }

  /**
   * The nearest point inside any edge strip, with y interpolated along that edge, and never inside the HUB exclusion
   * (a point there is pushed out radially onto a strip). Among strips that hold the point, the one nearest in height wins.
   */
  project(p: Vec3): { p: Vec3; edge: number } {
    const out = this.projectWithin(p, { level: null, prefer: -1 });
    if (!out) throw new Error('street graph has no thief streets');
    return out;
  }

  /**
   * project, restricted to one street level: only strip points whose height is within `maxDy` of `y` count, so a
   * thief moving a step never lands on a street beside or over its own (a terrace, a bridge), nor drops off a ledge
   * onto one below. Null when no street of that level exists. Among strips holding the point, `prefer` (an edge
   * index) wins first: a chaser heads onto the courier's street where it meets its own.
   */
  projectOnLevel(p: Vec3, y: number, maxDy: number, prefer = -1): { p: Vec3; edge: number } | null {
    return this.projectWithin(p, { level: { y, maxDy }, prefer });
  }

  /**
   * The node path that takes a thief at `from` on edge `fromEdge` round the streets to `to` on edge `toEdge`: from an
   * end of the one to an end of the other, whichever pair makes the shortest walk (straight to the first node, along
   * the path, straight on to `to`). [] if they are not connected.
   */
  routeToward(from: Vec3, fromEdge: number, to: Vec3, toEdge: number): string[] {
    let best: string[] = [];
    let bestLen = Infinity;
    for (const a of this.edgeEnds(fromEdge).filter((n) => this.isThiefNode(n))) {
      for (const b of this.edgeEnds(toEdge).filter((n) => this.isThiefNode(n))) {
        const path = this.route(a, b);
        if (path.length === 0) continue;
        const pts = [from, ...path.map((n) => this.pos[this.node(n)]!), to];
        let len = 0;
        for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y, pts[i]!.z - pts[i - 1]!.z);
        if (len < bestLen - TIE) [best, bestLen] = [path, len];
      }
    }
    return best;
  }

  /** A random thief-street neighbour of `from`, other than `prev` unless it is the only one (`from` when isolated). */
  nextNode(from: string, prev: string | null, rng: Rng): string {
    const all = this.neighbours(from);
    if (all.length === 0) return from;
    const ahead = all.filter((n) => n !== prev);
    const pick = ahead.length > 0 ? ahead : all;
    return pick[Math.min(pick.length - 1, Math.floor(rng() * pick.length))]!;
  }

  /** The shortest node path from `fromNode` to `toNode` over the thief streets (A*), both included; [] if none. */
  route(fromNode: string, toNode: string): string[] {
    const s = this.node(fromNode);
    const t = this.node(toNode);
    if (this.blocked[s] || this.blocked[t]) return [];
    const goal = this.pos[t]!;
    const h = (i: number): number => {
      const p = this.pos[i]!;
      return Math.hypot(p.x - goal.x, p.y - goal.y, p.z - goal.z);
    };
    const g = new Map<number, number>([[s, 0]]);
    const came = new Map<number, number>();
    const closed = new Set<number>();
    const open = new MinHeap();
    open.push(s, h(s));
    while (open.size > 0) {
      const u = open.pop();
      if (u === t) break;
      if (closed.has(u)) continue;
      closed.add(u);
      for (const [v, w] of this.adj[u]!) {
        const cost = g.get(u)! + w;
        if (cost < (g.get(v) ?? Infinity)) {
          g.set(v, cost);
          came.set(v, u);
          open.push(v, cost + h(v));
        }
      }
    }
    if (!g.has(t)) return [];
    const path = [t];
    while (path[path.length - 1] !== s) path.push(came.get(path[path.length - 1]!)!);
    return path.reverse().map((i) => this.ids[i]!);
  }

  /** The nearest node (3D) thieves may stand on. */
  nearestNode(p: Vec3): string {
    let best = -1;
    let bestD = Infinity;
    this.pos.forEach((q, i) => {
      if (this.blocked[i]) return;
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
      if (d < bestD) [best, bestD] = [i, d];
    });
    if (best < 0) throw new Error('street graph has no node thieves may use');
    return this.ids[best]!;
  }

  private node(id: string): number {
    const i = this.index.get(id);
    if (i === undefined) throw new Error(`unknown street node ${id}`);
    return i;
  }

  private inExclusion(x: number, z: number): boolean {
    return Math.hypot(x - this.centre.x, z - this.centre.z) < this.exclusion;
  }

  private cellX(x: number): number {
    return Math.min(this.gw - 1, Math.max(0, Math.floor((x - this.gx0) / CELL)));
  }

  private cellZ(z: number): number {
    return Math.min(this.gh - 1, Math.max(0, Math.floor((z - this.gz0) / CELL)));
  }

  private projectWithin(p: Vec3, q: Query): { p: Vec3; edge: number } | null {
    const hit = this.nearestOnStrips(p, q);
    if (!hit) return null;
    if (!this.inExclusion(hit.x, hit.z)) return { p: vec3(hit.x, hit.y, hit.z), edge: hit.edge };
    const dx = hit.x - this.centre.x;
    const dz = hit.z - this.centre.z;
    const d = Math.hypot(dx, dz);
    if (d > 0) {
      const k = this.exclusion / d;
      const out = this.nearestOnStrips(vec3(this.centre.x + dx * k, p.y, this.centre.z + dz * k), q);
      if (out && out.out <= TIE) return { p: vec3(out.x, out.y, out.z), edge: out.edge };
    }
    return this.nearestCentreOutside(p, q.level);
  }

  /**
   * The nearest strip point (on `level`, if given), by rings of grid cells around p until no farther ring can hold a
   * nearer one.
   */
  private nearestOnStrips(p: Vec3, { level, prefer }: Query): Hit | null {
    this.query++;
    const ci = this.cellX(p.x);
    const cj = this.cellZ(p.z);
    let best = null as Hit | null;
    const maxR = Math.max(this.gw, this.gh);
    for (let r = 0; r <= maxR; r++) {
      for (let j = cj - r; j <= cj + r; j++) {
        if (j < 0 || j >= this.gh) continue;
        const step = j === cj - r || j === cj + r ? 1 : 2 * r;
        for (let i = ci - r; i <= ci + r; i += Math.max(1, step)) {
          if (i < 0 || i >= this.gw) continue;
          for (const k of this.grid.get(j * this.gw + i) ?? []) {
            if (this.stamp[k] === this.query) continue;
            this.stamp[k] = this.query;
            const hit = stripPoint(this.edges[k]!, k, p);
            if (level && Math.abs(hit.y - level.y) > level.maxDy) continue;
            if (!best || better(hit, best, prefer)) best = hit;
          }
        }
      }
      // Cells of ring r + 1 lie at least r cells away from p (p outside the grid lies farther still)
      if (best && best.out <= r * CELL) return best;
    }
    return best;
  }

  /** Fallback: the nearest point to p on any edge's centre line outside the exclusion (on `level`, if given). */
  private nearestCentreOutside(p: Vec3, level: Level | null): { p: Vec3; edge: number } | null {
    let best = null as { p: Vec3; edge: number } | null;
    let bestD = Infinity;
    this.edges.forEach((e, k) => {
      if (!e) return;
      const ex = e.bx - e.ax;
      const ez = e.bz - e.az;
      // The centre line is inside the exclusion for t in (t0, t1)
      const fx = e.ax - this.centre.x;
      const fz = e.az - this.centre.z;
      const A = e.len2;
      const B = 2 * (fx * ex + fz * ez);
      const C = fx * fx + fz * fz - this.exclusion * this.exclusion;
      const disc = B * B - 4 * A * C;
      const ts: number[] = [];
      const t = clamp01(((p.x - e.ax) * ex + (p.z - e.az) * ez) / A);
      if (disc <= 0) ts.push(t);
      else {
        const t0 = (-B - Math.sqrt(disc)) / (2 * A);
        const t1 = (-B + Math.sqrt(disc)) / (2 * A);
        if (t <= t0 || t >= t1) ts.push(t);
        else ts.push(t0, t1);
      }
      for (const u of ts) {
        if (u < 0 || u > 1) continue;
        const x = e.ax + ex * u;
        const z = e.az + ez * u;
        const y = e.ay + (e.by - e.ay) * u;
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < bestD && (!level || Math.abs(y - level.y) <= level.maxDy)) {
          bestD = d;
          best = { p: vec3(x, y, z), edge: k };
        }
      }
    });
    return best;
  }
}

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** The point of edge `e`'s strip nearest to p (horizontally), with y along the edge. */
function stripPoint(e: Edge, edge: number, p: Vec3): Hit {
  const ex = e.bx - e.ax;
  const ez = e.bz - e.az;
  const raw = ((p.x - e.ax) * ex + (p.z - e.az) * ez) / e.len2;
  const t = clamp01(raw);
  const capped = raw < -TIE || raw > 1 + TIE;
  const cx = e.ax + ex * t;
  const cz = e.az + ez * t;
  const y = e.ay + (e.by - e.ay) * t;
  const centre = Math.hypot(p.x - cx, p.z - cz);
  if (centre <= e.hw) return { x: p.x, y, z: p.z, edge, out: 0, dy: Math.abs(p.y - y), centre, capped };
  const k = e.hw / centre;
  return { x: cx + (p.x - cx) * k, y, z: cz + (p.z - cz) * k, edge, out: centre - e.hw, dy: Math.abs(p.y - y), centre, capped };
}

/**
 * Nearer strip first. Between strips holding the point: the preferred edge; then an edge's body over another's end
 * cap (past a node the next edge carries the height on, not the flat cap of the edge before); then the nearer in
 * height, then the nearer centre line.
 */
function better(a: Hit, b: Hit, prefer: number): boolean {
  if (Math.abs(a.out - b.out) > TIE) return a.out < b.out;
  if ((a.edge === prefer) !== (b.edge === prefer)) return a.edge === prefer;
  if (a.capped !== b.capped) return !a.capped;
  if (Math.abs(a.dy - b.dy) > TIE) return a.dy < b.dy;
  return a.centre < b.centre - TIE;
}

/** A binary min-heap of node indices by priority (A*'s open set). */
class MinHeap {
  private readonly items: [number, number][] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, priority: number): void {
    const a = this.items;
    a.push([item, priority]);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent]![1] <= a[i]![1]) break;
      [a[parent], a[i]] = [a[i]!, a[parent]!];
      i = parent;
    }
  }

  pop(): number {
    const a = this.items;
    const top = a[0]![0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![1] < a[m]![1]) m = l;
        if (r < a.length && a[r]![1] < a[m]![1]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}
