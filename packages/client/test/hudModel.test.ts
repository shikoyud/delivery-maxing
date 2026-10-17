import { describe, expect, it, test } from 'vitest';
import {
  GAME_UNITS,
  OrderSystem,
  economyConfig,
  usdToGame,
  type Payout,
  expandGreybox,
  mulberry32,
  ordersConfig,
  playerZones,
  scoreOrder,
  streetDistance,
  vehicleCapacity,
  type GreyboxSource,
  type Offer,
  type RouteToDoor,
  type Vec3,
  type VehicleTier,
} from '@dm/shared';
import greybox from '../../../map/greybox.json';
import type { GarageRow } from '../src/ui/phone/garageApp';
import type { ShopRow } from '../src/ui/phone/shopApp';
import { clientConfig } from '../src/clientConfig';
import { dateText, gameText, hudModel, loadText, promptFor, poiIndex, pointsText, stageText, usdText, walletModel, whenText } from '../src/ui/hudModel';
import { MockChain } from '../src/economy/MockChain';

const T0 = 1_760_000_000_000;

const map = expandGreybox(greybox as GreyboxSource);
const spawn = map.hospitals[0]!.spawn;
const nowhere = { poiIds: new Set<string>(), safeZone: null };

function makeSystem(tier: VehicleTier = 'car', seed = 7): OrderSystem {
  return new OrderSystem(
    { pois: map.pois, distance: streetDistance, rules: map.orderRules, cfg: ordersConfig, rng: mulberry32(seed), capacity: vehicleCapacity(tier) },
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
    expect(m.load).toEqual({ usedSlots: 0, slots: 4, carriedKg: 0, maxPackageKg: 50 });
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
    expect(card.dropoffName).toBeNull(); // greybox POIs have no address: the sentence already names the door
    expect(card.band).toBe(offer.order.band);
    expect(card.weightKg).toBe(offer.order.weightKg);
    expect(card.secondsLeft).toBeCloseTo(offer.expiresAt - (t + 5));
    const best = scoreOrder(offer.order, { inTime: true, expressOnTime: true, intact: true }, ordersConfig);
    expect(card.reward).toEqual({ points: best.points, coins: best.coins });
    const base = scoreOrder(offer.order, { inTime: false, expressOnTime: false, intact: false }, ordersConfig);
    expect(card.reward.points).toBeGreaterThan(base.points + 1); // time bonus plus the modifier bonus
  });

  it('city offers name the pickup with its address, and the dropoff by address with the name on its own line', () => {
    const city = { ...map, pois: map.pois.map((p, i) => ({ ...p, address: `${i + 1} Test St` })) };
    const sys = new OrderSystem(
      { pois: city.pois, distance: streetDistance, rules: city.orderRules, cfg: ordersConfig, rng: mulberry32(7), capacity: vehicleCapacity('car') },
      0,
    );
    let found: Offer | undefined;
    for (let t = 0; t < 5000 && !found; t += 0.5) {
      sys.update(t, spawn, nowhere);
      found = sys.offers[0];
    }
    const m = hudModel(sys, city, spawn, 0, null);
    const card = m.offers[0]!;
    const pickup = poiIndex(city).get(found!.order.pickupPoiId);
    const dropoff = poiIndex(city).get(found!.order.dropoffPoiId);
    expect(card.pickupText).toContain(`from ${pickup.name}, ${pickup.address}.`);
    expect(card.dropoffName).toBe(dropoff.name);
    expect(card.dropoffText).toBe(`Deliver to ${dropoff.address}`);
  });

  it("offers carry the phone's accept status (OrderSystem.canAccept at that time)", () => {
    const sys = makeSystem('motorbike');
    const { offer, t } = waitForOffer(sys, (o) => (o.order.weightKg ?? 0) > 0);
    const status = (): string => hudModel(sys, map, spawn, t, null).offers.find((o) => o.id === offer.order.id)!.acceptStatus;
    expect(status()).toBe('ok');
    sys.setCapacity({ slots: 3, maxPackageKg: 0 }); // takes no packages
    expect(status()).toBe('too_heavy');
    expect(status()).toBe(sys.canAccept(offer.order.id, t));
    expect(hudModel(sys, map, spawn, offer.expiresAt, null).offers.find((o) => o.id === offer.order.id)!.acceptStatus).toBe('expired');
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
    expect(o.stage).toBe(`Pick up ${offer.order.item} from ${pickup.name}.`);
    expect(o.stage).toBe(stageText(sys.active[0]!, pois));
    expect(o.target).toEqual(pickup.position);
    expect(o.distance).toBe(Math.round(Math.hypot(spawn.x - pickup.position.x, spawn.y - pickup.position.y, spawn.z - pickup.position.z)));
    expect(m.load.usedSlots).toBe(1);

    // Arriving at the pickup starts the food prep countdown; the pickup follows once it is ready.
    const prep = ordersConfig.prep.foodSeconds;
    const arrive = t + 10;
    sys.update(arrive, pickup.position, playerZones(pickup.position, map, ordersConfig.zones));
    expect(sys.active[0]!.pickedUpAt).toBeNull();
    m = hudModel(sys, map, pickup.position, arrive + 1, null);
    o = m.orders[0]!;
    expect(o.stage).toBe(`Waiting for ${offer.order.item} at ${pickup.name}`);
    expect(o.prep!.progress).toBeCloseTo(1 / prep);
    expect(o.prep!.ready).toBe(false);
    expect(hudModel(sys, map, pickup.position, arrive, null).orders[0]!.prep).toEqual({ progress: 0, ready: false });
    expect(hudModel(sys, map, pickup.position, arrive + prep / 2, null).orders[0]!.prep!.progress).toBeCloseTo(0.5);
    expect(hudModel(sys, map, pickup.position, arrive + prep + 5, null).orders[0]!.prep).toEqual({ progress: 1, ready: true });
    expect(o.timer).toBeNull();

    const tp = arrive + prep;
    sys.update(tp, pickup.position, playerZones(pickup.position, map, ordersConfig.zones));
    expect(sys.active[0]!.pickedUpAt).toBe(tp);
    m = hudModel(sys, map, pickup.position, tp + 4, null);
    o = m.orders[0]!;
    expect(o.stage).toBe(`Deliver to ${dropoff.name}`);
    expect(o.targetName).toBe(dropoff.name);
    expect(o.target).toEqual(dropoff.position);
    expect(o.prep).toBeNull();
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

  test('an unreached order shows the pickup countdown; a reached one does not', () => {
    const sys = makeSystem('car');
    const { offer, t } = waitForOffer(sys, (o) => o.order.kind === 'food');
    sys.accept(offer.order.id, t);
    const limit = ordersConfig.pickupDeadline.seconds;
    expect(hudModel(sys, map, spawn, t + 20, null).orders[0]!.pickup).toEqual({ secondsLeft: limit - 20, late: false });
    const pickup = poiIndex(map).get(offer.order.pickupPoiId).position;
    sys.update(t + 30, pickup, playerZones(pickup, map, ordersConfig.zones));
    expect(hudModel(sys, map, pickup, t + 31, null).orders[0]!.pickup).toBeNull();
  });

  test('the lockout reason follows a missed pickup', () => {
    const sys = makeSystem('car');
    const { offer, t } = waitForOffer(sys);
    sys.accept(offer.order.id, t);
    sys.update(t + ordersConfig.pickupDeadline.seconds, spawn, nowhere);
    const m = hudModel(sys, map, spawn, t + ordersConfig.pickupDeadline.seconds + 6, null);
    expect(m.orders).toHaveLength(0);
    expect(m.lockoutReason).toBe('missedPickup');
    expect(m.lockoutLeft).toBeCloseTo(ordersConfig.pickupDeadline.lockoutSeconds - 6);
  });

  it('reports the offer lockout left after a cancel', () => {
    const sys = makeSystem('car');
    const { offer, t } = waitForOffer(sys);
    sys.accept(offer.order.id, t);
    sys.cancel(offer.order.id, t);
    expect(hudModel(sys, map, spawn, t + 5, null).lockoutLeft).toBeCloseTo(ordersConfig.lockout.seconds - 5);
    expect(hudModel(sys, map, spawn, t + 100, null).lockoutLeft).toBe(0);
  });

  it('without a router (tests, no navmesh) the distance stays straight-line and there is no route', () => {
    const sys = makeSystem('car');
    const { offer, t } = waitForOffer(sys);
    sys.accept(offer.order.id, t);
    const o = hudModel(sys, map, spawn, t, null).orders[0]!;
    expect(o.route).toBeNull();
    const m = hudModel(sys, map, spawn, t, null);
    expect(m.nextStop).toMatchObject({ orderId: offer.order.id, distance: o.distance });
    expect(m.ride).toBeNull();
  });
});

