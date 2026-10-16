import { describe, expect, it } from 'vitest';
import { cityConfig } from '../../src/config';
import type { CityLayout, Connector } from '../../src/world/cityLayout';
import type { Solid } from '../../src/world/mapTypes';
import { connectorExtent, connectorMouth, freeSpans, steepLaneGeometry, switchbackGeometry, terrainSolids } from '../../src/world/terrainSolids';
import { cityLayoutFixture } from './cityFixtures';

const B = cityConfig.bands.B;
const band = (id: string, kind: Connector['kind'], x: number, extra: Partial<Connector> = {}): Connector => ({ id, kind, band: 'B', x, ...B, ...extra });
const SW = band('sw-b', 'switchback', 228, { legLength: 80 });
const LANE = band('lane-b', 'steepLane', 52);
const STAIRS = band('stairs-b', 'stairs', 170);

/** Band B with one connector of each kind. */
const layoutB = (): CityLayout => ({ ...cityLayoutFixture(), connectors: [SW, LANE, STAIRS] });
const solids = terrainSolids(layoutB());
const of = (prefix: string) => solids.filter((s) => s.id.startsWith(prefix));
const deg = (rad: number) => (rad * 180) / Math.PI;

/** R = Rx * Ry * Rz (three.js 'XYZ'), applied to v. */
function rotate(s: Solid, v: [number, number, number]): [number, number, number] {
  const r = s.rotationDeg ?? { x: 0, y: 0, z: 0 };
  const k = Math.PI / 180;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(r.x * k), Math.sin(r.x * k), Math.cos(r.y * k), Math.sin(r.y * k), Math.cos(r.z * k), Math.sin(r.z * k)];
  const m = [
    [cy * cz, -cy * sz, sy],
    [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
    [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
  ];
  return m.map((row) => row[0]! * v[0] + row[1]! * v[1] + row[2]! * v[2]) as [number, number, number];
}
/** The two ends of a box's top-face centre line along its local x axis, west end first. */
function topEnds(s: Solid): { x: number; y: number; z: number }[] {
  return [-1, 1]
    .map((sign) => {
      const [x, y, z] = rotate(s, [(sign * s.size.x) / 2, s.size.y / 2, 0]);
      return { x: s.center.x + x, y: s.center.y + y, z: s.center.z + z };
    })
    .sort((a, b) => a.x - b.x);
}
const top = (s: Solid) => s.center.y + s.size.y / 2;
const minX = (s: Solid) => s.center.x - s.size.x / 2;
const maxX = (s: Solid) => s.center.x + s.size.x / 2;

describe('freeSpans', () => {
  it('is [lo, hi] minus the union of the cuts, west to east, clamped to hi, without slivers under 1 mm', () => {
    expect(freeSpans(0, 100, [[40, 50], [10, 20], [45, 60], [99.9995, 120]])).toEqual([[0, 10], [20, 40], [60, 99.9995]]);
    expect(freeSpans(0, 100, [[90, 130]])).toEqual([[0, 90]]);
    expect(freeSpans(0, 100, [[-5, 0.0005]])).toEqual([[0.0005, 100]]);
    expect(freeSpans(0, 100, [])).toEqual([[0, 100]]);
  });
});

describe('terrainSolids', () => {
  it('keeps one ground solid per level (L0 split at the water)', () => {
    const ids = terrainSolids(cityLayoutFixture()).filter((s) => s.kind === 'ground').map((s) => s.id);
    expect(ids).toEqual(['ground-L0-docks', 'ground-L0-beach', 'ground-L0-harbor', 'ground-L1', 'ground-L2', 'ground-L3', 'ground-ridge']);
  });

  it('a switchback in band B: 2 ramps tilted 9 % (5.14°) one up one down, at z0 + 14 and z1 - 14, and 3 flat road slabs', () => {
    const g = switchbackGeometry(SW, cityConfig.switchback);
    const ramps = of('sw-b').filter((s) => s.kind === 'ramp');
    expect(ramps).toHaveLength(2);
    const [up, down] = ramps as [Solid, Solid];
    for (const r of ramps) {
      expect(Math.abs(r.rotationDeg!.z)).toBeCloseTo(deg(Math.atan(0.09)), 3);
      expect(Math.abs(r.rotationDeg!.z)).toBeCloseTo(5.14, 2);
      expect(r.rotationDeg!.x).toBe(0);
      expect(r.rotationDeg!.y).toBe(0);
      expect(r.size.y).toBe(0.4);
      expect(r.size.z).toBe(12);
    }
    expect(Math.sign(up.rotationDeg!.z)).toBe(-Math.sign(down.rotationDeg!.z));
    expect(up.center.z).toBe(560 + 14);
    expect(down.center.z).toBe(620 - 14);
    // The legs climb exactly half the rise each: y0 -> mid (eastward), then mid -> y1 (westward).
    const mid = (B.y0 + B.y1) / 2;
    const [upW, upE] = topEnds(up);
    const [downW, downE] = topEnds(down);
    expect(upW!.y).toBeCloseTo(B.y0, 6);
    expect(upE!.y).toBeCloseTo(mid, 6);
    expect(downE!.y).toBeCloseTo(mid, 6);
    expect(downW!.y).toBeCloseTo(B.y1, 6);
    expect(upW!.x).toBeCloseTo(228 + 6, 6);
    expect(upE!.x).toBeCloseTo(g.xs + g.run, 6);
    expect(g.run).toBeCloseTo(7 / 0.09, 6);

    const flats = of('sw-b').filter((s) => s.kind === 'road');
    expect(flats.map((s) => s.id).sort()).toEqual(['sw-b-entry', 'sw-b-exit', 'sw-b-hairpin']);
    const byId = new Map(flats.map((s) => [s.id, s]));
    const entry = byId.get('sw-b-entry')!;
    const hairpin = byId.get('sw-b-hairpin')!;
    const exit = byId.get('sw-b-exit')!;
    expect(top(entry)).toBe(B.y0);
    expect(top(hairpin)).toBe(mid);
    expect(top(exit)).toBe(B.y1);
    expect(entry.center.z - entry.size.z / 2).toBe(560);
    expect(exit.center.z + exit.size.z / 2).toBe(620);
    expect(minX(hairpin)).toBeCloseTo(upE!.x, 6);
    expect(hairpin.size.x).toBeGreaterThanOrEqual(14);
    expect(maxX(entry)).toBe(234);
    expect(maxX(exit)).toBe(234);
    // The U's inside stays at the lower level: the band gap floor.
    const floor = solids.find((s) => s.id === 'sw-b-floor')!;
    expect(floor.kind).toBe('terrain');
    expect(top(floor)).toBe(B.y0);
    expect(minX(floor)).toBeLessThanOrEqual(222);
    expect(maxX(floor)).toBeGreaterThanOrEqual(maxX(hairpin));
  });

  it('a band D switchback (30 m deep) keeps its two legs apart', () => {
    const D = cityConfig.bands.D;
    const sw: Connector = { id: 'sw-d', kind: 'switchback', band: 'D', x: 336, ...D, legLength: 50 };
    const ramps = terrainSolids({ ...cityLayoutFixture(), connectors: [sw] }).filter((s) => s.kind === 'ramp');
    expect(ramps).toHaveLength(2);
    const [a, b] = ramps as [Solid, Solid];
    expect(b.center.z - a.center.z).toBeGreaterThanOrEqual(12);
    const [aW, aE] = topEnds(a);
    const [bW] = topEnds(b);
    expect(aW!.y).toBeCloseTo(D.y0, 6);
    expect(aE!.y).toBeCloseTo((D.y0 + D.y1) / 2, 6);
    expect(bW!.y).toBeCloseTo(D.y1, 6);
  });

  it('a steep lane in band B: a 6 m ramp tilted 14 % climbing y0 -> y1 between z0 and z1, then a flat mouth piece at y1', () => {
    const g = steepLaneGeometry(LANE, cityConfig.steepLane);
    const parts = of('lane-b').filter((s) => s.kind === 'ramp');
    expect(parts.map((s) => s.id).sort()).toEqual(['lane-b-mouth', 'lane-b-ramp']);
    const r = parts.find((s) => s.id === 'lane-b-ramp')!;
    const mouth = parts.find((s) => s.id === 'lane-b-mouth')!;
    expect(r.size.z).toBe(6);
    expect(r.rotationDeg!.z).toBeCloseTo(deg(Math.atan(0.14)), 6);
    expect(r.size.x).toBeCloseTo(Math.hypot(100, 14), 6);
    // yawed along the lane (three.js XYZ: an east-and-north lane has a negative y)
    expect(r.rotationDeg!.y).toBeCloseTo(-deg(Math.atan2(g.dz, g.dx)), 6);
    expect(mouth.rotationDeg!.y).toBeCloseTo(r.rotationDeg!.y, 6);
    expect(mouth.rotationDeg!.z).toBeCloseTo(0, 9);
    expect(mouth.size.z).toBe(6);
    // about 84 m east for 55 m north of centre line, as the deck's corners use the rest of the 60 m
    expect(g.run * g.dz + 6 * g.dx).toBeCloseTo(60, 6);
    expect(g.end.x - g.start.x).toBeGreaterThan(80);
    const [lo, hi] = topEnds(r);
    expect(lo).toMatchObject({ x: expect.closeTo(52, 6), y: expect.closeTo(10, 6), z: expect.closeTo(560 + g.corner, 6) });
    expect(hi).toMatchObject({ x: expect.closeTo(g.end.x, 6), y: expect.closeTo(24, 6), z: expect.closeTo(620 - g.corner, 6) });
    const [m0, m1] = topEnds(mouth);
    expect(m0).toMatchObject({ x: expect.closeTo(g.end.x, 6), y: expect.closeTo(24, 6), z: expect.closeTo(g.end.z, 6) });
    expect(m1).toMatchObject({ x: expect.closeTo(g.mouthEnd.x, 6), y: expect.closeTo(24, 6), z: expect.closeTo(620 + g.corner, 6) });
    // Every line along the deck, centre or edge: at z0 it is still on the band-gap floor (the ramp starts north of the
    // lower street, flush at y0); at z1 it is on the flat mouth piece at y1 (no lip under the upper edge, no hole).
    for (let t = -3; t <= 3; t += 0.5) {
      const sAt = (z: number) => (z - g.start.z - t * g.dx) / g.dz;
      expect(sAt(560)).toBeLessThanOrEqual(1e-9);
      expect(sAt(620)).toBeGreaterThanOrEqual(g.run - 1e-9);
      expect(sAt(620)).toBeLessThanOrEqual(g.run + g.flat + 1e-9);
    }
  });

  it('a 14 m staircase: 56 steps 0.35 deep, each top 0.25 above the last, and 4 landings 2 m deep', () => {
    const steps = of('stairs-b-step-').sort((a, b) => a.center.z - b.center.z);
    expect(steps).toHaveLength(56);
    for (const [i, s] of steps.entries()) {
      expect(s.kind).toBe('stairs');
      expect(s.size.x).toBe(4);
      expect(s.size.z).toBeCloseTo(0.35, 9);
      expect(s.center.x).toBe(170);
      expect(top(s)).toBeCloseTo(B.y0 + 0.25 * (i + 1), 9);
      expect(s.center.y - s.size.y / 2).toBeCloseTo(B.y0, 9);
      if (i > 0) expect(s.center.z).toBeGreaterThan(steps[i - 1]!.center.z);
    }
    expect(steps[0]!.center.z - 0.175).toBeCloseTo(560, 9);
    expect(top(steps[55]!)).toBeCloseTo(B.y1, 9);
    const landings = of('stairs-b-landing-');
    expect(landings).toHaveLength(4);
    for (const [i, l] of landings.entries()) {
      expect(l.kind).toBe('stairs');
      expect(l.size.z).toBe(2);
      expect(top(l)).toBeCloseTo(B.y0 + 0.25 * 12 * (i + 1), 9);
    }
    // straight north: 56 treads and 4 landings, then terrace fill at y1 to the upper edge
    const last = steps[55]!;
    expect(last.center.z + 0.175).toBeCloseTo(560 + 56 * 0.35 + 4 * 2, 9);
    const fill = solids.find((s) => s.id === 'stairs-b-top')!;
    expect(top(fill)).toBe(B.y1);
    expect(fill.center.z + fill.size.z / 2).toBe(620);
  });

  it('band terrain blocks rise from y0 to y1 over the band depth and leave every connector x-extent free', () => {
    const blocks = of('band-B-terrain-');
    expect(blocks.length).toBe(4);
    const cs = [SW, LANE, STAIRS];
    const extents = cs.map((c) => connectorExtent(c, cityConfig));
    let width = 0;
    for (const b of blocks) {
      expect(b.kind).toBe('terrain');
      expect(top(b)).toBe(B.y1);
      expect(b.center.y - b.size.y / 2).toBe(B.y0);
      expect(b.center.z - b.size.z / 2).toBe(560);
      expect(b.center.z + b.size.z / 2).toBe(620);
      for (const [a, e] of extents) expect(maxX(b) <= a + 1e-9 || minX(b) >= e - 1e-9).toBe(true);
      width += b.size.x;
    }
    const cut = extents.reduce((sum, [a, e]) => sum + (e - a), 0);
    expect(width + cut).toBeCloseTo(1200, 6);
    expect(connectorExtent(STAIRS, cityConfig)).toEqual([168, 172]);
    // Other bands have no connectors in this layout: one block each.
    expect(of('band-A-terrain-')).toHaveLength(1);
  });

  it('parapets 1 m tall on the upper terrace edge stop 1 m short of each connector mouth', () => {
    const ps = of('band-B-parapet-').sort((a, b) => a.center.x - b.center.x);
    expect(ps.length).toBe(4);
    for (const p of ps) {
      expect(p.kind).toBe('parapet');
      expect(p.size.y).toBe(1);
      expect(p.size.z).toBeCloseTo(0.3, 9);
      expect(p.center.y - 0.5).toBe(B.y1);
      expect(p.center.z - p.size.z / 2).toBeCloseTo(620, 9);
    }
    expect(minX(ps[0]!)).toBe(0);
    expect(maxX(ps[ps.length - 1]!)).toBe(1200);
    const mouths = [LANE, STAIRS, SW].map((c) => connectorMouth(c, cityConfig));
    expect(mouths[2]).toEqual([222, 234]);
    expect(mouths[1]).toEqual([168, 172]);
    for (const [i, [a, b]] of mouths.entries()) {
      expect(maxX(ps[i]!)).toBeCloseTo(a - 1, 9);
      expect(minX(ps[i + 1]!)).toBeCloseTo(b + 1, 9);
    }
    // The lane's mouth is where its 6 m deck crosses z1: from the ramp's top edge (west) to the mouth piece's corner.
    const g = steepLaneGeometry(LANE, cityConfig.steepLane);
    expect(mouths[0]![0]).toBeCloseTo(g.end.x - 3 * g.dz, 9);
    expect(mouths[0]![1]).toBeCloseTo(g.mouthEnd.x + 3 * g.dz, 9);
  });

  it('the band gaps under a switchback and a steep lane have a floor at y0 and a wall under the upper edge', () => {
    for (const c of [SW, LANE]) {
      const [a, e] = connectorExtent(c, cityConfig);
      const floor = solids.find((s) => s.id === `${c.id}-floor`)!;
      expect(top(floor)).toBe(B.y0);
      expect(minX(floor)).toBeCloseTo(a, 9);
      expect(maxX(floor)).toBeCloseTo(e, 9);
      const wall = solids.find((s) => s.id === `${c.id}-wall`)!;
      expect(top(wall)).toBe(B.y1);
      expect(wall.center.z - wall.size.z / 2).toBe(620);
    }
    expect(solids.some((s) => s.id === 'stairs-b-floor')).toBe(false);
  });
});
