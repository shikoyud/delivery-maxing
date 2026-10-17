import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { GAME_UNITS, economyConfig, expandGreybox, ridingConfig, type Garage, type GreyboxSource, type OrderSystem } from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { MockChain } from '../src/economy/MockChain';
import { Purchases, defaultWardrobe } from '../src/economy/Purchases';
import { createShopApp, shopRows, type ShopRow } from '../src/ui/phone/shopApp';
import { installFakeDom, type FakeElement } from './fakeDom';
import { model } from './phoneFixtures';

const map = expandGreybox(greybox as GreyboxSource);

/** A MockChain on a fake wall clock and Purchases over a garage that owns nothing (no vehicle tier is granted here). */
function setup() {
  const clock = { t: 1_760_000_000_000, now() { return this.t; } };
  const chain = new MockChain(null, economyConfig, clock);
  const garage = { owned: () => [], cfg: ridingConfig } as unknown as Garage;
  const purchases = new Purchases(chain, {
    garage,
    orders: {} as OrderSystem,
    map,
    player: () => map.hospitals[0]!.spawn,
    wardrobe: () => defaultWardrobe(),
    setWardrobe: () => undefined,
    ridden: () => null,
    lastRide: () => null,
    save: () => undefined,
    popup: () => undefined,
    now: () => clock.t,
  });
  const rows = (lockout = false): ShopRow[] => shopRows(purchases, chain.ownership(), defaultWardrobe(), lockout);
  return { clock, chain, purchases, rows };
}

const row = (rows: ShopRow[], id: string): ShopRow => {
  const r = rows.find((x) => x.itemId === id);
  if (!r) throw new Error(`no row ${id}`);
  return r;
};

