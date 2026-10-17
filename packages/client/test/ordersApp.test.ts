import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ordersConfig } from '@dm/shared';
import { acceptBlockedReason, renderOrdersApp } from '../src/ui/phone/ordersApp';
import { renderWalletApp } from '../src/ui/phone/walletApp';
import { asEl, installFakeDom, type FakeElement } from './fakeDom';
import { model, offer, order } from './phoneFixtures';

describe('acceptBlockedReason', () => {
  it('has copy for every refusal', () => {
    expect(acceptBlockedReason('gone')).toBe('Taken');
    expect(acceptBlockedReason('expired')).toBe('Expired');
    expect(acceptBlockedReason('no_slots')).toBe('No free slot');
    expect(acceptBlockedReason('too_heavy')).toBe('Too heavy for your ride');
    expect(acceptBlockedReason('ok')).toBe('');
  });
});

describe('renderOrdersApp', () => {
  let dom: ReturnType<typeof installFakeDom>;
  const calls: string[] = [];
  const cb = {
    accept: (id: string) => void calls.push(`accept ${id}`),
    cancel: (id: string) => void calls.push(`cancel ${id}`),
    skipLockout: () => void calls.push('skip'),
  };
  const button = (root: FakeElement, action: string, id?: string): FakeElement | undefined =>
    root.findAll((e) => e.tagName === 'BUTTON' && e.dataset.action === action && (id === undefined || e.dataset.id === id))[0];

  beforeEach(() => {
    dom = installFakeDom();
    calls.length = 0;
  });
  afterEach(() => dom.restore());

  it('renders one card per offer with its texts, band, kg, timer and reward', () => {
    renderOrdersApp(dom.asHost, model({ offers: [offer('a'), offer('b', { kind: 'package', band: 'long', weightKg: 12, reward: { points: 6, coins: 60 } })] }), cb);
    const cards = dom.host.byClass('phone-offer');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('Pick up ramen from Noodle Bar a');
    expect(cards[0]!.textContent).toContain('Deliver to Elm Flats a');
    expect(cards[0]!.textContent).toContain('Short');
    expect(cards[0]!.textContent).toContain('0:15');
    expect(cards[0]!.textContent).toContain('+2 pts · +20 coins');
    expect(cards[1]!.textContent).toContain('Long');
    expect(cards[1]!.textContent).toContain('12 kg');
    expect(cards[1]!.textContent).toContain('+6 pts · +60 coins');
  });

  it('a city offer row shows the dropoff address under the household name', () => {
    const o = offer('c', {
      pickupText: 'Pick up 2 baguettes and a sourdough from Crumb & Co. Bakery, 14 Market St.',
      dropoffName: 'J. Hartley',
      dropoffText: 'Deliver to 7 Uptown Ave, apt 4',
    });
    renderOrdersApp(dom.asHost, model({ offers: [o] }), cb);
    const card = dom.host.byClass('phone-offer')[0]!;
    expect(card.textContent).toContain('Pick up 2 baguettes and a sourdough from Crumb & Co. Bakery, 14 Market St.');
    const name = card.byClass('phone-card-name')[0]!;
    const address = card.byClass('phone-card-address')[0]!;
    expect(name.hidden).toBe(false);
    expect(name.textContent).toBe('J. Hartley');
    expect(address.textContent).toBe('Deliver to 7 Uptown Ave, apt 4');
    const rows = card.children;
    expect(rows.indexOf(name)).toBe(rows.indexOf(address) - 1);
  });

  it('a greybox offer (no address) shows no separate name line', () => {
    renderOrdersApp(dom.asHost, model({ offers: [offer('a')] }), cb);
    const card = dom.host.byClass('phone-offer')[0]!;
    expect(card.byClass('phone-card-name')[0]!.hidden).toBe(true);
    expect(card.byClass('phone-card-address')[0]!.textContent).toBe('Deliver to Elm Flats a');
  });

  it('Accept calls back with the offer id', () => {
    renderOrdersApp(dom.asHost, model({ offers: [offer('a'), offer('b')] }), cb);
    button(dom.host, 'accept', 'b')!.click();
    expect(calls).toEqual(['accept b']);
  });

  it('an expired offer (removed from the model) leaves no card (Review Focus 1)', () => {
    renderOrdersApp(dom.asHost, model({ offers: [offer('a'), offer('b')] }), cb);
    renderOrdersApp(dom.asHost, model({ offers: [offer('b', { secondsLeft: 3 })] }), cb);
    const cards = dom.host.byClass('phone-offer');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.dataset.id).toBe('b');
    expect(dom.host.textContent).not.toContain('Noodle Bar a');
    expect(button(dom.host, 'accept', 'a')).toBeUndefined();
    renderOrdersApp(dom.asHost, model(), cb);
    expect(dom.host.byClass('phone-offer')).toHaveLength(0);
  });

  it('keeps the same card and button across renders (clicks are not lost to re-renders)', () => {
    renderOrdersApp(dom.asHost, model({ offers: [offer('a', { secondsLeft: 10 })] }), cb);
    const before = button(dom.host, 'accept', 'a');
    renderOrdersApp(dom.asHost, model({ offers: [offer('a', { secondsLeft: 9 })] }), cb);
    expect(button(dom.host, 'accept', 'a')).toBe(before);
    expect(dom.host.byClass('phone-offer')[0]!.textContent).toContain('0:09');
  });

  it('disables Accept with the refusal copy when the offer cannot be accepted', () => {
    renderOrdersApp(dom.asHost, model({ offers: [offer('a', { acceptStatus: 'too_heavy' }), offer('b', { acceptStatus: 'no_slots' })] }), cb);
    const a = button(dom.host, 'accept', 'a')!;
    expect(a.disabled).toBe(true);
    expect(a.textContent).toBe('Too heavy for your ride');
    expect(button(dom.host, 'accept', 'b')!.textContent).toBe('No free slot');
    a.click();
    expect(calls).toEqual([]);
    renderOrdersApp(dom.asHost, model({ offers: [offer('a')] }), cb);
    expect(a.disabled).toBe(false);
    expect(a.textContent).toBe('Accept');
  });

  it('lists active orders with stage, timer and a Cancel that calls back with the order id', () => {
    renderOrdersApp(dom.asHost, model({ orders: [order('o1'), order('o2', { kind: 'food', timer: null })] }), cb);
    const cards = dom.host.byClass('phone-active-order');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('Deliver to Oak Court o1');
    expect(cards[0]!.textContent).toContain('Par 1:05');
    button(dom.host, 'cancel', 'o2')!.click();
    expect(calls).toEqual(['cancel o2']);
  });

  it('shows the lockout row only while lockoutLeft > 0, with a dev-stub skip', () => {
    renderOrdersApp(dom.asHost, model(), cb);
    const row = dom.host.byClass('phone-lockout')[0]!;
    expect(row.hidden).toBe(true);
    renderOrdersApp(dom.asHost, model({ lockoutLeft: 31.4 }), cb);
    expect(row.hidden).toBe(false);
    expect(row.textContent).toContain('No new offers for 32 s');
    const skip = button(dom.host, 'skip')!;
    expect(skip.textContent).toContain('Skip (burn GAME)');
    expect(row.textContent).toContain('dev stub');
    skip.click();
    expect(calls).toEqual(['skip']);
    renderOrdersApp(dom.asHost, model(), cb);
    expect(row.hidden).toBe(true);
  });

  it('the lockout row names a missed pickup', () => {
    renderOrdersApp(dom.asHost, model({ lockoutLeft: 173.2, lockoutReason: 'missedPickup' }), cb);
    expect(dom.host.byClass('phone-lockout')[0]!.textContent).toContain('Missed pickup · no new offers for 174 s');
  });

  it('says the cancel lockout length from config on the Cancel button', () => {
    renderOrdersApp(dom.asHost, model({ orders: [order('o1')] }), cb);
    expect(button(dom.host, 'cancel', 'o1')!.title).toContain(`${ordersConfig.lockout.seconds} s`);
  });
});

describe('renderWalletApp', () => {
  it('shows Delivery Points, Coins, deliveries and the GAME note, no invented amounts', () => {
    const dom = installFakeDom();
    try {
      renderWalletApp(asEl(dom.host), model({ totals: { points: 7, coins: 70, deliveries: 3 } }));
      const t = dom.host.textContent;
      expect(t).toContain('Delivery Points');
      expect(t).toContain('7');
      expect(t).toContain('Coins');
      expect(t).toContain('70');
      expect(t).toContain('Deliveries');
      expect(t).toContain('GAME rewards arrive with the reward program (spec §9)');
      expect(dom.host.byClass('phone-wallet-row')).toHaveLength(3); // no GAME balance row: nothing invented
    } finally {
      dom.restore();
    }
  });
});
