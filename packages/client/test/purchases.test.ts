import { beforeAll, describe, expect, test } from 'vitest';
import {
  Garage,
  OrderSystem,
  baySlot,
  createPhysicsWorld,
  economyConfig,
  expandGreybox,
  initRapier,
  mulberry32,
  ordersConfig,
  ridingConfig,
  streetDistance,
  vehicleCapacity,
  type GreyboxSource,
  type RideTier,
  type Vec3,
} from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { MockChain } from '../src/economy/MockChain';
import { Purchases } from '../src/economy/Purchases';
import { defaultWardrobe, type Wardrobe } from '../src/economy/wardrobe';

const map = expandGreybox(greybox as GreyboxSource);
const CONFIRM_MS = economyConfig.mockChain.confirmSeconds * 1000;
let rapier: Awaited<ReturnType<typeof initRapier>>;

beforeAll(async () => {
  rapier = await initRapier();
});

/** A MockChain on a fake wall clock, a Garage on the greybox, a real OrderSystem and recording popups. */
function setup(opts: { coins?: number; vehicleTier?: number } = {}) {
  const clock = { t: 1_760_000_000_000, now() { return this.t; } };
  const chain = new MockChain(null, economyConfig, clock);
  if (opts.vehicleTier) chain.dev.grantTier('vehicle', opts.vehicleTier);
  const garage = new Garage(createPhysicsWorld(rapier, map), map, []);
  const orders = new OrderSystem(
    { pois: map.pois, distance: streetDistance, rules: map.orderRules, cfg: ordersConfig, rng: mulberry32(1), capacity: vehicleCapacity('walk'), totals: { points: 0, coins: opts.coins ?? 0, deliveries: 0 } },
    0,
  );
  const env = {
    player: { ...map.hospitals[0]!.spawn } as Vec3,
    ridden: null as RideTier | null,
    lastRide: null as RideTier | null,
    wardrobe: defaultWardrobe() as Wardrobe,
    saves: 0,
    left: [] as RideTier[],
  };
  const popups: { title: string; lines: string[]; tone: string }[] = [];
  const purchases = new Purchases(chain, {
    garage,
    orders,
    map,
    player: () => env.player,
    wardrobe: () => env.wardrobe,
    setWardrobe: (w) => void (env.wardrobe = w),
    ridden: () => env.ridden,
    lastRide: () => env.lastRide,
    save: () => void env.saves++,
    popup: (title, lines = [], tone = 'info') => void popups.push({ title, lines, tone }),
    now: () => clock.t,
    removing: (t) => void env.left.push(t),
  });
  /** Moves the clock past the confirmation delay and lets Purchases settle and grant. */
  const confirm = (): void => {
    clock.t += CONFIRM_MS;
    purchases.update(clock.t);
  };
  return { chain, clock, garage, orders, env, popups, purchases, confirm };
}

/** The capsule's half extent along the heading: half the length plus the end radius. */
const halfExtent = (t: RideTier): number => {
  const c = ridingConfig.rides[t].collider;
  return (c.shape === 'lengthwise' ? c.halfLength : 0) + c.radius;
};

