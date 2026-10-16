import { cityConfig } from '../config';
import type { CityConfig } from '../config';
import { vec3 } from '../math/vec3';
import { slab } from './slab';
import type { BandId, CityLayout, Connector, Level } from './cityLayout';
import type { Solid } from './mapTypes';

const LEVEL_ORDER: Level[] = ['L0', 'L1', 'L2', 'L3', 'ridge'];
const BAND_ORDER: BandId[] = ['A', 'B', 'C', 'D'];
const DEG = 180 / Math.PI;

type Span = [number, number];
type ConnectorPos = Pick<Connector, 'x' | 'z0' | 'z1' | 'y0' | 'y1'>;

/**
 * A steep lane is a diagonal ramp at a fixed grade: its horizontal run is (y1 - y0) * 100 / gradePct, and it climbs
 * `z1 - z0` northward, so it drifts east by sqrt(run^2 - dz^2). A lane whose run is no longer than dz goes straight north.
 */
export function steepLaneGeometry(c: ConnectorPos, gradePct: number): { run: number; endX: number } {
  const dz = c.z1 - c.z0;
  const run = (Math.abs(c.y1 - c.y0) * 100) / gradePct;
  if (run <= dz) return { run: dz, endX: c.x };
  return { run, endX: c.x + Math.sqrt(run * run - dz * dz) };
}

export interface SwitchbackGeometry {
  /** Entry / exit stub length and hairpin depth */
  landing: number;
  /** Horizontal run of each climbing leg: half the rise at gradePct */
  run: number;
  /** The x span the legs are given (at least `run`); the hairpin landing starts at xs + run */
  span: number;
  /** West end of both legs: the cross street's east kerb */
  xs: number;
  /** East edge of the hairpin landing */
  xEast: number;
  /** Centre z of the climbing (eastbound) and the returning (westbound) leg */
  legZ: [number, number];
  /** Height of the hairpin landing */
  mid: number;
}

/**
 * A switchback is a U (Decision 9): a flat entry stub north from the cross street, a leg climbing east along x, a flat
 * hairpin landing, a leg climbing back west, and a flat exit stub north onto the upper level. Each leg climbs half the
 * rise at `gradePct`; the legs sit `landing` in from the band edges, pushed out to the edges when that would make them
 * overlap (a 30 m band).
 */
export function switchbackGeometry(c: ConnectorPos & Pick<Connector, 'legLength'>, sw: CityConfig['switchback']): SwitchbackGeometry {
  const depth = c.z1 - c.z0;
  const deep = depth >= sw.deepBandMin;
  const landing = deep ? sw.landing : sw.landingShallow;
  const run = ((c.y1 - c.y0) / 2) * (100 / sw.gradePct);
  const span = Math.max(c.legLength ?? (deep ? sw.legLength : sw.legLengthShallow), run);
  const xs = c.x + sw.width / 2;
  let legZ: [number, number] = [c.z0 + landing, c.z1 - landing];
  if (legZ[1] - legZ[0] < sw.width) legZ = [c.z0 + sw.width / 2, c.z1 - sw.width / 2];
  if (legZ[1] - legZ[0] < sw.width) throw new Error(`switchback at x ${c.x}: band ${depth} m deep is too shallow for two ${sw.width} m legs`);
  return { landing, run, span, xs, xEast: xs + span + landing, legZ, mid: (c.y0 + c.y1) / 2 };
}

/** Unit horizontal direction of a steep lane (east and north). */
function laneDir(c: ConnectorPos, gradePct: number): { dx: number; dz: number; run: number; endX: number } {
  const { run, endX } = steepLaneGeometry(c, gradePct);
  const h = Math.hypot(endX - c.x, c.z1 - c.z0);
  return { dx: (endX - c.x) / h, dz: (c.z1 - c.z0) / h, run, endX };
}

/**
 * The x range a connector cuts out of its band's terrain: a switchback's U and a steep lane's footprint plus
 * `slopeBands.gapMargin` (the band gap, floored at y0), a staircase's own width (its steps fill the slot).
 */
export function connectorExtent(c: Connector, city: CityConfig): Span {
  const m = city.slopeBands.gapMargin;
  switch (c.kind) {
    case 'switchback': {
      const g = switchbackGeometry(c, city.switchback);
      return [c.x - city.switchback.width / 2 - m, g.xEast + m];
    }
    case 'steepLane': {
      const { dz, endX } = laneDir(c, city.steepLane.gradePct);
      const half = (city.steepLane.width / 2) * dz;
      return [c.x - half - m, endX + half + m];
    }
    case 'stairs':
      return [c.x - city.stairs.width / 2, c.x + city.stairs.width / 2];
  }
}

