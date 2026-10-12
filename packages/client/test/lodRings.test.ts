import { describe, expect, it } from 'vitest';
import { vec3, type Prop } from '@dm/shared';
import { assignLods } from '../src/render/city/lodRings';

const prop = (id: string, x: number, y = 0, z = 0): Prop => ({
  id,
  piece: 'b-1story',
  position: vec3(x, y, z),
  rotY: 0,
  scale: 1,
  palette: null,
});
const RADII: [number, number, number] = [160, 400, 700];

describe('assignLods', () => {
  it('a prop at 159 m is lod0, 161 m lod1, 401 m lod2, 701 m none', () => {
    const props = [prop('a', 159), prop('b', 0, 0, -161), prop('c', 401), prop('d', 0, 0, 701)];
    const r = assignLods(props, vec3(0, 0, 0), RADII);
    expect(r).toEqual({ lod0: [0], lod1: [1], lod2: [2] });
  });

  it('distance is horizontal (a prop 300 m above is still lod0 at 0 m horizontal)', () => {
    const r = assignLods([prop('up', 10, 300, 10)], vec3(10, 0, 10), RADII);
    expect(r.lod0).toEqual([0]);
    // and the centre's own height does not count either
    expect(assignLods([prop('p', 100)], vec3(0, 500, 0), RADII).lod0).toEqual([0]);
  });

  it('ring edges are inclusive and indices keep prop order', () => {
    const props = [prop('a', 160), prop('b', 5), prop('c', 400), prop('d', 700)];
    expect(assignLods(props, vec3(0, 0, 0), RADII)).toEqual({ lod0: [0, 1], lod1: [2], lod2: [3] });
  });
});
