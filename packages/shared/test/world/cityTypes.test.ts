import { describe, expect, it } from 'vitest';
import { vec3 } from '../../src/math/vec3';
import { parseCityMap, type CityMap } from '../../src/world/cityTypes';
import type { PieceCatalog } from '../../src/world/pieces';
import { emptyMap } from './fixtures';

const pieces: PieceCatalog = {
  'b-4story': {
    id: 'b-4story', kind: 'building', lod0: 'a.glb', lod1: null, size: vec3(8, 12, 8), tris: [100, 0], roofY: 11,
    colliders: [], avgColor: [0.5, 0.5, 0.5],
  },
};

const city = (): CityMap => ({
  ...emptyMap(),
  size: 400,
  solids: [
    { id: 'ground', kind: 'ground', center: vec3(0, -0.5, 0), size: vec3(100, 1, 100) },
    { id: 'road-1', kind: 'road', center: vec3(0, 0, 0), size: vec3(12, 0.2, 60) },
  ],
  kind: 'city',
  seed: 1,
  chunkSize: 100,
  districts: [{ district: 'downtown', rect: { minX: -200, minZ: -200, maxX: 200, maxZ: 200 } }],
  props: [{ id: 'p1', piece: 'b-4story', position: vec3(20, 0, 20), rotY: 90, scale: 1, palette: null }],
  streets: {
    nodes: [
      { id: 'n1', p: vec3(0, 0, 0), plaza: true },
      { id: 'n2', p: vec3(50, 0, 0), plaza: false },
    ],
    edges: [{ a: 'n1', b: 'n2', halfWidth: 6, long: false }],
  },
  navLinks: [{ id: 'nl1', kind: 'pad', from: vec3(0, 0, 0), to: vec3(10, 5, 0), bidirectional: false }],
  thiefSpawns: [{ id: 't1', node: 'n2', district: 'downtown' }],
});

const parse = (c: unknown) => parseCityMap(c, pieces);
const clone = (c: CityMap): CityMap => JSON.parse(JSON.stringify(c)) as CityMap;

describe('parseCityMap', () => {
  it('accepts one minimal valid city and returns an equal map without mutating the input', () => {
    const c = city();
    const before = JSON.stringify(c);
    expect(parse(JSON.parse(before))).toEqual(c);
    expect(JSON.stringify(c)).toBe(before);
  });

  it('accepts hidden solids, elevated POIs and new solid kinds', () => {
    const c = clone(city());
    c.solids.push({ id: 'cr', kind: 'crane', center: vec3(10, 5, 10), size: vec3(2, 10, 2), hidden: true });
    c.pois.push({ id: 'poi1', position: vec3(5, 3, 5), district: 'downtown', kind: 'balcony', elevated: true });
    expect(() => parse(c)).not.toThrow();
  });

  it('rejects a non-object and a wrong kind', () => {
    expect(() => parse(null)).toThrow();
    expect(() => parse({ ...city(), kind: 'greybox' })).toThrow(/kind/);
  });

  it('rejects a duplicated id and names it', () => {
    const c = clone(city());
    c.solids.push({ id: 'road-1', kind: 'road', center: vec3(0, 0, 0), size: vec3(1, 1, 1) });
    expect(() => parse(c)).toThrow(/road-1/);
    const d = clone(city());
    d.props.push({ ...d.props[0]! }); // same prop id twice
    expect(() => parse(d)).toThrow(/p1/);
    const e = clone(city());
    e.streets.nodes.push({ id: 'n1', p: vec3(1, 0, 1), plaza: false });
    expect(() => parse(e)).toThrow(/n1/);
  });

  it('rejects a solid whose x or z extent exceeds chunkSize', () => {
    const c = clone(city());
    c.solids.push({ id: 'wide', kind: 'building', center: vec3(0, 5, 0), size: vec3(101, 10, 10) });
    expect(() => parse(c)).toThrow(/wide/);
    const d = clone(city());
    d.solids.push({ id: 'deep', kind: 'building', center: vec3(0, 5, 0), size: vec3(10, 10, 100.5) });
    expect(() => parse(d)).toThrow(/deep/);
    const rot = clone(city());
    rot.solids.push({ id: 'long-rot', kind: 'cliff', center: vec3(0, 5, 0), size: vec3(90, 10, 90), rotationDeg: vec3(0, 45, 0) });
    expect(() => parse(rot)).toThrow(/long-rot/);
  });

  it('rejects a prop naming an unknown piece, an invalid rotY, or a non-positive scale', () => {
    const base = clone(city());
    const bad = (over: Record<string, unknown>) => {
      const c = clone(base);
      c.props[0] = { ...c.props[0]!, ...over } as never;
      return c;
    };
    expect(() => parse(bad({ piece: 'b-nope' }))).toThrow(/p1/);
    expect(() => parse(bad({ rotY: 45 }))).toThrow(/p1/);
    expect(() => parse(bad({ scale: 0 }))).toThrow(/p1/);
    expect(() => parse(bad({ scale: -1 }))).toThrow(/p1/);
  });

  it('rejects a street edge naming an unknown node', () => {
    const c = clone(city());
    c.streets.edges.push({ a: 'n1', b: 'ghost', halfWidth: 6, long: false });
    expect(() => parse(c)).toThrow(/ghost/);
  });

  it('rejects a thief spawn on an unknown node', () => {
    const c = clone(city());
    c.thiefSpawns[0]!.node = 'ghost';
    expect(() => parse(c)).toThrow(/t1/);
  });

  it('rejects anything outside ±size/2 plus the 20 m margin, and accepts the margin edge', () => {
    // size 400 -> limit 220
    const at = (x: number, mutate: (c: CityMap, p: { x: number; y: number; z: number }) => void) => {
      const c = clone(city());
      mutate(c, vec3(x, 0, 0));
      return c;
    };
    expect(() => parse(at(220, (c, p) => { c.props[0]!.position = p; }))).not.toThrow();
    expect(() => parse(at(221, (c, p) => { c.props[0]!.position = p; }))).toThrow(/p1/);
    expect(() => parse(at(-221, (c, p) => { c.streets.nodes[1]!.p = p; }))).toThrow(/n2/);
    expect(() => parse(at(221, (c, p) => { c.pois.push({ id: 'far-poi', position: p, district: 'hub', kind: 'door' }); }))).toThrow(/far-poi/);
    expect(() => parse(at(216, (c, p) => { c.solids.push({ id: 'far-solid', kind: 'prop', center: p, size: vec3(10, 1, 10) }); }))).toThrow(/far-solid/);
    expect(() => parse(at(300, (c, p) => { c.zipLines.push({ id: 'far-zip', a: vec3(0, 5, 0), b: p }); }))).toThrow(/far-zip/);
    expect(() => parse(at(300, (c, p) => { c.navLinks[0]!.to = p; }))).toThrow(/nl1/);
  });
});