/** Where a connector meets its band's upper edge (z1): the x range the parapet leaves open, before its clearance. */
export function connectorMouth(c: Connector, city: CityConfig): Span {
  switch (c.kind) {
    case 'switchback':
      return [c.x - city.switchback.width / 2, c.x + city.switchback.width / 2];
    case 'steepLane': {
      // The deck's end edge is square to the lane, so along z1 it spans from where the west edge crosses z1 to the
      // end edge's southern corner.
      const { dz, endX } = laneDir(c, city.steepLane.gradePct);
      const half = city.steepLane.width / 2;
      return dz >= 1 - 1e-9 ? [endX - half, endX + half] : [endX - half / dz, endX + half * dz];
    }
    case 'stairs':
      return [c.x - city.stairs.width / 2, c.x + city.stairs.width / 2];
  }
}

/** [lo, hi] minus the union of `cuts`, in order (pieces thinner than 1 mm are dropped). */
function freeSpans(lo: number, hi: number, cuts: Span[]): Span[] {
  const out: Span[] = [];
  let x = lo;
  for (const [a, b] of [...cuts].sort((p, q) => p[0] - q[0])) {
    if (a - x > 1e-3) out.push([x, Math.min(a, hi)]);
    x = Math.max(x, b);
  }
  if (hi - x > 1e-3) out.push([x, hi]);
  return out;
}

