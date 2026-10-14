import { describe, expect, test } from 'vitest';
import { ordersConfig } from '../../src/config';
import type { OrdersConfig } from '../../src/config/types';
import { vec3 } from '../../src/math/vec3';
import { OrderSystem, type OrderEvent, type OrderSystemOptions } from '../../src/orders/OrderSystem';
import type { CarrierCapacity } from '../../src/orders/types';
import type { Rng } from '../../src/util/rng';
import { streetDistance } from '../../src/world/distance';
import type { Poi } from '../../src/world/mapTypes';
import type { PlayerZones } from '../../src/world/zones';
import { offerPlayer, offerPois, offerRules } from './fixture';

/** rng() === 0: offer intervals are always minIntervalSeconds (8 s), food is picked first. */
const zeroRng: Rng = () => 0;

const cfgWith = (kind: 'food' | 'package', modifier: 'none' | 'express' | 'fragile' = 'none'): OrdersConfig => ({
  ...ordersConfig,
  // These tests pin the original pacing; the prep and cooldown tests below opt in to the live values.
  offers: { maxShown: 3, lifetimeSeconds: 20, minIntervalSeconds: 8, maxIntervalSeconds: 15 },
  deliveryCooldown: { minSeconds: 0, maxSeconds: 0 },
  prep: { foodSeconds: 0 },
  mix: {
    kindWeights: { food: kind === 'food' ? 1 : 0, package: kind === 'package' ? 1 : 0 },
    modifierWeights: { none: modifier === 'none' ? 1 : 0, express: modifier === 'express' ? 1 : 0, fragile: modifier === 'fragile' ? 1 : 0 },
  },
});

/** A second food pickup/dropoff pair so a cancel or reuse does not starve the generator. */
const twoFoodPois = (): Poi[] => [
  ...offerPois(),
  { id: 'fp-2', position: vec3(-50, 0, 0), district: 'downtown', kind: 'counter', name: 'Second Snacks', roles: ['foodPickup'], items: ['wrap'] },
  { id: 'df-2', position: vec3(-200, 0, 0), district: 'downtown', kind: 'door', name: '9 West St', roles: ['dropoffFood'] },
];

/** Package senders with fixed weights and two package dropoffs. */
const packagePois = (weights: number[]): Poi[] => [
  ...weights.map(
    (kg, i): Poi => ({
      id: `ps-${kg}`,
      position: vec3(i * 40, 0, 60),
      district: 'downtown',
      kind: 'counter',
      name: `Sender ${kg}`,
      roles: ['packagePickup'],
      items: ['box'],
      weightKg: [kg, kg],
    }),
  ),
  ...weights.map(
    (_, i): Poi => ({ id: `dp-${i}`, position: vec3(300, 0, i * 100), district: 'downtown', kind: 'door', name: `${i} Pkg Ave`, roles: ['dropoffPackage'] }),
  ),
];

const MOTORBIKE: CarrierCapacity = { slots: 3, maxPackageKg: 50 };
const CAR: CarrierCapacity = { slots: 5, maxPackageKg: 150 };
const WALK: CarrierCapacity = { slots: 1, maxPackageKg: 0 };

function makeSystem(over: Partial<OrderSystemOptions> = {}, now = 0): OrderSystem {
  return new OrderSystem(
    { pois: offerPois(), distance: streetDistance, rules: offerRules, cfg: cfgWith('food'), rng: zeroRng, capacity: MOTORBIKE, ...over },
    now,
  );
}

const zones = (...ids: string[]): PlayerZones => ({ poiIds: new Set(ids), safeZone: null });
const nowhere = zones();

