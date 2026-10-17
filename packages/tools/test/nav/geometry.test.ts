import { expect, test } from 'vitest';
import { vec3, type Solid } from '@dm/shared';
import { solidsToTriangles } from '../../src/nav/geometry';

/** Normal y of every triangle lying in the plane y = `y` (sign only). */
function topNormals(solid: Solid, y: number): number[] {
  const { positions: p, indices } = solidsToTriangles([solid], [], 10);
  const out: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const v = [0, 1, 2].map((k) => [p[indices[i + k]! * 3]!, p[indices[i + k]! * 3 + 1]!, p[indices[i + k]! * 3 + 2]!]);
    if (!v.every((q) => Math.abs(q[1]! - y) < 1e-6)) continue;
    const [a, b, c] = v as [number[], number[], number[]];
    out.push(Math.sign((b[2]! - a[2]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[2]! - a[2]!)));
  }
  return out;
}

test('a parapet top is unwalkable (wound down) like a roof; a terrain top stays walkable', () => {
  const box = (kind: Solid['kind']): Solid => ({ id: kind, kind, center: vec3(0, 24.5, 0), size: vec3(10, 1, 0.3) });
  expect(topNormals(box('parapet'), 25)).toEqual([-1, -1]);
  expect(topNormals(box('building'), 25)).toEqual([-1, -1]);
  expect(topNormals(box('terrain'), 25)).toEqual([1, 1]);
});