/** A box `length` long (local x), `thickness` thick and `width` wide whose top-face centre line runs from a to b. */
function ramp(id: string, from: [number, number, number], to: [number, number, number], width: number, thickness: number): Solid {
  // the box is symmetric: go west to east so an x-aligned ramp has no yaw
  const [a, b] = to[0] < from[0] ? [to, from] : [from, to];
  const [dx, dy, dz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const horiz = Math.hypot(dx, dz);
  const length = Math.hypot(horiz, dy);
  const tilt = Math.atan2(dy, horiz);
  // three.js XYZ with x = 0: local +x -> (cos(yaw) cos(tilt), sin(tilt), -sin(yaw) cos(tilt))
  const yaw = Math.atan2(-dz, dx);
  // the box centre is half a thickness under the top face, along the rotated local +y
  const n = [-Math.cos(yaw) * Math.sin(tilt), Math.cos(tilt), Math.sin(yaw) * Math.sin(tilt)];
  const t = thickness / 2;
  return {
    id,
    kind: 'ramp',
    center: vec3((a[0] + b[0]) / 2 - n[0]! * t, (a[1] + b[1]) / 2 - n[1]! * t, (a[2] + b[2]) / 2 - n[2]! * t),
    size: vec3(length, thickness, width),
    rotationDeg: vec3(0, yaw * DEG + 0, tilt * DEG),
  };
}

/** An axis-aligned box from (x0, y0, z0) to (x1, y1, z1). */
function box(id: string, kind: Solid['kind'], x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Solid {
  return { id, kind, center: vec3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), size: vec3(x1 - x0, y1 - y0, z1 - z0) };
}

function switchbackSolids(c: Connector, city: CityConfig): Solid[] {
  const sw = city.switchback;
  const g = switchbackGeometry(c, sw);
  const half = sw.width / 2;
  const [za, zb] = g.legZ;
  const xe = g.xs + g.run;
  const t = city.terrain.slabThickness;
  return [
    slab(`${c.id}-entry`, 'road', c.x - half, c.x + half, c.z0, za + half, c.y0, t),
    ramp(`${c.id}-leg-1`, [g.xs, c.y0, za], [xe, g.mid, za], sw.width, sw.thickness),
    slab(`${c.id}-hairpin`, 'road', xe, g.xEast, za - half, zb + half, g.mid, t),
    ramp(`${c.id}-leg-2`, [xe, g.mid, zb], [g.xs, c.y1, zb], sw.width, sw.thickness),
    slab(`${c.id}-exit`, 'road', c.x - half, c.x + half, zb - half, c.z1, c.y1, t),
  ];
}

function laneSolids(c: Connector, city: CityConfig): Solid[] {
  const { endX } = laneDir(c, city.steepLane.gradePct);
  return [ramp(`${c.id}-ramp`, [c.x, c.y0, c.z0], [endX, c.y1, c.z1], city.steepLane.width, city.steepLane.thickness)];
}

/**
 * One box per step from the band floor up to the step's top (as the SP4 town stairs), straight north from z0, with a
 * landing after every `landingEvery` steps; the slot between the top step and z1 is filled at y1.
 */
function stairSolids(c: Connector, city: CityConfig): Solid[] {
  const st = city.stairs;
  const rise = c.y1 - c.y0;
  const n = Math.round(rise / st.rise);
  if (Math.abs(n * st.rise - rise) > 1e-9) throw new Error(`stairs ${c.id}: a ${rise} m rise is not a whole number of ${st.rise} m steps`);
  const x0 = c.x - st.width / 2;
  const x1 = c.x + st.width / 2;
  const out: Solid[] = [];
  let z = c.z0;
  for (let i = 1; i <= n; i++) {
    const topY = c.y0 + i * st.rise;
    out.push(box(`${c.id}-step-${String(i).padStart(2, '0')}`, 'stairs', x0, x1, c.y0, topY, z, z + st.tread));
    z += st.tread;
    if (i < n && i % st.landingEvery === 0) {
      out.push(box(`${c.id}-landing-${i / st.landingEvery}`, 'stairs', x0, x1, c.y0, topY, z, z + st.landingDepth));
      z += st.landingDepth;
    }
  }
  if (z > c.z1 + 1e-9) throw new Error(`stairs ${c.id}: ${z - c.z0} m of steps do not fit the ${c.z1 - c.z0} m band`);
  if (c.z1 - z > 1e-9) out.push(box(`${c.id}-top`, 'terrain', x0, x1, c.y0, c.y1, z, c.z1));
  return out;
}

/** A band: terrain between the connectors, the connectors, their gaps, and the parapet along the upper edge. */
function bandSolids(b: BandId, layout: CityLayout, city: CityConfig): Solid[] {
  const { z0, z1, y0, y1 } = layout.bands[b];
  const cs = layout.connectors.filter((c) => c.band === b);
  const out: Solid[] = [];
  const extents = cs.map((c) => connectorExtent(c, city));
  // the terrace step: its south face (z0) is the retaining wall, its top is the upper level
  freeSpans(0, layout.size, extents).forEach(([a, e], i) => out.push(box(`band-${b}-terrain-${i}`, 'terrain', a, e, y0, y1, z0, z1)));
  const t = city.terrain.terrainThickness;
  cs.forEach((c, i) => {
    const [a, e] = extents[i]!;
    if (c.kind !== 'stairs') {
      // the band gap: floored at y0 (the U's inside stays at the lower level), closed under the upper level's edge
      out.push(slab(`${c.id}-floor`, 'terrain', a, e, z0, z1, y0, t));
      out.push(box(`${c.id}-wall`, 'terrain', a, e, y0, y1, z1, z1 + t));
    }
    if (c.kind === 'switchback') out.push(...switchbackSolids(c, city));
    else if (c.kind === 'steepLane') out.push(...laneSolids(c, city));
    else out.push(...stairSolids(c, city));
  });
  const p = city.parapet;
  const openings = cs.map((c): Span => {
    const [a, e] = connectorMouth(c, city);
    return [a - p.mouthClearance, e + p.mouthClearance];
  });
  freeSpans(0, layout.size, openings).forEach(([a, e], i) =>
    out.push(box(`band-${b}-parapet-${i}`, 'parapet', a, e, y1, y1 + p.height, z1, z1 + p.thickness)),
  );
  return out;
}

/**
 * The static terrain: one ground per level (L0 split so the water has none), then per slope band its terrain blocks,
 * band gaps, connector solids (switchback ramps and slabs, steep-lane ramps, stair steps) and parapets.
 */
export function terrainSolids(layout: CityLayout, cfg?: { city: CityConfig }): Solid[] {
  const city = cfg?.city ?? cityConfig;
  const c = city.terrain;
  const out: Solid[] = [];
  for (const lv of LEVEL_ORDER) {
    const { y, z0, z1 } = layout.levels[lv];
    if (lv === 'L0') {
      for (const g of c.l0Ground) out.push(slab(`ground-L0-${g.id}`, 'ground', g.x0, g.x1, g.z0, z1, y, c.slabThickness));
    } else {
      out.push(slab(`ground-${lv}`, 'ground', 0, layout.size, z0, z1, y, c.slabThickness));
    }
  }
  for (const b of BAND_ORDER) out.push(...bandSolids(b, layout, city));
  return out;
}
