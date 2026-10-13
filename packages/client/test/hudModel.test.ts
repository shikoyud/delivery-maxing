import { describe, expect, it } from 'vitest';
import {
  OrderSystem,
  expandGreybox,
  mulberry32,
  ordersConfig,
  playerZones,
  scoreOrder,
  streetDistance,
  vehiclesConfig,
  type GreyboxSource,
  type Offer,
  type VehicleTier,
} from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { hudModel, loadText, poiIndex, pointsText, stageText } from '../src/ui/hudModel';

const map = expandGreybox(greybox as GreyboxSource);
const spawn = map.hospitals[0]!.spawn;
const nowhere = { poiIds: new Set<string>(), safeZone: null };

function makeSystem(tier: VehicleTier = 'car', seed = 7): OrderSystem {
  return new OrderSystem(
    { pois: map.pois, distance: streetDistance, rules: map.orderRules, cfg: ordersConfig, rng: mulberry32(seed), capacity: vehiclesConfig[tier] },
    0,
  );
}

/** Runs the system at the spawn until an offer matching `want` is on the phone; returns it and the time. */
function waitForOffer(sys: OrderSystem, want: (o: Offer) => boolean = () => true): { offer: Offer; t: number } {
  for (let t = 0; t < 5000; t += 0.5) {
    sys.update(t, spawn, nowhere);
    const offer = sys.offers.find(want);
    if (offer) return { offer, t };
  }
  throw new Error('no matching offer');
}

describe('pointsText', () => {
  it('reads "1 pt" and "N pts"', () => {
    expect(pointsText(1)).toBe('1 pt');
    expect(pointsText(0)).toBe('0 pts');
    expect(pointsText(4)).toBe('4 pts');
  });
});

describe('poiIndex', () => {
  it('finds POIs by id and throws on an unknown one', () => {
    const idx = poiIndex(map);
    const p = map.pois[3]!;
    expect(idx.get(p.id)).toBe(p);
    expect(idx.target(p.id)).toEqual(p.position);
    expect(poiIndex(map)).toBe(idx);
    expect(() => idx.get('nope')).toThrow(/unknown POI/);
  });
});

describe('loadText', () => {
  it('reads "used/slots · kg/max kg", without kg for a carrier that takes no packages', () => {
    expect(loadText({ usedSlots: 2, slots: 3, carriedKg: 25, maxPackageKg: 50 })).toBe('2/3 · 25/50 kg');
    expect(loadText({ usedSlots: 0, slots: 1, carriedKg: 0, maxPackageKg: 0 })).toBe('0/1');
    expect(loadText({ usedSlots: 1, slots: 5, carriedKg: 12.5, maxPackageKg: 150 })).toBe('1/5 · 12.5/150 kg');
  });
});

