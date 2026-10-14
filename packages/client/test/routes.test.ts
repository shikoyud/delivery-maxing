import { describe, expect, it } from 'vitest';
import type { RouteToDoor, Vec3, VehicleTier } from '@dm/shared';
import { RouteCache, nextCorner, yawTo } from '../src/game/routes';

const v = (x: number, z: number): Vec3 => ({ x, y: 0, z });

/** A router that counts its queries and answers a straight route from `from` to the door. */
function countingRouter() {
  const calls: { tier: VehicleTier; from: Vec3; door: Vec3 }[] = [];
  return {
    calls,
    routeToDoor(tier: VehicleTier, from: Vec3, door: Vec3): RouteToDoor | null {
      calls.push({ tier, from: { ...from }, door: { ...door } });
      return { drive: [{ ...from }, { ...door }], footLeg: null, length: Math.hypot(door.x - from.x, door.z - from.z) };
    },
  };
}

describe('RouteCache', () => {
  it('RouteCache recomputes after refreshSeconds or a 5 m move, not every frame', () => {
    const r = countingRouter();
    const cache = new RouteCache(r, 0.5);
    const door = v(100, 0);
    cache.get('car', v(0, 0), 'poi-a', door, 0);
    // Every frame for 0.4 s, creeping forward under 5 m: still the first route.
    for (let t = 1 / 60; t < 0.45; t += 1 / 60) cache.get('car', v(t * 5, 0), 'poi-a', door, t);
    expect(r.calls).toHaveLength(1);
    // Past refreshSeconds: recomputed once.
    cache.get('car', v(2, 0), 'poi-a', door, 0.5);
    expect(r.calls).toHaveLength(2);
    cache.get('car', v(2, 0), 'poi-a', door, 0.6);
    expect(r.calls).toHaveLength(2);
    // 5 m off the last route start (it started at x = 2): recomputed before the refresh time.
    cache.get('car', v(7.01, 0), 'poi-a', door, 0.7);
    expect(r.calls).toHaveLength(3);
  });

  it('recomputes at once when the target or the tier changes, and keeps one route per target', () => {
    const r = countingRouter();
    const cache = new RouteCache(r, 0.5);
    cache.get('car', v(0, 0), 'poi-a', v(100, 0), 0);
    cache.get('car', v(0, 0), 'poi-b', v(0, 100), 0.1);
    expect(r.calls).toHaveLength(2);
    expect(cache.get('car', v(0, 0), 'poi-a', v(100, 0), 0.2)!.drive.at(-1)).toEqual(v(100, 0));
    expect(r.calls).toHaveLength(2);
    cache.get('walk', v(0, 0), 'poi-a', v(100, 0), 0.25);
    expect(r.calls.at(-1)!.tier).toBe('walk');
    expect(r.calls).toHaveLength(3);
  });

  it('caches a null (unreachable) route until the next refresh', () => {
    let calls = 0;
    const cache = new RouteCache({ routeToDoor: () => (calls++, null) }, 0.5);
    expect(cache.get('car', v(0, 0), 'poi-a', v(10, 0), 0)).toBeNull();
    expect(cache.get('car', v(0, 0), 'poi-a', v(10, 0), 0.1)).toBeNull();
    expect(calls).toBe(1);
    cache.get('car', v(0, 0), 'poi-a', v(10, 0), 0.5);
    expect(calls).toBe(2);
  });
});

describe('nextCorner and yawTo', () => {
  it('the next corner is the end of the route segment the player is closest to (the foot leg included)', () => {
    const route: RouteToDoor = { drive: [v(0, 0), v(10, 0), v(10, -20)], footLeg: [v(10, -20), v(14, -20)], length: 34 };
    expect(nextCorner(route, v(0, 0))).toEqual(v(10, 0));
    expect(nextCorner(route, v(6, 0.5))).toEqual(v(10, 0));
    expect(nextCorner(route, v(10.2, -3))).toEqual(v(10, -20));
    expect(nextCorner(route, v(10, -20))).toEqual(v(14, -20));
  });

  it('yawTo is the world yaw facing a point (0 faces -Z, positive turns left)', () => {
    expect(yawTo(v(0, 0), v(0, -5))).toBeCloseTo(0);
    expect(yawTo(v(0, 0), v(-5, 0))).toBeCloseTo(Math.PI / 2);
    expect(yawTo(v(0, 0), v(5, 0))).toBeCloseTo(-Math.PI / 2);
  });
});