describe('hudModel next stop and ride', () => {
  /** Two accepted orders (the first accepted is the oldest) and the time. */
  function twoOrders(): { sys: OrderSystem; ids: [string, string]; targets: [string, string]; t: number } {
    const sys = makeSystem('car');
    const a = waitForOffer(sys);
    sys.accept(a.offer.order.id, a.t);
    for (let t = a.t + 0.5; t < a.t + 5000; t += 0.5) {
      sys.update(t, spawn, nowhere);
      const b = sys.offers.find((o) => o.order.pickupPoiId !== a.offer.order.pickupPoiId);
      if (!b) continue;
      expect(sys.accept(b.order.id, t)).toBe('ok');
      return { sys, ids: [a.offer.order.id, b.order.id], targets: [a.offer.order.pickupPoiId, b.order.pickupPoiId], t };
    }
    throw new Error('no second offer');
  }
  const straight = (door: Vec3, length: number): RouteToDoor => ({ drive: [{ ...spawn }, { ...door }], footLeg: null, length });

  it('nextStop picks the target with the shortest route for the ridden tier', () => {
    const { sys, ids, targets, t } = twoOrders();
    // The route function is the ridden tier's (DeliveryLoop binds tier and start): make the second order's stop shorter.
    const lengths: Record<string, number> = { [targets[0]]: 420.4, [targets[1]]: 239.6 };
    const m = hudModel(sys, map, spawn, t, null, 1, [], { route: (id, door) => straight(door, lengths[id]!) });
    expect(m.nextStop).toMatchObject({ orderId: ids[1], name: poiIndex(map).get(targets[1]).name, distance: 240 });
    // HudOrder.distance is the route length too.
    expect(m.orders.map((o) => o.distance)).toEqual([420, 240]);
    expect(m.orders[1]!.route!.length).toBe(239.6);
    // A tie goes to the oldest order.
    const tie = hudModel(sys, map, spawn, t, null, 1, [], { route: (_id, door) => straight(door, 300) });
    expect(tie.nextStop!.orderId).toBe(ids[0]);
    // An unreachable stop (no route) loses to a reachable one.
    const one = hudModel(sys, map, spawn, t, null, 1, [], { route: (id, door) => (id === targets[1] ? null : straight(door, 999)) });
    expect(one.nextStop!.orderId).toBe(ids[0]);
  });

  it('the arrow bearing points along the first route segment, not straight at the door', () => {
    const { sys, targets, t } = twoOrders();
    const door = poiIndex(map).target(targets[0]);
    // Due north 30 m first, then across to the door.
    const corner = { x: spawn.x, y: spawn.y, z: spawn.z - 30 };
    const route = (id: string, d: Vec3): RouteToDoor | null =>
      id === targets[0] ? { drive: [{ ...spawn }, corner, { ...d }], footLeg: null, length: 10 } : null;
    const m = hudModel(sys, map, spawn, t, null, 1, [], { route });
    expect(m.nextStop!.bearing).toBeCloseTo(0); // north: yaw 0 faces -Z
    const straightAtDoor = Math.atan2(-(door.x - spawn.x), -(door.z - spawn.z));
    expect(Math.abs(straightAtDoor)).toBeGreaterThan(0.1);
  });

  test('the model carries the Shop rows and the wallet; without them, none and an empty wallet', () => {
    const sys = makeSystem('car');
    const shop: ShopRow[] = [
      {
        itemId: 'line.bag.1',
        tab: 'token',
        section: 'Bag',
        label: 'Bag 1',
        detail: '2 slots · 10 kg',
        price: { kind: 'game', usd: '$1', game: 4166e6, maxGame: 4250e6, text: '$1 ≈ 4,166 GAME' },
        state: 'buy',
      },
    ];
    const wallet = walletModel(new MockChain(null, economyConfig, { now: () => T0 }), T0, true);
    const m = hudModel(sys, map, spawn, 0, null, 1, [], { shop, wallet });
    expect(m.shop).toEqual(shop);
    expect(m.wallet).toEqual(wallet);
    expect(m.wallet.balance).toBe(600_000 * GAME_UNITS);
    const bare = hudModel(sys, map, spawn, 0, null);
    expect(bare.shop).toEqual([]);
    expect(bare.wallet).toMatchObject({ accrued: 0, balance: 0, vault: 0, lock: null, payouts: [], history: [], claims: [] });
  });

  test('walletModel: address and mock flag, balance, accrued, the vault in GAME and USD, the lock with its boost, newest-first lists', async () => {
    const clock = { t: T0, now() { return this.t; } };
    const chain = new MockChain(null, economyConfig, clock);
    const fresh = walletModel(chain, T0, true);
    expect(fresh).toEqual({
      address: 'DEV-WALLET',
      mock: true,
      balance: 600_000 * GAME_UNITS,
      accrued: 0,
      vault: chain.vault(),
      vaultUsd: '$50.00',
      vaultEmpty: false,
      usdPerGame: 0.00024,
      lock: null,
      payouts: [],
      history: [],
      claims: [],
    });
    const pay = (usdMicro: number, detail?: Payout['detail']) =>
      chain.accrue({ orderId: `o${clock.t}`, usdMicro, luck: 0, quality: 1, usdPerGame: 0.00024, boost: 1, at: clock.t, ...(detail ? { detail } : {}) });
    pay(210_000, { tier: 'car', kind: 'food', inTime: true });
    clock.t += 1000;
    pay(30_000, { tier: 'walk', kind: 'package', inTime: false });
    clock.t += 1000;
    pay(50_000); // a payout saved before payouts carried their order
    await chain.purchase('line.bag.1', 10_000 * GAME_UNITS, clock.t);
    expect(chain.lockGame(100_000 * GAME_UNITS, clock.t)).toEqual({ ok: true });
    clock.t += 3 * 3_600_000;
    const w = walletModel(chain, clock.t, true);
    expect(w.payouts.map((p) => [p.label, p.usd, p.paid, p.when])).toEqual([
      ['Order', '$0.050', true, '3 h ago'],
      ['On foot · late', '$0.030', true, '3 h ago'],
      ['Car · hot', '$0.21', true, '3 h ago'],
    ]);
    expect(w.payouts[2]!.game).toBe(usdToGame(210_000, { usdPerGame: 0.00024, updatedAt: 0 }, 'payout'));
    expect(w.history).toEqual([{ label: 'Bag 1', game: 0, burned: 0, vault: 0, status: 'pending', when: '3 h ago' }]);
    expect(w.lock).toEqual({ game: 100_000 * GAME_UNITS, boostText: '×1.07', unlocksAt: dateText(T0 + 2000 + 7 * 86_400_000), canWithdraw: false });
    // Closed phone: the lists are not built (the HUD needs only the figures).
    const closed = walletModel(chain, clock.t, false);
    expect(closed.payouts).toEqual([]);
    expect(closed.history).toEqual([]);
    expect(closed.accrued).toBe(w.accrued);
  });

  test('whenText is relative: just now, minutes, hours, days', () => {
    expect(whenText(T0, T0 + 30_000)).toBe('just now');
    expect(whenText(T0, T0 + 5 * 60_000)).toBe('5 min ago');
    expect(whenText(T0, T0 + 2 * 3_600_000)).toBe('2 h ago');
    expect(whenText(T0, T0 + 3 * 86_400_000)).toBe('3 d ago');
  });

  it('nextStop is null without active orders; ride carries tier, speed and fuel', () => {
    const sys = makeSystem('car');
    const m = hudModel(sys, map, spawn, 0, null, 1, [], { ride: { tier: 'car', speed: 21.3, fuel: 0.4 } });
    expect(m.nextStop).toBeNull();
    expect(m.ride).toEqual({ tier: 'car', speed: 21.3, fuel: 0.4 });
  });

  test('parked lists only parked vehicles with their positions (Decision 15)', () => {
    const sys = makeSystem('car');
    const row = (tier: GarageRow['tier'], status: GarageRow['status'], position: Vec3 | null): GarageRow => ({
      tier,
      status,
      position,
      distance: position ? 50 : null,
      fuel: null,
      summon: 'ok',
      readyIn: 0,
      owned: true,
      active: false,
      fuelText: null,
      range: '',
    });
    const rows = [
      row('skateboard', 'carried', null),
      row('bicycle', 'riding', null),
      row('motorbike', 'parked', { x: 40, y: 10, z: 320 }),
      row('car', 'parked', { x: 120, y: 10, z: 318 }),
    ];
    const m = hudModel(sys, map, spawn, 0, null, 1, rows);
    expect(m.parked).toEqual([
      { tier: 'motorbike', position: { x: 40, y: 10, z: 320 } },
      { tier: 'car', position: { x: 120, y: 10, z: 318 } },
    ]);
    expect(m.parked[0]!.position).not.toBe(rows[2]!.position); // a copy
    expect(hudModel(sys, map, spawn, 0, null).parked).toEqual([]);
  });
});