describe('hudModel', () => {
  it('reports totals, load, safe zone and no orders on a fresh system', () => {
    const sys = makeSystem('motorbike');
    const m = hudModel(sys, map, spawn, 0, 'Downtown General');
    expect(m.totals).toEqual({ points: 0, coins: 0, deliveries: 0 });
    expect(m.totals).not.toBe(sys.totals);
    expect(m.load).toEqual({ usedSlots: 0, slots: 3, carriedKg: 0, maxPackageKg: 50 });
    expect(m.lockoutLeft).toBe(0);
    expect(m.orders).toEqual([]);
    expect(m.offers).toEqual([]);
    expect(m.safeZone).toBe('Downtown General');
  });

  it('offers carry their texts, seconds left and the best-case reward (every bonus)', () => {
    const sys = makeSystem('car');
    const { offer, t } = waitForOffer(sys, (o) => o.order.kind === 'package' && o.order.modifier !== null);
    const m = hudModel(sys, map, spawn, t + 5, null);
    const card = m.offers.find((o) => o.id === offer.order.id)!;
    const pickup = poiIndex(map).get(offer.order.pickupPoiId);
    const dropoff = poiIndex(map).get(offer.order.dropoffPoiId);
    expect(card.kind).toBe('package');
    expect(card.pickupText).toContain(pickup.name);
    expect(card.pickupText).toContain(offer.order.item);
    expect(card.dropoffText).toBe(`Deliver to ${dropoff.name}`);
    expect(card.band).toBe(offer.order.band);
    expect(card.weightKg).toBe(offer.order.weightKg);
    expect(card.secondsLeft).toBeCloseTo(offer.expiresAt - (t + 5));
    const best = scoreOrder(offer.order, { inTime: true, expressOnTime: true, intact: true }, ordersConfig);
    expect(card.reward).toEqual({ points: best.points, coins: best.coins });
    const base = scoreOrder(offer.order, { inTime: false, expressOnTime: false, intact: false }, ordersConfig);
    expect(card.reward.points).toBeGreaterThan(base.points + 1); // time bonus plus the modifier bonus
  });

  it('timers are null before pickup and count down from pickup; stage text follows the order', () => {
    const sys = makeSystem('car');
    const { offer, t } = waitForOffer(sys, (o) => o.order.kind === 'food');
    expect(sys.accept(offer.order.id, t)).toBe('ok');
    const pois = poiIndex(map);
    const pickup = pois.get(offer.order.pickupPoiId);
    const dropoff = pois.get(offer.order.dropoffPoiId);

    let m = hudModel(sys, map, spawn, t + 3, null);
    let o = m.orders[0]!;
    expect(o).toMatchObject({ id: offer.order.id, kind: 'food', item: offer.order.item, targetName: pickup.name, timer: null, express: null, weightKg: null, fragileIntact: null });
    expect(o.stage).toBe(`Pick up ${offer.order.item} from ${pickup.name}`);
    expect(o.stage).toBe(stageText(sys.active[0]!, pois));
    expect(o.target).toEqual(pickup.position);
    expect(o.distance).toBe(Math.round(Math.hypot(spawn.x - pickup.position.x, spawn.y - pickup.position.y, spawn.z - pickup.position.z)));
    expect(m.load.usedSlots).toBe(1);

    const tp = t + 10;
    sys.update(tp, pickup.position, playerZones(pickup.position, map, ordersConfig.zones));
    expect(sys.active[0]!.pickedUpAt).toBe(tp);
    m = hudModel(sys, map, pickup.position, tp + 4, null);
    o = m.orders[0]!;
    expect(o.stage).toBe(`Deliver to ${dropoff.name}`);
    expect(o.targetName).toBe(dropoff.name);
    expect(o.target).toEqual(dropoff.position);
    expect(o.timer!.secondsLeft).toBeCloseTo(offer.order.timeLimit - 4);
    expect(o.timer!.late).toBe(false);

    m = hudModel(sys, map, pickup.position, tp + offer.order.timeLimit + 1, null);
    expect(m.orders[0]!.timer).toEqual({ secondsLeft: 0, late: true });
  });

  it('an Express package shows its weight, then the par and Express timers from pickup', () => {
    const sys = makeSystem('car');
    const { offer, t } = waitForOffer(sys, (o) => o.order.modifier === 'express');
    sys.accept(offer.order.id, t);
    let o = hudModel(sys, map, spawn, t, null).orders[0]!;
    expect(o).toMatchObject({ kind: 'package', weightKg: offer.order.weightKg, timer: null, express: null, fragileIntact: null });
    const pickup = poiIndex(map).get(offer.order.pickupPoiId).position;
    sys.update(t + 1, pickup, playerZones(pickup, map, ordersConfig.zones));
    o = hudModel(sys, map, pickup, t + 3, null).orders[0]!;
    expect(o.timer!.secondsLeft).toBeCloseTo(offer.order.timeLimit - 2);
    expect(o.express!.secondsLeft).toBeCloseTo(offer.order.expressLimit! - 2);
  });

  it('reports the offer lockout left after a cancel', () => {
    const sys = makeSystem('car');
    const { offer, t } = waitForOffer(sys);
    sys.accept(offer.order.id, t);
    sys.cancel(offer.order.id, t);
    expect(hudModel(sys, map, spawn, t + 5, null).lockoutLeft).toBeCloseTo(ordersConfig.lockout.seconds - 5);
    expect(hudModel(sys, map, spawn, t + 100, null).lockoutLeft).toBe(0);
  });
});
