import type { NavLink, Rect, Solid, SolidKind, Vec3 } from '@dm/shared';
import { GridIndex, obstacleOf, type Obstacle } from './kits';
import { contains, distToRect, flatDistance, grow, overlaps } from './layout';

// What stands where in the city, for the POI pass's site searches, and which elevated surfaces the navigation links
// join to the street.

/** Solid kinds a courier stands on at street level: crates, pads, zip ends and drop landings stand on these. */
export const STREET: ReadonlySet<SolidKind> = new Set<SolidKind>(['ground', 'road', 'sidewalk']);
/** Open ground off the streets (yards, lots): kit crates and stalls stand only on this, never on a road or sidewalk. */
export const YARD: ReadonlySet<SolidKind> = new Set<SolidKind>(['ground']);
/** A mailbox stands on the sidewalk. */
export const SIDEWALK: ReadonlySet<SolidKind> = new Set<SolidKind>(['sidewalk']);
/** Solid kinds that are street-level surfaces for navigation (everything else is elevated). */
export const GROUNDS: ReadonlySet<SolidKind> = new Set<SolidKind>(['ground', 'road', 'sidewalk', 'hub', 'stairs', 'ramp', 'chute', 'cliff']);
/** Boxes closer than this (city.json rounds to 0.01 m, half-sizes to 0.005) touch rather than overlap, m. */
export const TOUCH = 0.02;
/** A surface counts as level when within this of the level asked for, m. */
export const LEVEL_TOL = 0.02;
/** Feature lines are marked at points this far apart, m. */
const MARK_STEP = 1;
/** Whether a solid is tilted (turned about x or z): its top is not a flat surface. A turn about y alone keeps it flat. */
export const isTilted = (s: Solid): boolean => !!s.rotationDeg && (s.rotationDeg.x !== 0 || s.rotationDeg.z !== 0);

// ---- Space: what stands where ---------------------------------------------------------------------------------

/** A solid as the POI pass sees it: its footprint and vertical extent (of its turned box). */
export interface Entry { rect: Rect; top: number; bottom: number; solid: Solid; tilted: boolean }

/** The city's solids and the spots its movement features need clear, for site searches. */
export class Space {
  private readonly solids: GridIndex<Entry>;
  private readonly marks: GridIndex<{ rect: Rect }>;

  constructor(cell: number) {
    this.solids = new GridIndex<Entry>(cell);
    this.marks = new GridIndex<{ rect: Rect }>(cell);
  }

  addSolid(s: Solid): void {
    const o = obstacleOf(s);
    this.solids.add({ rect: o.rect, top: o.top, bottom: 2 * s.center.y - o.top, solid: s, tilted: isTilted(s) });
  }

  /** Marks a spot movement features need clear. */
  mark(p: { x: number; z: number }): void {
    this.marks.add({ rect: { minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z } });
  }

  /** Marks a line (its horizontal trace) every MARK_STEP. */
  markLine(a: Vec3, b: Vec3): void {
    const n = Math.max(1, Math.ceil(flatDistance(a, b) / MARK_STEP));
    for (let k = 0; k <= n; k++) this.mark({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }

  /**
   * What a body dropped at (x, z) from height y stands on: the highest flat top there at most y (+ slack). Null when
   * nothing is there, when y is inside a solid, or when a tilted solid (a ramp, a chute, a roof slope) is in the way.
   */
  surface(x: number, z: number, y: number): Entry | null {
    let best: Entry | null = null;
    for (const e of this.solids.near({ minX: x, maxX: x, minZ: z, maxZ: z }, 0)) {
      if (!contains(e.rect, x, z) || e.bottom > y + 0.05) continue;
      if (e.tilted || e.top > y + 0.05) return null;
      if (!best || e.top > best.top) best = e;
    }
    return best;
  }

  /** Whether no solid's box overlaps `r` between heights y0 and y1 (touching boxes do not count). */
  free(r: Rect, y0: number, y1: number): boolean {
    return !this.solids.near(r, 0).some((e) => overlaps(e.rect, r, TOUCH) && e.bottom < y1 - 1e-6 && e.top > y0 + 1e-6);
  }

  /** Whether everywhere over `r` (sampled every 0.5 m) the surface is of `kinds`, its top within [lo, hi]. */
  levelIn(r: Rect, lo: number, hi: number, kinds: ReadonlySet<SolidKind>): boolean {
    const nx = Math.max(1, Math.ceil((r.maxX - r.minX) / 0.5));
    const nz = Math.max(1, Math.ceil((r.maxZ - r.minZ) / 0.5));
    const inset = 0.01;
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const x = r.minX + inset + ((r.maxX - r.minX - 2 * inset) * i) / nx;
        const z = r.minZ + inset + ((r.maxZ - r.minZ - 2 * inset) * j) / nz;
        const e = this.surface(x, z, hi + 0.3);
        if (!e || !kinds.has(e.solid.kind) || e.top < lo - 1e-6 || e.top > hi + 1e-6) return false;
      }
    }
    return true;
  }