describe('promptFor', () => {
  const ctx = { riding: null, stopped: true, mountCandidate: null, atPump: false, tankFull: false, ownsFuelledRide: true, phoneOpen: false };
  test.each([
    [{ riding: null, stopped: true, mountCandidate: 'car', atPump: false, ownsFuelledRide: true, phoneOpen: false }, 'F · Ride the car'],
    [{ riding: 'car', stopped: true, mountCandidate: null, atPump: false, ownsFuelledRide: true, phoneOpen: false }, 'F · Get off'],
    [{ riding: 'car', stopped: true, mountCandidate: null, atPump: true, ownsFuelledRide: true, phoneOpen: false }, 'Hold E · Refuel'],
    [{ riding: 'bicycle', stopped: true, mountCandidate: null, atPump: true, ownsFuelledRide: true, phoneOpen: false }, 'F · Get off'],
    [{ riding: null, stopped: true, mountCandidate: null, atPump: true, ownsFuelledRide: true, phoneOpen: false }, 'Get on to refuel'],
    [{ riding: null, stopped: true, mountCandidate: null, atPump: true, ownsFuelledRide: false, phoneOpen: false }, null],
    [{ riding: 'car', stopped: false, mountCandidate: null, atPump: true, ownsFuelledRide: true, phoneOpen: false }, 'F · Get off'],
    [{ riding: null, stopped: true, mountCandidate: 'car', atPump: false, ownsFuelledRide: true, phoneOpen: true }, null],
  ] as const)('promptFor %j', (c, text) => {
    expect(promptFor({ ...ctx, ...c })).toBe(text);
  });
  test('the prompt says "F · Get off" while riding at any speed', () => {
    // Decision 9: no speed limit on getting off; refuelling still needs the ride stopped.
    for (const riding of ['skateboard', 'bicycle', 'motorbike', 'car'] as const) {
      for (const atPump of [false, true]) expect(promptFor({ ...ctx, riding, stopped: false, atPump }), riding).toBe('F · Get off');
    }
  });
  test('nothing to say on foot with nothing near', () => {
    expect(promptFor(ctx)).toBeNull();
  });
  test('no refuel prompt at a pump when the tank is full: F to get off instead', () => {
    expect(promptFor({ ...ctx, riding: 'car', atPump: true, tankFull: true })).toBe('F · Get off');
  });
  test('the key letters follow the bindings', () => {
    const bindings = { ...clientConfig.input.bindings, mount: ['KeyG'], interact: ['KeyR'] };
    expect(promptFor({ ...ctx, mountCandidate: 'car' }, bindings)).toBe('G · Ride the car');
    expect(promptFor({ ...ctx, riding: 'car' }, bindings)).toBe('G · Get off');
    expect(promptFor({ ...ctx, riding: 'car', atPump: true }, bindings)).toBe('Hold R · Refuel');
  });
});

test('usdText shows two decimals, three below $0.10; gameText whole GAME with thousands separators', () => {
  expect(usdText(120_000)).toBe('$0.12');
  expect(usdText(34_000)).toBe('$0.034');
  expect(usdText(100_000)).toBe('$0.10');
  expect(usdText(12_000_000)).toBe('$12.00');
  expect(gameText(0)).toBe('0');
  expect(gameText(500 * GAME_UNITS)).toBe('500');
  expect(gameText(50_000 * GAME_UNITS + 999_999)).toBe('50,000');
  expect(gameText(1_234_567_890_123)).toBe('1,234,567');
});