describe('Purchases', () => {
  test('buying the car parks it at the nearest hospital’s first free bay slot after confirmation (Review Focus 3)', async () => {
    const s = setup({ vehicleTier: 3 });
    const h = map.hospitals[0]!;
    // The chain already owns tiers 1-3: the skateboard is carried, the bicycle and motorbike take slots 0 and 1.
    expect(s.garage.owned()).toEqual(['skateboard', 'bicycle', 'motorbike']);
    expect(s.garage.spot('bicycle')).toEqual({ kind: 'parked', ...baySlot(h, 0) });
    expect(s.garage.spot('motorbike')).toEqual({ kind: 'parked', ...baySlot(h, 1) });

    // Bought far from the bay (south of Downtown General, which is still the nearest hospital).
    s.env.player = { x: 100, y: 0, z: -40 };
    const out = await s.purchases.buy('line.vehicle.4');
    expect(out.ok).toBe(true);
    expect(s.garage.owned()).not.toContain('car');
    s.confirm();
    expect(s.garage.spot('car')).toEqual({ kind: 'parked', ...baySlot(h, 2) });
    expect(s.popups.at(-1)).toMatchObject({ title: 'Car bought · parked at Downtown General' });
    // No overlap with the motorbike in front of it: slot spacing exceeds both half extents (5.5 m slots).
    const gap = ridingConfig.bays.spacing - halfExtent('car') - halfExtent('motorbike');
    expect(gap).toBeGreaterThan(0);
    const p = s.garage.state('car').position;
    const m = s.garage.state('motorbike').position;
    expect(Math.hypot(p.x - m.x, p.z - m.z)).toBeCloseTo(ridingConfig.bays.spacing);
    // Summon can bring it: far enough, no cooldown.
    expect(s.garage.summonStatus('car', { x: 100, y: 0, z: 100 }, 0)).toBe('ok');
  });

  test('buying the motorbike from tier 0 is refused as order; after skateboard and bicycle it grants and parks it', async () => {
    const s = setup();
    expect(await s.purchases.buy('line.vehicle.3')).toEqual({ ok: false, message: 'Buy Vehicle tier 1 first' });
    expect(s.chain.history()).toEqual([]);
    expect((await s.purchases.buy('line.vehicle.1')).ok).toBe(true);
    s.confirm();
    expect(s.garage.owned()).toEqual(['skateboard']);
    expect(s.garage.spot('skateboard')).toEqual({ kind: 'carried' });
    expect(await s.purchases.buy('line.vehicle.1')).toEqual({ ok: false, message: 'You already own this' });
    expect((await s.purchases.buy('line.vehicle.2')).ok).toBe(true);
    s.confirm();
    expect((await s.purchases.buy('line.vehicle.3')).ok).toBe(true);
    s.confirm();
    expect(s.garage.owned()).toEqual(['skateboard', 'bicycle', 'motorbike']);
    expect(s.garage.spot('motorbike')).toEqual({ kind: 'parked', ...baySlot(map.hospitals[0]!, 1) });
    expect(s.popups.map((p) => p.title)).toContain('Motorbike bought · parked at Downtown General');
  });

  test('nothing is granted while pending; a failed tx grants nothing and shows the failure message', async () => {
    const s = setup();
    const balance = s.chain.balance();
    const out = await s.purchases.buy('line.vehicle.1');
    expect(out.ok && out.tx?.status).toBe('pending');
    expect(s.purchases.pending().map((t) => t.itemId)).toEqual(['line.vehicle.1']);
    s.clock.t += CONFIRM_MS - 1;
    s.purchases.update(s.clock.t);
    expect(s.garage.owned()).toEqual([]);

    // The price rises 20% before it confirms (Review Focus 1): over maxGame, nothing charged.
    s.chain.dev.setRate(economyConfig.mockChain.usdPerGame / 1.2);
    s.confirm();
    expect(s.purchases.pending()).toEqual([]);
    expect(s.garage.owned()).toEqual([]);
    expect(s.chain.balance()).toBe(balance);
    expect(s.popups.at(-1)).toMatchObject({ title: 'The price moved. Nothing was charged; check the new price.', tone: 'warn' });

    // A rejected one fails at once.
    s.chain.dev.failNext();
    expect(await s.purchases.buy('line.bag.1')).toEqual({ ok: false, message: 'The wallet rejected the transaction. Nothing was charged.' });
    s.chain.dev.addGame(-s.chain.balance());
    expect(await s.purchases.buy('line.bag.1')).toEqual({ ok: false, message: 'Not enough GAME' });
  });

  test('buy sends the cap the confirm sheet showed: a price moved past it since is refused, nothing charged', async () => {
    const s = setup();
    const shown = s.purchases.quote('line.vehicle.1');
    if (shown.kind !== 'game') throw new Error('no GAME quote');
    // GAME's price falls 15% after the sheet showed the cap: the item now costs more GAME than the player agreed to.
    expect(s.chain.dev.setRate(economyConfig.mockChain.usdPerGame / 1.15)).toBe(true);
    const balance = s.chain.balance();
    expect(await s.purchases.buy('line.vehicle.1', shown.maxGame)).toEqual({ ok: false, message: 'The price moved. Nothing was charged; check the new price.' });
    expect(s.chain.balance()).toBe(balance);
    // Without a cap it pays at most the current quote's, which goes through.
    const out = await s.purchases.buy('line.vehicle.1');
    expect(out.ok).toBe(true);
  });

  test('a grant is applied once even if update() sees the confirmed tx twice', async () => {
    const s = setup();
    await s.purchases.buy('line.vehicle.1');
    s.confirm();
    s.purchases.update(s.clock.t);
    s.purchases.update(s.clock.t + 1000);
    expect(s.popups.filter((p) => p.title.startsWith('Skateboard bought'))).toHaveLength(1);

    // A Purchases built afresh (a reload) on the same chain does not grant settled transactions again.
    s.orders.lockoutUntil = 500;
    await s.purchases.buy('lockoutSkip');
    s.confirm();
    expect(s.orders.lockoutUntil).toBe(0);
    s.orders.lockoutUntil = 600;
    const again = new Purchases(s.chain, {
      garage: s.garage, orders: s.orders, map, player: () => s.env.player, wardrobe: () => s.env.wardrobe,
      setWardrobe: () => undefined, ridden: () => null, lastRide: () => null, save: () => undefined,
      popup: (title) => void s.popups.push({ title, lines: [], tone: 'info' }), now: () => s.clock.t,
    });
    again.update(s.clock.t + 5000);
    expect(s.orders.lockoutUntil).toBe(600);
  });

  test('the lockout skip ends the lockout only after confirmation', async () => {
    const s = setup();
    s.orders.lockoutUntil = 300;
    const out = await s.purchases.buy('lockoutSkip');
    expect(out.ok).toBe(true);
    s.purchases.update(s.clock.t + 1);
    expect(s.orders.lockoutUntil).toBe(300);
    s.confirm();
    expect(s.orders.lockoutUntil).toBe(0);
  });

  test('Coin cosmetics are bought at once; not enough Coins refuses', () => {
    const s = setup({ coins: 60 });
    expect(s.env.wardrobe.owned).toEqual(['cosmetic.outfit.teal', 'cosmetic.vehicle.factory', 'cosmetic.bag.cardboard', 'cosmetic.phone.slate']);
    expect(s.purchases.quote('cosmetic.outfit.coral')).toEqual({ kind: 'coins', coins: 50, text: '50 Coins' });
    expect(s.purchases.buyWithCoins('cosmetic.outfit.coral')).toEqual({ ok: true });
    expect(s.env.wardrobe.owned).toContain('cosmetic.outfit.coral');
    expect(s.orders.totals.coins).toBe(10);
    expect(s.env.saves).toBeGreaterThan(0);
    expect(s.purchases.buyWithCoins('cosmetic.outfit.coral')).toEqual({ ok: false, message: 'You already own this' });
    expect(s.purchases.buyWithCoins('cosmetic.outfit.sky')).toEqual({ ok: false, message: 'Not enough Coins' });
    expect(s.env.wardrobe.owned).not.toContain('cosmetic.outfit.sky');
    expect(s.orders.totals.coins).toBe(10);
    expect(s.chain.history()).toEqual([]);
  });

  test('a fuel can adds 25% to the last-ridden car and costs 30 Coins; without a fuelled ride it is refused', () => {
    const s = setup({ coins: 100, vehicleTier: 4 });
    expect(s.purchases.buyWithCoins('fuelCan')).toEqual({ ok: false, message: 'Ride or park a motorbike or car first' });
    s.env.lastRide = 'bicycle';
    expect(s.purchases.buyWithCoins('fuelCan')).toEqual({ ok: false, message: 'Ride or park a motorbike or car first' });
    expect(s.orders.totals.coins).toBe(100);

    s.env.lastRide = 'car';
    s.garage.state('car').fuel = 0.5;
    expect(s.purchases.quote('fuelCan')).toEqual({ kind: 'coins', coins: 30, text: '30 Coins' });
    expect(s.purchases.buyWithCoins('fuelCan')).toEqual({ ok: true });
    expect(s.garage.state('car').fuel).toBeCloseTo(0.75);
    expect(s.orders.totals.coins).toBe(70);
    // Capped at a full tank; the ridden motorbike wins over the last-ridden car, at its own price.
    s.garage.state('car').fuel = 0.9;
    s.purchases.buyWithCoins('fuelCan');
    expect(s.garage.state('car').fuel).toBe(1);
    s.env.ridden = 'motorbike';
    s.garage.state('motorbike').fuel = 0.1;
    expect(s.purchases.buyWithCoins('fuelCan')).toEqual({ ok: true });
    expect(s.garage.state('motorbike').fuel).toBeCloseTo(0.35);
    expect(s.orders.totals.coins).toBe(70 - 30 - 15);
    s.orders.totals = { ...s.orders.totals, coins: 0 };
    expect(s.purchases.buyWithCoins('fuelCan')).toEqual({ ok: false, message: 'Not enough Coins' });
  });

  test('quote shows "Prices updating, purchases paused" when the rate is stale', async () => {
    const s = setup();
    expect(s.purchases.quote('line.vehicle.3')).toEqual({ kind: 'game', usd: '$12', game: 50_000_000_000, maxGame: 51_000_000_000, text: '$12 ≈ 50,000 GAME' });
    expect(s.purchases.quote('lockoutSkip')).toMatchObject({ usd: '$0.50', text: '$0.50 ≈ 2,083 GAME' });
    s.chain.dev.makeRateStale();
    expect(s.purchases.quote('line.vehicle.3')).toEqual({ kind: 'paused', text: 'Prices updating, purchases paused' });
    expect(await s.purchases.buy('line.vehicle.1')).toEqual({ ok: false, message: 'Prices updating, purchases paused' });
    expect(s.chain.history()).toEqual([]);
  });

  test('a tier the chain no longer owns leaves the garage (the courier gets off first)', () => {
    const s = setup({ vehicleTier: 4 });
    expect(s.garage.owned()).toEqual(['skateboard', 'bicycle', 'motorbike', 'car']);
    s.env.ridden = 'car';
    s.chain.dev.grantTier('vehicle', 2);
    expect(s.env.left).toEqual(['motorbike', 'car']);
    expect(s.garage.owned()).toEqual(['skateboard', 'bicycle']);
  });
});