  /** Whether no marked spot lies within `pad` of `r`. */
  clear(r: Rect, pad: number): boolean {
    return !this.marks.near(r, pad).some((m) => distToRect({ x: m.rect.minX, z: m.rect.minZ }, r) < pad);
  }

  /** The obstacles near `r` (for cable and pad-flight clearance), leaving out street surfaces no higher than `under`. */
  obstacles(r: Rect, pad: number, under = -Infinity): Obstacle[] {
    return this.solids
      .near(r, pad)
      .filter((e) => !(STREET.has(e.solid.kind) && e.top <= under))
      .map((e) => ({ rect: e.rect, top: e.top }));
  }

  /** The non-street solids of the same top touching `e` (one walkable surface across them). */
  touching(e: Entry): Entry[] {
    return this.solids
      .near(e.rect, TOUCH)
      .filter((o) => o !== e && !o.tilted && !GROUNDS.has(o.solid.kind) && Math.abs(o.top - e.top) <= 0.05 && overlaps(o.rect, grow(e.rect, TOUCH), 0));
  }
}

// ---- Reach: which elevated surfaces the navigation links join to the street -----------------------------------

/**
 * The surfaces the navigation links join: the street level is one node, every elevated surface (touching solids of one
 * top) another. A POI on an elevated surface is reachable when links lead there from the street and back.
 */
export class Reach {
  private readonly ids = new Map<Entry, string>();
  private readonly up = new Set<string>(['ground']);
  private readonly down = new Set<string>(['ground']);

  constructor(private readonly space: Space, links: readonly NavLink[]) {
    const fwd = new Map<string, string[]>();
    const back = new Map<string, string[]>();
    const add = (m: Map<string, string[]>, a: string, b: string): void => {
      const l = m.get(a);
      if (l) l.push(b);
      else m.set(a, [b]);
    };
    for (const l of links) {
      const a = this.key(l.from);
      const b = this.key(l.to);
      if (a === null || b === null) continue;
      add(fwd, a, b);
      add(back, b, a);
      if (l.bidirectional) {
        add(fwd, b, a);
        add(back, a, b);
      }
    }
    for (const [graph, seen] of [[fwd, this.up], [back, this.down]] as const) {
      const queue = ['ground'];
      while (queue.length > 0) {
        for (const n of graph.get(queue.shift()!) ?? []) {
          if (seen.has(n)) continue;
          seen.add(n);
          queue.push(n);
        }
      }
    }
  }

  /** Whether links lead from the street to the surface at `p` and back (always true on the street). */
  both(p: Vec3): boolean {
    const k = this.key(p);
    return k !== null && this.up.has(k) && this.down.has(k);
  }

  private key(p: Vec3): string | null {
    const e = this.space.surface(p.x, p.z, p.y);
    if (!e) return null;
    if (GROUNDS.has(e.solid.kind)) return 'ground';
    const known = this.ids.get(e);
    if (known) return known;
    // Flood the touching solids of the same top: one surface, named after its first solid
    const id = e.solid.id;
    const queue = [e];
    this.ids.set(e, id);
    while (queue.length > 0) {
      for (const o of this.space.touching(queue.shift()!)) {
        if (this.ids.has(o)) continue;
        this.ids.set(o, id);
        queue.push(o);
      }
    }
    return id;
  }
}