describe('shopRows', () => {
  test('two tabs: Coins (Fuel, Outfits, Vehicle paint, Bags, Phone cases) and Token (Vehicle, Bag, Shoes, Dispatcher, Premium skins, Offer lockout)', () => {
    const rows = setup().rows();
    const sections = (tab: string): string[] => [...new Set(rows.filter((r) => r.tab === tab).map((r) => r.section))];
    expect(sections('coins')).toEqual(['Fuel', 'Outfits', 'Vehicle paint', 'Bags', 'Phone cases']);
    expect(sections('token')).toEqual(['Vehicle', 'Bag', 'Shoes', 'Dispatcher', 'Premium skins', 'Offer lockout']);
    expect(rows.filter((r) => r.section === 'Vehicle').map((r) => r.label)).toEqual(['Skateboard', 'Bicycle', 'Motorbike', 'Car']);
    expect(rows.filter((r) => r.section === 'Outfits')).toHaveLength(6);
    expect(rows.filter((r) => r.section === 'Premium skins')).toHaveLength(6);
    // The free cosmetic of each slot is owned from the start; the rest buy with Coins.
    expect(row(rows, 'cosmetic.outfit.teal').state).toBe('owned');
    expect(row(rows, 'cosmetic.outfit.coral')).toMatchObject({ state: 'buy', price: { kind: 'coins', text: '50 Coins' } });
    // No ride ridden or parked: the fuel can shows the cheaper (motorbike) price.
    expect(row(rows, 'fuelCan').price).toMatchObject({ kind: 'coins', coins: 15 });
  });

  test('each line is a ladder: owned tiers ticked, the next with Buy, the rest greyed; detail text per tier', () => {
    const s = setup();
    s.chain.dev.grantTier('bag', 2);
    const bag = s.rows().filter((r) => r.section === 'Bag');
    expect(bag.map((r) => r.state)).toEqual(['owned', 'owned', 'buy', 'locked', 'locked']);
    expect(bag.map((r) => r.detail)).toEqual(['2 slots · 10 kg', '3 slots · 25 kg', '4 slots · 50 kg', '5 slots · 100 kg', '6 slots · 150 kg']);
    // A greyed tier still shows its price.
    expect(bag[4]!.price.text).toMatch(/^\$15 ≈ [\d,]+ GAME$/);
    const rows = s.rows();
    expect(row(rows, 'line.shoes.2').detail).toBe('+7% sprint');
    expect(row(rows, 'line.shoes.5').detail).toBe('+17.5% sprint');
    expect(row(rows, 'line.dispatcher.3').detail).toBe('4 offers · every 18–30 s × 0.7');
    expect(row(rows, 'line.vehicle.3').detail).toBe('$0.03–0.30 per order');
    expect(row(rows, 'line.vehicle.1').detail).toBe('$0.01–0.06 per order');
    expect(rows.filter((r) => r.section === 'Vehicle').map((r) => r.state)).toEqual(['buy', 'locked', 'locked', 'locked']);
    // The lockout skip is only for sale during a lockout.
    expect(row(rows, 'lockoutSkip').state).toBe('locked');
    expect(row(s.rows(true), 'lockoutSkip').state).toBe('buy');
  });

  test('GAME prices read "$12 ≈ 50,000 GAME" and change when the rate changes', () => {
    const s = setup();
    expect(row(s.rows(), 'line.vehicle.3').price).toMatchObject({ kind: 'game', text: '$12 ≈ 50,000 GAME', maxGame: 51_000 * GAME_UNITS });
    expect(row(s.rows(), 'lockoutSkip').price.text).toBe('$0.50 ≈ 2,083 GAME');
    expect(s.chain.dev.setRate(economyConfig.mockChain.usdPerGame * 1.2)).toBe(true);
    expect(row(s.rows(), 'line.vehicle.3').price.text).toBe('$12 ≈ 41,666 GAME');
  });

  test('a pending row says "Confirming…" and its button is disabled', async () => {
    const s = setup();
    const out = await s.purchases.buy('line.bag.1');
    expect(out.ok).toBe(true);
    const bag = s.rows().filter((r) => r.section === 'Bag');
    expect(bag.map((r) => r.state)).toEqual(['pending', 'locked', 'locked', 'locked', 'locked']);

    const dom = installFakeDom();
    try {
      const view = createShopApp({ buy: () => undefined, confirm: () => undefined, cancel: () => undefined });
      dom.host.appendChild(view.el as unknown as FakeElement);
      view.render(model({ shop: s.rows() }), { x: 0, y: 0, z: 0 }, 0);
      const btn = dom.host.findAll((e) => e.tagName === 'BUTTON' && e.dataset.id === 'line.bag.1')[0]!;
      expect(btn.textContent).toBe('Confirming…');
      expect(btn.disabled).toBe(true);
    } finally {
      dom.restore();
    }
  });
});

