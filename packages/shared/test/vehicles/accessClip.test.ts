import { describe, expect, test } from 'vitest';
import { vec3 } from '../../src/math/vec3';
import { forbiddenZoneAt } from '../../src/world/access';
import type { MapData } from '../../src/world/mapTypes';
import { clipToAccess } from '../../src/vehicles/accessClip';
import { emptyMap } from '../world/fixtures';

/** An alley from x 0..4, z -20..0 (y 0); its +Z edge is at z = 0. */
const map = (): MapData => ({
  ...emptyMap(),
  accessZones: [{ id: 'alley-a', kind: 'alley', rect: { minX: 0, minZ: -20, maxX: 4, maxZ: 0 }, minY: 0, maxY: 0 }],
});

describe('clipToAccess', () => {
  test('a car driving into an alley stops 0.05 m before the zone edge, normal pointing out', () => {
    const m = map();
    const from = vec3(2, 0, 0.3);
    const r = clipToAccess(m, 'car', from, vec3(0, -0.01, -0.5));
    expect(r.zone?.id).toBe('alley-a');
    expect(r.normal).toEqual(vec3(0, 0, 1));
    expect(from.z + r.move.z).toBeCloseTo(0.05, 12);
    expect(r.move.x).toBe(0);
    expect(r.move.y).toBe(-0.01);
    expect(forbiddenZoneAt(m, 'car', vec3(from.x + r.move.x, from.y + r.move.y, from.z + r.move.z))).toBeNull();
    // A move that would end inside the 0.05 m gap (not yet in the zone) also stops at the gap, so the car rests
    // there instead of creeping up to the edge.
    const near = clipToAccess(m, 'car', vec3(2, 0, 0.3), vec3(0, 0, -0.28));
    expect(near.zone?.id).toBe('alley-a');
    expect(0.3 + near.move.z).toBeCloseTo(0.05, 12);
    // Resting at the gap, pushing on moves nothing across the edge.
    expect(clipToAccess(m, 'car', vec3(2, 0, 0.05), vec3(0, 0, -0.1)).move.z).toBe(0);
    // Entering through the -X side gives a -X normal and keeps the sideways part of the move.
    const side = clipToAccess(m, 'car', vec3(-0.2, 0, -5), vec3(0.4, 0, -0.3));
    expect(side.normal).toEqual(vec3(-1, 0, 0));
    expect(-0.2 + side.move.x).toBeCloseTo(-0.05, 12);
    expect(side.move.z).toBe(-0.3);
  });

  test('a motorbike passes the same alley edge unchanged', () => {
    const move = vec3(0, -0.01, -0.5);
    const r = clipToAccess(map(), 'motorbike', vec3(2, 0, 0.3), move);
    expect(r).toEqual({ move, zone: null, normal: null });
  });

  test('a car that starts inside an alley zone (summoned, towed) can drive out', () => {
    const inside = clipToAccess(map(), 'car', vec3(2, 0, -0.2), vec3(0, 0, -0.5));
    expect(inside).toEqual({ move: vec3(0, 0, -0.5), zone: null, normal: null });
    const out = clipToAccess(map(), 'car', vec3(2, 0, -0.2), vec3(0, 0, 0.5));
    expect(out).toEqual({ move: vec3(0, 0, 0.5), zone: null, normal: null });
  });

  test('a move that skims past a zone corner without entering is not clipped', () => {
    // Passes just outside the (4, 0) corner, diagonally.
    const move = vec3(-0.4, 0, -0.4);
    const r = clipToAccess(map(), 'car', vec3(4.45, 0, 0.35), move);
    expect(r).toEqual({ move, zone: null, normal: null });
  });
});
