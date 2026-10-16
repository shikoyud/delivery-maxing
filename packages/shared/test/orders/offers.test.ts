import { describe, expect, it } from 'vitest';
import { ordersConfig } from '../../src/config';
import { vec3 } from '../../src/math/vec3';
import { DistanceTable } from '../../src/orders/distanceTable';
import { generateOffer, type OfferContext } from '../../src/orders/offers';
import { mulberry32 } from '../../src/util/rng';
import { streetDistance } from '../../src/world/distance';
import type { Poi } from '../../src/world/mapTypes';
import { offerPlayer, offerPois, offerRules } from './fixture';

function ctx(over: Partial<OfferContext> = {}): OfferContext {
  let n = 0;
  return {
    pois: offerPois(),
    distance: streetDistance,
    rules: offerRules,
    cfg: ordersConfig,
    rng: mulberry32(1),
    player: offerPlayer,
    capacity: { slots: 3, maxPackageKg: 50 },
    carriedKg: 0,
    freeSlots: 3,
    blockedDoors: [],
    recentlyUsed: new Set(),
    nextId: () => `o${++n}`,
    ...over,
  };
}

const onlyKind = (kind: 'food' | 'package') => ({
  ...ordersConfig,
  mix: { ...ordersConfig.mix, kindWeights: { food: kind === 'food' ? 1 : 0, package: kind === 'package' ? 1 : 0 } },
});

