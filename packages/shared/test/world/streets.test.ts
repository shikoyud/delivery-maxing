import { describe, expect, it } from 'vitest';
import { closestOnSegment, vec3, type Vec3 } from '../../src/math/vec3';
import { mulberry32 } from '../../src/util/rng';
import { StreetGraph } from '../../src/world/streets';
import { levelsCity, slopesCity, thiefCity } from './fixtures';

const MARGIN = 6;
const city = thiefCity();
const graph = (): StreetGraph => new StreetGraph(city.streets, city.hub, MARGIN);
const nodeP = new Map(city.streets.nodes.map((n) => [n.id, n.p]));
const flat = (v: Vec3): Vec3 => vec3(v.x, 0, v.z);
const expectAt = (p: Vec3 | undefined, x: number, y: number, z: number): void => {
  expect(p).toBeDefined();
  expect([p!.x, p!.y, p!.z].map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([x, y, z]);
};

/** Whether p lies on edge `i`'s strip (horizontally within halfWidth of its centre line). */
function onStrip(p: Vec3, i: number): boolean {
  const e = city.streets.edges[i]!;
  return closestOnSegment(flat(p), flat(nodeP.get(e.a)!), flat(nodeP.get(e.b)!)).dist <= e.halfWidth + 1e-6;
}

describe('StreetGraph', () => {
  it('project keeps a point inside the strip and lifts y along a ramp edge', () => {
    const g = graph();
    // The ramp n6 (420, 0, 0) → r2 (420, 5, 60), half-width 6: 5 m off its centre line, halfway up
    const inside = g.project(vec3(425, 10, 30));
    expect(inside.p.x).toBeCloseTo(425, 9);
    expect(inside.p.z).toBeCloseTo(30, 9);
    expect(inside.p.y).toBeCloseTo(2.5, 9);
    expect(onStrip(inside.p, inside.edge)).toBe(true);
    // 20 m off its centre line: pulled in to the strip's side, still lifted
    const outside = g.project(vec3(440, 0, 30));
    expect(outside.p.x).toBeCloseTo(426, 9);
    expect(outside.p.z).toBeCloseTo(30, 9);
    expect(outside.p.y).toBeCloseTo(2.5, 9);
    // A quarter up the ramp
    expect(g.project(vec3(420, 0, 15)).p.y).toBeCloseTo(1.25, 9);
  });

  it('project never returns a point inside the plaza exclusion', () => {
    const g = graph();
    const exclusion = city.hub.plazaRadius + MARGIN;
    const bad: string[] = [];
    for (let x = -60; x <= 80; x += 2.5) {
      for (let z = -60; z <= 60; z += 2.5) {
        const { p, edge } = g.project(vec3(x, 0, z));
        if (Math.hypot(p.x, p.z) < exclusion - 1e-6) bad.push(`(${x}, ${z}) → inside at (${p.x}, ${p.z})`);
        if (!onStrip(p, edge)) bad.push(`(${x}, ${z}) → off its strip at (${p.x}, ${p.z})`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    // Inside the plaza on the arterial: pushed straight out along it
    const pushed = g.project(vec3(31, 0, 0)).p;
    expect(pushed.x).toBeCloseTo(exclusion, 6);
    expect(pushed.z).toBeCloseTo(0, 6);
  });

  it('route finds the shortest node path', () => {
    const g = graph();
    // n3 → n6: along the main street (180 m), not round the loop (80 + 120 + 100 m)
    expect(g.route('n3', 'n6')).toEqual(['n3', 'n4', 'n5', 'n6']);
    // c1 → n6: the loop (120 + 100 m) beats back through n3 (80 + 180 m)
    expect(g.route('c1', 'n6')).toEqual(['c1', 'd1', 'n6']);
    expect(g.route('n2', 'n2')).toEqual(['n2']);
    // Never through the plaza, never to a plaza node
    expect(g.route('n0', 'hub')).toEqual([]);
  });

  it('nextNode never picks a plaza node and turns back only at a dead end', () => {
    const g = graph();
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      expect(g.nextNode('n0', null, rng)).toBe('n1');
      expect(g.nextNode('n0', 'n1', rng)).toBe('n1');
      expect(g.nextNode('c2', 'n3', rng)).toBe('n3');
      expect(['n2', 'c1', 'c2']).toContain(g.nextNode('n3', 'n4', rng));
    }
  });

  it('nearestNode skips plaza nodes', () => {
    const g = graph();
    expect(g.nearestNode(vec3(25, 0, 0))).toBe('n0');
    expect(g.nearestNode(vec3(250, 0, -70))).toBe('c1');
  });

  it('maxSlope is the steepest edge (rise over horizontal run)', () => {
    expect(graph().maxSlope).toBeCloseTo(5 / 60, 9);
  });

  it('projectOnLevel stays on the given level: never up onto a street beside or over, never down off a ledge', () => {
    const lv = levelsCity();
    const g = new StreetGraph(lv.streets, lv.hub, MARGIN);
    // Just past the lower street's side, inside the upper street's strip: plain project jumps up, projectOnLevel does not
    expect(g.project(vec3(150, 0, 7.2)).p.y).toBe(6);
    expectAt(g.projectOnLevel(vec3(150, 0, 7.2), 0, 0.1)?.p, 150, 0, 6);
    // Just past the upper street's side, over the lower street: stays up
    expectAt(g.projectOnLevel(vec3(150, 6, 5.8), 6, 0.1)?.p, 150, 6, 6.1);
    // Under the bridge on the lower street, and on the bridge over it
    expectAt(g.projectOnLevel(vec3(200, 0, 1), 0, 0.1)?.p, 200, 0, 1);
    expectAt(g.projectOnLevel(vec3(200, 6, 1), 6, 0.1)?.p, 200, 6, 1);
    // No street on that level at all
    expect(g.projectOnLevel(vec3(150, 3, 0), 3, 0.1)).toBeNull();
  });

  it("past a node on a slope, a point takes the next edge's height, not the end cap of the edge before", () => {
    const sl = slopesCity();
    const g = new StreetGraph(sl.streets, sl.hub, MARGIN);
    // 3 m past M on the straight 1-in-5 slope (S0 → M → S1), uphill and downhill
    expectAt(g.project(vec3(203, 20, 0)).p, 203, 20.6, 0);
    expectAt(g.projectOnLevel(vec3(203, 20, 0), 20, 0.7)?.p, 203, 20.6, 0);
    expectAt(g.projectOnLevel(vec3(197, 20, 0), 20, 0.7)?.p, 197, 19.4, 0);
    // 2 m onto the 0.3 ramp past the flat street's end (F1), and 2 m onto the flat street past its top (F2)
    expectAt(g.projectOnLevel(vec3(152, 0, 61), 0, 0.7)?.p, 152, 0.6, 61);
    expectAt(g.projectOnLevel(vec3(202, 15, 61), 15, 0.7)?.p, 202, 15, 61);
    expectAt(g.projectOnLevel(vec3(198, 15, 61), 15, 0.7)?.p, 198, 14.4, 61);
  });

  it('routeToward walks from one edge to another through the ends that make the shortest walk', () => {
    const g = graph();
    const edgeOf = (a: string, b: string): number => city.streets.edges.findIndex((e) => e.a === a && e.b === b);
    // On n4–n5 near n5, toward the ramp n6–r2: via n5 and n6
    expect(g.routeToward(vec3(350, 0, 0), edgeOf('n4', 'n5'), vec3(420, 1, 12), edgeOf('n6', 'r2'))).toEqual(['n5', 'n6']);
    // From the corner of n5–n6 at n6 onto the ramp: just n6
    expect(g.routeToward(vec3(418, 0, 6), edgeOf('n5', 'n6'), vec3(420, 1, 12), edgeOf('n6', 'r2'))).toEqual(['n6']);
  });
});
