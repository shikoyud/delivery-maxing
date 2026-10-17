import { expect, test } from 'vitest';
import { DistanceTable } from '../../src/orders/distanceTable';

test('a table built from rows gives each value back by id; unknown ids give undefined', () => {
  const t = new DistanceTable(['p1', 'p2'], ['d1', 'd2', 'd3'], new Float32Array([1, 2, 3, 4, Infinity, 6]));
  expect(t.get('p1', 'd3')).toBe(3);
  expect(t.get('p2', 'd1')).toBe(4);
  expect(t.get('p2', 'd2')).toBe(Infinity);
  expect(t.get('p3', 'd1')).toBeUndefined();
  expect(t.get('p1', 'dx')).toBeUndefined();
  expect(t.pickups).toEqual(['p1', 'p2']);
  expect(t.dropoffs).toEqual(['d1', 'd2', 'd3']);
});

test('a values array of the wrong length is refused', () => {
  expect(() => new DistanceTable(['p1'], ['d1', 'd2'], new Float32Array(3))).toThrow(/2 values/);
});

test('parse rejects bytes that are not a distance table', () => {
  expect(() => DistanceTable.parse(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]))).toThrow(/distance table/);
  expect(() => DistanceTable.parse(new Uint8Array(3))).toThrow(/distance table/);
});