/** Call update at each time from `from` to `to` (inclusive) in `step` increments; collect events. */
function run(sys: OrderSystem, from: number, to: number, step = 1, z: PlayerZones = nowhere): OrderEvent[] {
  const out: OrderEvent[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(...sys.update(t, offerPlayer, z));
  return out;
}

const kinds = (events: OrderEvent[]): string[] => events.map((e) => e.kind);

describe('OrderSystem', () => {
  test('an offer appears after the first interval and expires after lifetimeSeconds', () => {
    const sys = makeSystem();
    expect(sys.nextOfferAt).toBe(8);
    expect(sys.update(7.9, offerPlayer, nowhere)).toEqual([]);
    const ev = sys.update(8, offerPlayer, nowhere);
    expect(ev).toEqual([{ kind: 'offered', offerId: 'o1' }]);
    expect(sys.offers).toHaveLength(1);
    expect(sys.offers[0]!.offeredAt).toBe(8);
    expect(sys.offers[0]!.expiresAt).toBe(8 + 20);
    expect(sys.update(27.9, offerPlayer, nowhere).filter((e) => e.kind === 'offerExpired')).toEqual([]);
    expect(sys.update(28, offerPlayer, nowhere)).toContainEqual({ kind: 'offerExpired', offerId: 'o1' });
    expect(sys.offers.find((o) => o.order.id === 'o1')).toBeUndefined();
  });

  test('accept after expiresAt returns expired and the offer is gone', () => {
    const sys = makeSystem();
    sys.update(8, offerPlayer, nowhere);
    expect(sys.canAccept('o1', 28)).toBe('expired');
    expect(sys.accept('o1', 28)).toBe('expired');
    expect(sys.offers.find((o) => o.order.id === 'o1')).toBeUndefined();
    expect(sys.offers).toHaveLength(0);
    expect(sys.active).toHaveLength(0);
    expect(sys.accept('o1', 28)).toBe('gone');
    expect(sys.accept('nope', 0)).toBe('gone');
  });

  test('accept returns too_heavy when the package exceeds the remaining kg', () => {
    // motorbike 50 kg: accept a 25 kg package, then a 30 kg package does not fit
    const sys = makeSystem({ pois: packagePois([25, 30]), cfg: cfgWith('package') });
    run(sys, 8, 16, 8);
    expect(sys.offers).toHaveLength(2);
    const light = sys.offers.find((o) => o.order.weightKg === 25)!;
    const heavy = sys.offers.find((o) => o.order.weightKg === 30)!;
    expect(sys.accept(light.order.id, 17)).toBe('ok');
    expect(sys.carriedKg()).toBe(25);
    expect(sys.canAccept(heavy.order.id, 17)).toBe('too_heavy');
    expect(sys.accept(heavy.order.id, 17)).toBe('too_heavy');
    expect(sys.active).toHaveLength(1);
    expect(sys.offers.map((o) => o.order.id)).toContain(heavy.order.id);
  });

  test('offers too heavy for the remaining kg are not generated (reserved kg reach the generator)', () => {
    // motorbike 50 kg: o1 = 30 kg (ps-30), o2 = 25 kg (ps-25). Accept the 25 kg, let the 30 kg expire.
    const sys = makeSystem({ pois: packagePois([25, 30]), cfg: cfgWith('package') });
    run(sys, 8, 16, 8);
    const light = sys.offers.find((o) => o.order.weightKg === 25)!;
    expect(sys.offers.find((o) => o.order.weightKg === 30)).toBeDefined();
    expect(sys.accept(light.order.id, 17)).toBe('ok');
    run(sys, 18, 30);
    expect(sys.offers).toHaveLength(0);
    // ps-25 and dp-1 are in use, so only ps-30 -> dp-0 is left; 30 kg > 25 kg remaining: never offered
    const seen: (number | null)[] = [];
    for (let t = 31; t <= 200; t++) {
      for (const e of sys.update(t, offerPlayer, nowhere)) {
        if (e.kind === 'offered') seen.push(sys.offers.find((o) => o.order.id === e.offerId)!.order.weightKg);
      }
    }
    expect(seen).not.toContain(30);
    expect(seen).toEqual([]);
  });

  test('accept returns no_slots when slots are full', () => {
    const sys = makeSystem({ pois: twoFoodPois(), capacity: WALK });
    run(sys, 8, 16, 8);
    expect(sys.offers).toHaveLength(2);
    const [a, b] = sys.offers.map((o) => o.order.id) as [string, string];
    expect(sys.accept(a, 17)).toBe('ok');
    expect(sys.freeSlots()).toBe(0);
    expect(sys.canAccept(b, 17)).toBe('no_slots');
    expect(sys.accept(b, 17)).toBe('no_slots');
    expect(sys.active).toHaveLength(1);
    expect(sys.offers.map((o) => o.order.id)).toContain(b);
    // no new offers while there is no free slot
    expect(kinds(run(sys, 18, 60)).filter((k) => k === 'offered')).toEqual([]);
  });

  test('entering the pickup zone marks pickedUp; entering the dropoff before pickup does nothing', () => {
    const sys = makeSystem({ capacity: WALK });
    sys.update(8, offerPlayer, nowhere);
    expect(sys.accept('o1', 9)).toBe('ok');
    const a = sys.active[0]!;
    expect(sys.currentTarget(a)).toBe('fp-near');
    expect(sys.update(10, offerPlayer, zones('df-ok'))).toEqual([]);
    expect(sys.isCarried(sys.active[0]!)).toBe(false);
    expect(sys.update(11, offerPlayer, zones('fp-near'))).toEqual([{ kind: 'pickedUp', orderId: 'o1' }]);
    expect(sys.active[0]!.pickedUpAt).toBe(11);
    expect(sys.isCarried(sys.active[0]!)).toBe(true);
    expect(sys.currentTarget(sys.active[0]!)).toBe('df-ok');
    expect(sys.update(12, offerPlayer, zones('fp-near'))).toEqual([]);
  });

  test('completion within the time limit scores the bonus; late completion scores the base only', () => {
    // food fp-near -> df-ok: 150 m, medium band, hot limit 1.3 * 150 / 8 + 20 = 44.375 s from pickup
    const onTime = makeSystem({ capacity: WALK });
    onTime.update(8, offerPlayer, nowhere);
    onTime.accept('o1', 9);
    onTime.update(10, offerPlayer, zones('fp-near'));
    const done = onTime.update(10 + 44.375, offerPlayer, zones('df-ok'));
    expect(done).toEqual([{ kind: 'completed', orderId: 'o1', points: 3, coins: 30, bonuses: ['hot'], inTime: true, expressOnTime: null }]);
    expect(onTime.active).toHaveLength(0);
    expect(onTime.totals).toEqual({ points: 3, coins: 30, deliveries: 1 });

    const late = makeSystem({ capacity: WALK, totals: { points: 5, coins: 50, deliveries: 2 } });
    late.update(8, offerPlayer, nowhere);
    late.accept('o1', 9);
    late.update(10, offerPlayer, zones('fp-near'));
    const lateDone = late.update(10 + 44.5, offerPlayer, zones('df-ok'));
    expect(lateDone).toEqual([{ kind: 'completed', orderId: 'o1', points: 2, coins: 20, bonuses: [], inTime: false, expressOnTime: null }]);
    expect(late.totals).toEqual({ points: 7, coins: 70, deliveries: 3 });
  });

  test('express completion reports expressOnTime measured from pickup', () => {
    // ps-30 at (0,0,60) -> dp-0 at (300,0,0): 360 m; express limit 1.1 * 360 / 8 + 10 = 59.5 s
    const sys = makeSystem({ pois: packagePois([30]), cfg: cfgWith('package', 'express') });
    sys.update(8, offerPlayer, nowhere);
    const order = sys.offers[0]!.order;
    expect(order.modifier).toBe('express');
    sys.accept(order.id, 9);
    sys.update(100, offerPlayer, zones('ps-30'));
    const [done] = sys.update(100 + 59.5, offerPlayer, zones('dp-0'));
    expect(done).toMatchObject({ kind: 'completed', inTime: true, expressOnTime: true });
  });

  test('cancel starts a 45 s lockout, no offers during it, lockoutEnded once', () => {
    const sys = makeSystem({ pois: twoFoodPois() });
    sys.update(8, offerPlayer, nowhere);
    expect(sys.accept('o1', 9)).toBe('ok');
    expect(sys.cancel('o1', 10)).toBe('ok');
    expect(sys.cancel('o1', 10)).toBe('unknown');
    expect(sys.lockoutUntil).toBe(10 + ordersConfig.lockout.seconds);
    expect(sys.active).toHaveLength(0);
    const during = run(sys, 10, 54.5, 0.5);
    expect(kinds(during)).not.toContain('offered');
    expect(kinds(during)).not.toContain('lockoutEnded');
    const after = run(sys, 55, 120);
    expect(kinds(after).filter((k) => k === 'lockoutEnded')).toHaveLength(1);
    expect(after[0]).toEqual({ kind: 'lockoutEnded' });
    expect(kinds(after)).toContain('offered');
  });

  test('cancel of a picked-up order removes it without points and starts one lockout', () => {
    const sys = makeSystem({ capacity: WALK });
    sys.update(8, offerPlayer, nowhere);
    sys.accept('o1', 9);
    sys.update(10, offerPlayer, zones('fp-near'));
    expect(sys.active.filter((a) => sys.isCarried(a))).toHaveLength(1);
    expect(sys.cancel('o1', 20)).toBe('ok');
    expect(sys.active).toHaveLength(0);
    expect(sys.active.filter((a) => sys.isCarried(a))).toHaveLength(0);
    expect(sys.usedSlots()).toBe(0);
    expect(sys.totals).toEqual({ points: 0, coins: 0, deliveries: 0 });
    expect(sys.lockoutUntil).toBe(65);
    // walking into the dropoff now does nothing
    const events = run(sys, 21, 100, 1, zones('df-ok'));
    expect(kinds(events)).not.toContain('completed');
    expect(kinds(events).filter((k) => k === 'lockoutEnded')).toHaveLength(1);
    expect(sys.totals.points).toBe(0);
  });

  test('skipLockout clears the lockout', () => {
    const sys = makeSystem({ pois: twoFoodPois() });
    sys.update(8, offerPlayer, nowhere);
    sys.accept('o1', 9);
    sys.cancel('o1', 10);
    expect(kinds(sys.update(20, offerPlayer, nowhere))).toEqual([]);
    sys.skipLockout();
    expect(sys.lockoutUntil).toBe(0);
    const ev = sys.update(21, offerPlayer, nowhere);
    expect(kinds(ev)).toEqual(['lockoutEnded', 'offered']);
    expect(kinds(run(sys, 22, 80))).not.toContain('lockoutEnded');
  });

  test('a respawn breaks a carried Fragile once; a second respawn emits nothing', () => {
    const sys = makeSystem({ pois: packagePois([30]), cfg: cfgWith('package', 'fragile') });
    sys.update(8, offerPlayer, nowhere);
    const id = sys.offers[0]!.order.id;
    expect(sys.offers[0]!.order.modifier).toBe('fragile');
    sys.accept(id, 9);
    // not carried yet: a respawn does not break it
    expect(sys.onSimEvents([{ kind: 'respawned', hospitalId: 'h1' }])).toEqual([]);
    expect(sys.active[0]!.fragileIntact).toBe(true);
    sys.update(10, offerPlayer, zones('ps-30'));
    expect(sys.onSimEvents([{ kind: 'jumped' }, { kind: 'respawned', hospitalId: 'h1' }])).toEqual([
      { kind: 'fragileBroken', orderId: id, reason: 'respawn' },
    ]);
    expect(sys.onSimEvents([{ kind: 'respawned', hospitalId: 'h1' }])).toEqual([]);
    expect(sys.active).toHaveLength(1);
    expect(sys.active[0]!.fragileIntact).toBe(false);
    const [done] = sys.update(11, offerPlayer, zones('dp-0'));
    expect(done).toMatchObject({ kind: 'completed', orderId: id });
    expect(done?.kind === 'completed' && done.bonuses).not.toContain('fragile');
  });

  test('a fall above maxFallMeters breaks a carried Fragile; a fall at the limit does not', () => {
    const sys = makeSystem({ pois: packagePois([30]), cfg: cfgWith('package', 'fragile') });
    sys.update(8, offerPlayer, nowhere);
    const id = sys.offers[0]!.order.id;
    sys.accept(id, 9);
    sys.update(10, offerPlayer, zones('ps-30'));
    const max = ordersConfig.fragile.maxFallMeters;
    expect(sys.onSimEvents([{ kind: 'landed', fallHeight: max }])).toEqual([]);
    expect(sys.onSimEvents([{ kind: 'landed', fallHeight: max + 0.1 }])).toEqual([{ kind: 'fragileBroken', orderId: id, reason: 'fall' }]);
  });

  test('generateOffer returning null just advances nextOfferAt', () => {
    const sys = makeSystem({ pois: [] });
    expect(sys.nextOfferAt).toBe(8);
    expect(sys.update(8, offerPlayer, nowhere)).toEqual([]);
    expect(sys.offers).toHaveLength(0);
    expect(sys.nextOfferAt).toBe(16);
  });

  test('statModifiers.canSprint is false while carrying a bulky package', () => {
    const sys = makeSystem({ pois: packagePois([100]), cfg: cfgWith('package'), capacity: CAR });
    sys.update(8, offerPlayer, nowhere);
    const order = sys.offers[0]!.order;
    expect(order.weightClass).toBe('bulky');
    sys.accept(order.id, 9);
    expect(sys.statModifiers().canSprint).toBe(true);
    sys.update(10, offerPlayer, zones('ps-100'));
    expect(sys.statModifiers()).toEqual({ speedMul: 1, jumpHeightMul: 1, canSprint: false });
    sys.update(11, offerPlayer, zones('dp-0'));
    expect(sys.statModifiers().canSprint).toBe(true);
  });

  test('canSwitchCapacity false when active kg exceed the new capacity', () => {
    const sys = makeSystem({ pois: packagePois([30]), cfg: cfgWith('package') });
    sys.update(8, offerPlayer, nowhere);
    sys.accept(sys.offers[0]!.order.id, 9);
    expect(sys.carriedKg()).toBe(30); // reserved before pickup
    expect(sys.canSwitchCapacity({ slots: 3, maxPackageKg: 25 })).toBe(false);
    expect(sys.canSwitchCapacity(WALK)).toBe(false);
    expect(sys.canSwitchCapacity({ slots: 1, maxPackageKg: 30 })).toBe(true);
    expect(sys.canSwitchCapacity(CAR)).toBe(true);
    sys.setCapacity(WALK); // blocked: active orders are kept and capacity stays
    expect(sys.capacity).toEqual(MOTORBIKE);
    expect(sys.active).toHaveLength(1);
    sys.setCapacity(CAR);
    expect(sys.capacity).toEqual(CAR);
  });

  test('food pickup waits for prep: first arrival starts the countdown, pickup once ready and in the zone', () => {
    const sys = makeSystem({ capacity: WALK, cfg: { ...cfgWith('food'), prep: { foodSeconds: 6 } } });
    sys.update(8, offerPlayer, nowhere);
    sys.accept('o1', 9);
    const a = sys.active[0]!;
    expect(sys.prepReadyAt(a)).toBeNull();
    // First arrival starts prep, no pickup yet.
    expect(sys.update(10, offerPlayer, zones('fp-near'))).toEqual([{ kind: 'prepStarted', orderId: 'o1', readySeconds: 6 }]);
    expect(a.pickedUpAt).toBeNull();
    expect(sys.prepReadyAt(a)).toBe(16);
    // Still preparing: waiting at the counter does nothing, and prep runs on while the courier is away.
    expect(sys.update(12, offerPlayer, zones('fp-near'))).toEqual([]);
    expect(sys.update(15.9, offerPlayer, nowhere)).toEqual([]);
    // Ready but not in the zone: nothing; back in the zone: picked up, hot timer from the pickup.
    expect(sys.update(16, offerPlayer, nowhere)).toEqual([]);
    expect(sys.update(18, offerPlayer, zones('fp-near'))).toEqual([{ kind: 'pickedUp', orderId: 'o1' }]);
    expect(a.pickedUpAt).toBe(18);
  });

  test('packages skip prep: entering the pickup zone picks up at once', () => {
    const sys = makeSystem({ pois: packagePois([30]), cfg: { ...cfgWith('package'), prep: { foodSeconds: 6 } } });
    sys.update(8, offerPlayer, nowhere);
    sys.accept(sys.offers[0]!.order.id, 9);
    expect(kinds(sys.update(10, offerPlayer, zones('ps-30')))).toEqual(['pickedUp']);
  });

  test('a completed delivery holds the next offer back by the delivery cooldown', () => {
    const cfg = { ...cfgWith('food'), deliveryCooldown: { minSeconds: 8, maxSeconds: 10 } };
    const sys = makeSystem({ pois: twoFoodPois(), capacity: WALK, cfg });
    sys.update(8, offerPlayer, nowhere);
    const o = sys.offers[0]!.order;
    sys.accept(o.id, 9);
    sys.update(10, offerPlayer, zones(o.pickupPoiId));
    // nextOfferAt stayed 16 (no free slot), and the delivery at t=20 pushes it to 20 + 8 (zeroRng → minSeconds).
    expect(kinds(sys.update(20, offerPlayer, zones(o.dropoffPoiId)))).toEqual(['completed']);
    expect(sys.nextOfferAt).toBe(28);
    expect(kinds(run(sys, 21, 27.9, 0.5))).not.toContain('offered');
    expect(kinds(sys.update(28, offerPlayer, nowhere))).toContain('offered');
    // A cooldown already past a later nextOfferAt never pulls it forward.
    const idle = makeSystem({ cfg });
    expect(idle.nextOfferAt).toBe(8);
  });

  test('recently used doors are not offered again within reuseSeconds', () => {
    // base fixture has one near food pair: after accepting it, the next food offer must wait for reuse
    const sys = makeSystem({ capacity: { slots: 3, maxPackageKg: 0 } });
    sys.update(8, offerPlayer, nowhere);
    sys.accept('o1', 8);
    sys.update(9, offerPlayer, zones('fp-near'));
    sys.update(10, offerPlayer, zones('df-ok'));
    expect(kinds(run(sys, 11, 8 + ordersConfig.spacing.reuseSeconds - 1))).not.toContain('offered');
    expect(kinds(run(sys, 8 + ordersConfig.spacing.reuseSeconds, 8 + ordersConfig.spacing.reuseSeconds + 20))).toContain('offered');
  });
});

describe('spendCoins', () => {
  test('spendCoins refuses more than the player has', () => {
    const os = makeSystem({ totals: { points: 0, coins: 50, deliveries: 0 } });
    expect(os.spendCoins(51)).toBe(false);
    expect(os.totals.coins).toBe(50);
    expect(os.spendCoins(30)).toBe(true);
    expect(os.totals.coins).toBe(20);
  });
});