describe('Shop app', () => {
  let dom: ReturnType<typeof installFakeDom>;
  let calls: string[];
  let view: ReturnType<typeof createShopApp>;
  const btn = (id: string): FakeElement => dom.host.findAll((e) => e.tagName === 'BUTTON' && e.dataset.id === id)[0]!;
  const byAction = (action: string): FakeElement => dom.host.findAll((e) => e.tagName === 'BUTTON' && e.dataset.action === action)[0]!;
  const tab = (t: string): FakeElement => dom.host.findAll((e) => e.classList.contains('phone-shop-tab') && e.dataset.tab === t)[0]!;
  const panel = (t: string): FakeElement => dom.host.findAll((e) => e.classList.contains('phone-shop-panel') && e.dataset.tab === t)[0]!;
  const draw = (rows: ShopRow[]): void => view.render(model({ shop: rows, wallet: { accrued: 0, balance: 600_000 * GAME_UNITS } }), { x: 0, y: 0, z: 0 }, 0);

  beforeEach(() => {
    dom = installFakeDom();
    calls = [];
    view = createShopApp({ buy: (id) => void calls.push(`buy ${id}`), confirm: (id) => void calls.push(`confirm ${id}`), cancel: () => void calls.push('cancel') });
    dom.host.appendChild(view.el as unknown as FakeElement);
  });
  afterEach(() => dom.restore());

  test('the tabs switch panels; each section lists its rows, owned ones ticked; the balance shows with the Mock wallet badge', () => {
    const s = setup();
    s.chain.dev.grantTier('bag', 2);
    draw(s.rows());
    expect(panel('token').hidden).toBe(false);
    expect(panel('coins').hidden).toBe(true);
    tab('coins').click();
    expect(panel('coins').hidden).toBe(false);
    expect(panel('token').hidden).toBe(true);
    expect(panel('coins').textContent).toContain('Phone cases');
    tab('token').click();
    expect(panel('token').textContent).toContain('Offer lockout');
    expect(btn('line.bag.1').textContent).toBe('✓ Owned');
    expect(btn('line.bag.3').textContent).toBe('Buy');
    expect(btn('line.bag.4').disabled).toBe(true);
    expect(dom.host.byClass('phone-shop-balance')[0]!.textContent).toContain('600,000 GAME');
    expect(dom.host.byClass('phone-mock-badge')[0]!.textContent).toBe('Mock wallet');
  });

  test('Coin items buy on the first tap', () => {
    draw(setup().rows());
    btn('cosmetic.outfit.coral').click();
    expect(calls).toEqual(['buy cosmetic.outfit.coral']);
  });

  test('Buy opens the confirm sheet with the max GAME, the split line and the Mock wallet badge', () => {
    draw(setup().rows(true));
    const sheet = dom.host.byClass('phone-shop-sheet')[0]!;
    expect(sheet.hidden).toBe(true);
    btn('line.vehicle.1').click();
    expect(calls).toEqual([]);
    expect(sheet.hidden).toBe(false);
    expect(sheet.textContent).toContain('Skateboard');
    expect(sheet.textContent).toContain('$0.01–0.06 per order');
    expect(sheet.textContent).toContain('$2 ≈ 8,333 GAME');
    expect(sheet.textContent).toContain('You pay at most 8,500 GAME');
    expect(sheet.textContent).toContain('80% burned · 20% to the reward vault');
    expect(sheet.byClass('phone-mock-badge')[0]!.textContent).toBe('Mock wallet');
    byAction('cancel').click();
    expect(calls).toEqual(['cancel']);
    expect(sheet.hidden).toBe(true);

    btn('lockoutSkip').click();
    expect(sheet.textContent).toContain('100% burned');
    byAction('confirm').click();
    expect(calls).toEqual(['cancel', 'confirm lockoutSkip']);
    expect(sheet.hidden).toBe(true);
  });

  test('a stale rate disables every Token row and shows "Prices updating, purchases paused"', () => {
    const s = setup();
    draw(s.rows());
    btn('line.shoes.1').click(); // the sheet is open when the rate goes stale
    s.chain.dev.makeRateStale();
    const rows = s.rows();
    for (const r of rows.filter((x) => x.tab === 'token')) {
      expect(r.state === 'paused' || r.state === 'locked').toBe(true);
      expect(r.price.text).toBe('Prices updating, purchases paused');
    }
    expect(rows.filter((x) => x.tab === 'coins').every((r) => r.price.kind === 'coins')).toBe(true);
    draw(rows);
    for (const r of rows.filter((x) => x.tab === 'token')) expect(btn(r.itemId).disabled).toBe(true);
    expect(dom.host.byClass('phone-shop-paused')[0]!.hidden).toBe(false);
    expect(dom.host.byClass('phone-shop-paused')[0]!.textContent).toBe('Prices updating, purchases paused');
    const sheet = dom.host.byClass('phone-shop-sheet')[0]!;
    expect(byAction('confirm').disabled).toBe(true);
    expect(sheet.textContent).toContain('Prices updating, purchases paused');
  });
});
