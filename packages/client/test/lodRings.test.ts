import { describe, expect, it } from 'vitest';
import { vec3, type Prop } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { assignLods } from '../src/render/city/lodRings';

const prop = (id: string, x: number, y = 0, z = 0): Prop => ({
  id,
  piece: 'b-1story',
  position: vec3(x, y, z),
  rotY: 0,
  scale: 1,
  palette: null,
});
const RADII = clientConfig.city.lodRadii as [number, number, number];
const [R0, R1, R2] = RADII;

describe('assignLods', () => {
  it('a prop at 159 m is lod0, 161 m lod1, 371 m lod2, 701 m none (config rings 160 / 370 / 700)', () => {
    expect(RADII).toEqual([160, 370, 700]);
    const props = [prop('a', R0 - 1), prop('b', 0, 0, -(R0 + 1)), prop('c', R1 + 1), prop('d', 0, 0, R2 + 1)];
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
    const props = [prop('a', R0), prop('b', 5), prop('c', R1), prop('d', R2)];
    expect(assignLods(props, vec3(0, 0, 0), RADII)).toEqual({ lod0: [0, 1], lod1: [2], lod2: [3] });
  });
});