describe('generateOffer', () => {
  it('food offer: pickup within maxPickupDistance, dropoff within the food window, text item from the pickup', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const o = generateOffer(ctx({ cfg: onlyKind('food'), rng: mulberry32(seed) }));
      expect(o).not.toBeNull();
      expect(o!.kind).toBe('food');
      expect(o!.pickupPoiId).toBe('fp-near');
      expect(o!.dropoffPoiId).toBe('df-ok');
      expect(['noodles', 'dumplings']).toContain(o!.item);
      expect(o!.distance).toBe(150);
      expect(o!.band).toBe('medium');
      expect(o!.weightKg).toBeNull();
      expect(o!.weightClass).toBeNull();
      expect(o!.modifier).toBeNull();
      expect(o!.expressLimit).toBeNull();
      expect(o!.timeLimit).toBeCloseTo((1.3 * 150) / 8 + 20);
    }
  });

  it('package offer: dropoff within the package window; a too-close dropoff is never offered', () => {
    // dp-near is 60 m from both senders, under the fixture's 100 m package minimum; dp-1 at 300 m qualifies.
    const pois = (): Poi[] => [
      ...offerPois(),
      { id: 'dp-near', position: vec3(0, 0, 0), district: 'downtown', kind: 'door', name: '4 Near Ct', roles: ['dropoffPackage'] },
    ];
    for (let seed = 1; seed <= 20; seed++) {
      const o = generateOffer(ctx({ pois: pois(), cfg: onlyKind('package'), rng: mulberry32(seed) }));
      expect(o).not.toBeNull();
      const d = o!.distance;
      expect(d).toBeGreaterThanOrEqual(offerRules.packageDropoff.min);
      expect(d).toBeLessThanOrEqual(offerRules.packageDropoff.max);
      expect(o!.dropoffPoiId).not.toBe('dp-near');
    }
  });

  it('package offers are never generated for a walk capacity (maxPackageKg 0)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const o = generateOffer(ctx({ rng: mulberry32(seed), capacity: { slots: 1, maxPackageKg: 0 }, freeSlots: 1 }));
      expect(o?.kind).not.toBe('package');
    }
    expect(generateOffer(ctx({ cfg: onlyKind('package'), capacity: { slots: 1, maxPackageKg: 0 }, freeSlots: 1 }))).toBeNull();
    expect(generateOffer(ctx({ cfg: onlyKind('package'), freeSlots: 0 }))).toBeNull();
  });

  it('package weight is clamped to the remaining kg; a sender whose minimum exceeds it is skipped', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const o = generateOffer(ctx({ cfg: onlyKind('package'), rng: mulberry32(seed), capacity: { slots: 3, maxPackageKg: 50 }, carriedKg: 40 }));
      expect(o).not.toBeNull();
      expect(o!.pickupPoiId).toBe('ps-light'); // heavy sender needs >= 30 kg, only 10 left
      expect(o!.weightKg!).toBeLessThanOrEqual(10);
      expect(o!.weightKg!).toBeGreaterThanOrEqual(5);
      expect(o!.weightClass).not.toBeNull();
    }
    const full = generateOffer(ctx({ cfg: onlyKind('package'), carriedKg: 50 }));
    expect(full).toBeNull();
    const tiny = generateOffer(ctx({ cfg: onlyKind('package'), carriedKg: 47 }));
    expect(tiny).toBeNull(); // 3 kg left, both senders' minimums exceed it
  });

  it('package offers carry a modifier from the weights and an express limit only for express', () => {
    const seen = new Set<string | null>();
    for (let seed = 1; seed <= 80; seed++) {
      const o = generateOffer(ctx({ cfg: onlyKind('package'), rng: mulberry32(seed) }))!;
      seen.add(o.modifier);
      expect(o.expressLimit !== null).toBe(o.modifier === 'express');
    }
    expect(seen).toEqual(new Set([null, 'express', 'fragile']));
  });

  it('doors within 12 m of a blocked door and recently used doors are not offered', () => {
    const near = generateOffer(ctx({ cfg: onlyKind('food'), blockedDoors: [vec3(55, 0, 5)] }));
    expect(near).toBeNull(); // fp-near is within 12 m (7.07), the other pickup is out of range
    const exactly = generateOffer(ctx({ cfg: onlyKind('food'), blockedDoors: [vec3(50, 0, 12)] }));
    expect(exactly).not.toBeNull(); // 12 m is not "within" spacing
    expect(generateOffer(ctx({ cfg: onlyKind('food'), blockedDoors: [vec3(205, 0, 0)] }))).toBeNull(); // dropoff blocked
    expect(generateOffer(ctx({ cfg: onlyKind('food'), recentlyUsed: new Set(['fp-near']) }))).toBeNull();
    expect(generateOffer(ctx({ cfg: onlyKind('food'), recentlyUsed: new Set(['df-ok']) }))).toBeNull();
  });

  it('returns null when every dropoff is blocked', () => {
    const blocked = offerPois().filter((p) => p.roles.some((r) => r.startsWith('dropoff'))).map((p) => p.position);
    expect(generateOffer(ctx({ blockedDoors: blocked }))).toBeNull();
  });

  it('falls back to the other kind when the rolled kind has no qualifying pair', () => {
    // Every package sender's minimum exceeds the 3 kg left, so a package roll must fall back to food.
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const o = generateOffer(ctx({ rng: mulberry32(seed), carriedKg: 47 }));
      expect(o, `seed ${seed}`).not.toBeNull();
      expect(o!.kind).toBe('food');
    }
    // No food pickup in range (fp-near used), so a food roll must fall back to a package.
    for (let seed = 1; seed <= 40; seed++) {
      const o = generateOffer(ctx({ rng: mulberry32(seed), recentlyUsed: new Set(['fp-near']) }));
      expect(o, `seed ${seed}`).not.toBeNull();
      kinds.add(o!.kind);
    }
    expect([...kinds]).toEqual(['package']);
  });

  it('returns null when neither kind has a qualifying pair', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(generateOffer(ctx({ rng: mulberry32(seed), carriedKg: 47, recentlyUsed: new Set(['fp-near']) }))).toBeNull();
    }
  });

  it('never falls back to a kind that is not allowed (weight 0 or no capacity)', () => {
    expect(generateOffer(ctx({ cfg: onlyKind('food'), recentlyUsed: new Set(['fp-near']) }))).toBeNull();
    expect(generateOffer(ctx({ recentlyUsed: new Set(['fp-near']), capacity: { slots: 1, maxPackageKg: 0 }, freeSlots: 1 }))).toBeNull();
  });

  it('same rng seed gives the same offer', () => {
    for (let seed = 1; seed <= 10; seed++) {
      expect(generateOffer(ctx({ rng: mulberry32(seed) }))).toEqual(generateOffer(ctx({ rng: mulberry32(seed) })));
      const fb = { carriedKg: 47 }; // through the fallback path too
      expect(generateOffer(ctx({ rng: mulberry32(seed), ...fb }))).toEqual(generateOffer(ctx({ rng: mulberry32(seed), ...fb })));
    }
  });

  describe('on a big map: a distance table and a capped number of path queries', () => {
    // 30 food pickups on a line east of the player, 10 m apart (10 m to 300 m), and one dropoff 200 m north of each.
    const pickups: Poi[] = Array.from({ length: 30 }, (_, i) => ({
      id: `fp-${i}`, position: vec3(10 + i * 10, 0, 0), district: 'downtown', kind: 'counter', name: `Kitchen ${i}`, roles: ['foodPickup'], items: ['soup'],
    }));
    const dropoffs: Poi[] = pickups.map((p, i) => ({
      id: `df-${i}`, position: vec3(p.position.x, 0, 200), district: 'downtown', kind: 'door', name: `${i} North St`, roles: ['dropoffFood'],
    }));
    const pois = (): Poi[] => [...pickups, ...dropoffs];
    // every pickup to every dropoff 123 m by the table (the router would say 200 m or more)
    const table = new DistanceTable(pickups.map((p) => p.id), dropoffs.map((d) => d.id), new Float32Array(30 * 30).fill(123));
    const counting = () => {
      const calls: string[] = [];
      const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => {
        calls.push(`${a.x},${a.z}->${b.x},${b.z}`);
        return streetDistance(a as never, b as never);
      };
      return { calls, distance };
    };

    it('makes at most offers.maxPathQueries router calls and takes the pickup→dropoff leg from the table', () => {
      expect(ordersConfig.offers.maxPathQueries).toBe(8);
      for (let seed = 1; seed <= 20; seed++) {
        const r = counting();
        const o = generateOffer(ctx({ pois: pois(), cfg: onlyKind('food'), rng: mulberry32(seed), distance: r.distance, table }));
        expect(o, `seed ${seed}`).not.toBeNull();
        expect(r.calls.length).toBeLessThanOrEqual(8);
        expect(o!.distance).toBeCloseTo(123);
        // only the 8 nearest pickups (10 m .. 80 m) are path-queried, so only they are offered
        expect(Number(o!.pickupPoiId.slice(3))).toBeLessThan(8);
      }
    });

    it('prefilters by straight line: a pickup beyond maxPickupDistance in a straight line is never queried', () => {
      const r = counting();
      const far: Poi = { ...pickups[0]!, id: 'fp-far-away', position: vec3(0, 0, -260) };
      generateOffer(ctx({ pois: [far, dropoffs[0]!], cfg: onlyKind('food'), distance: r.distance, table }));
      expect(r.calls).toEqual([]);
    });

    it('falls back to the router for a pair the table does not hold', () => {
      const r = counting();
      const small = new DistanceTable(['fp-0'], ['df-1'], new Float32Array([123]));
      const o = generateOffer(ctx({ pois: [pickups[0]!, dropoffs[0]!], cfg: onlyKind('food'), distance: r.distance, table: small }));
      expect(o!.distance).toBe(200); // fp-0 → df-0 is not in the table: the router's street distance
      expect(r.calls).toHaveLength(2); // player → pickup, pickup → dropoff
    });

    it('an unreachable pair (Infinity in the table) is never offered', () => {
      const none = new DistanceTable(pickups.map((p) => p.id), dropoffs.map((d) => d.id), new Float32Array(30 * 30).fill(Infinity));
      expect(generateOffer(ctx({ pois: pois(), cfg: onlyKind('food'), table: none }))).toBeNull();
    });
  });
});
