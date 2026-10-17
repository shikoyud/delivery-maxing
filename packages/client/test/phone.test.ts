import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientConfig } from '../src/clientConfig';
import { PHONE_APPS, Phone } from '../src/ui/phone/Phone';
import { STUB_APPS } from '../src/ui/phone/stubApp';
import { fakeEvent, installFakeDom, type FakeElement } from './fakeDom';
import { model, offer } from './phoneFixtures';

describe('Phone', () => {
  let dom: ReturnType<typeof installFakeDom>;
  let calls: string[];
  let phone: Phone;
  const nav = (app: string): FakeElement => dom.host.findAll((e) => e.classList.contains('phone-nav-btn') && e.dataset.app === app)[0]!;
  const view = (app: string): FakeElement => dom.host.findAll((e) => e.classList.contains('phone-app') && e.dataset.app === app)[0]!;

  beforeEach(() => {
    dom = installFakeDom();
    calls = [];
    phone = new Phone(
      dom.asHost,
      {
        accept: (id) => void calls.push(`accept ${id}`),
        cancel: (id) => void calls.push(`cancel ${id}`),
        skipLockout: () => void calls.push('skip'),
        closed: () => void calls.push('closed'),
        summon: (t) => void calls.push(`summon ${t}`),
        respawn: () => void calls.push('respawn'),
        shopBuy: (id) => void calls.push(`shop buy ${id}`),
        shopConfirm: (id) => void calls.push(`shop confirm ${id}`),
        shopCancel: () => void calls.push('shop cancel'),
      },
      ['Escape', 'Tab'],
    );
  });
  afterEach(() => dom.restore());

  it('shows a close hint naming the close keys', () => {
    expect(dom.host.byClass('phone-footer')[0]!.textContent).toBe('Esc or Tab to close');
  });

  it('starts closed and hidden', () => {
    expect(phone.isOpen).toBe(false);
    expect(dom.host.byClass('phone')[0]!.hidden).toBe(true);
  });

  it('toggle opens on Orders by default', () => {
    phone.toggle();
    expect(phone.isOpen).toBe(true);
    expect(phone.app).toBe('orders');
    expect(dom.host.byClass('phone')[0]!.hidden).toBe(false);
    expect(nav('orders').classList.contains('active')).toBe(true);
    expect(view('orders').hidden).toBe(false);
  });

  it('has a nav button and a view for every app', () => {
    for (const app of PHONE_APPS) {
      expect(nav(app)).toBeDefined();
      expect(view(app)).toBeDefined();
    }
  });

  it("show('wallet') switches the nav and the view", () => {
    phone.open();
    phone.show('wallet');
    expect(phone.app).toBe('wallet');
    expect(nav('wallet').classList.contains('active')).toBe(true);
    expect(nav('orders').classList.contains('active')).toBe(false);
    expect(view('wallet').hidden).toBe(false);
    expect(view('orders').hidden).toBe(true);
  });

  it('clicking a nav button shows that app', () => {
    phone.open();
    nav('settings').click();
    expect(phone.app).toBe('settings');
  });

  it('open(app) opens on that app', () => {
    phone.open('wallet');
    expect(phone.app).toBe('wallet');
    phone.close();
    phone.open();
    expect(phone.app).toBe('orders');
  });

  it('close calls closed (once) and hides it', () => {
    phone.open();
    phone.close();
    expect(phone.isOpen).toBe(false);
    expect(calls).toEqual(['closed']);
    phone.close();
    expect(calls).toEqual(['closed']);
    phone.toggle();
    phone.toggle();
    expect(calls).toEqual(['closed', 'closed']);
  });

  it('Esc or Tab closes it and stops the key reaching the game; other keys pass', () => {
    phone.open();
    const w = fakeEvent('keydown', { code: 'KeyW' });
    dom.doc.dispatchEvent(w);
    expect(phone.isOpen).toBe(true);
    expect(w.propagationStopped).toBe(false);
    const esc = fakeEvent('keydown', { code: 'Escape' });
    dom.doc.dispatchEvent(esc);
    expect(phone.isOpen).toBe(false);
    expect(esc.propagationStopped).toBe(true);
    expect(esc.defaultPrevented).toBe(true);
    phone.open();
    dom.doc.dispatchEvent(fakeEvent('keydown', { code: 'Tab' }));
    expect(phone.isOpen).toBe(false);
    expect(calls).toEqual(['closed', 'closed']);
    // Closed: the phone leaves the keys alone (Tab opens it through the game's input).
    const tab = fakeEvent('keydown', { code: 'Tab' });
    dom.doc.dispatchEvent(tab);
    expect(tab.propagationStopped).toBe(false);
  });

  it('a held close key (auto-repeat) does not close the phone it just opened', () => {
    phone.open();
    const rep = fakeEvent('keydown', { code: 'Tab', repeat: true });
    dom.doc.dispatchEvent(rep);
    expect(phone.isOpen).toBe(true);
    expect(rep.defaultPrevented).toBe(true);
    expect(rep.propagationStopped).toBe(true);
    expect(calls).toEqual([]);
  });

  it('reopening does not draw the model from the previous open (no stale offers)', () => {
    phone.open();
    phone.render(model({ offers: [offer('old')] }));
    phone.close();
    phone.open();
    expect(view('orders').byClass('phone-offer').filter((c) => c.visible)).toHaveLength(0);
    phone.render(model({ offers: [offer('new')] }));
    expect(view('orders').byClass('phone-offer').map((c) => c.dataset.id)).toEqual(['new']);
  });

  it('render draws the Orders app and its buttons reach the callbacks', () => {
    phone.open();
    phone.render(model({ offers: [offer('x1')] }));
    expect(view('orders').byClass('phone-offer')).toHaveLength(1);
    view('orders').findAll((e) => e.dataset.action === 'accept')[0]!.click();
    expect(calls).toEqual(['accept x1']);
  });

  it('switching apps re-renders with the last model', () => {
    phone.open();
    phone.render(model({ totals: { points: 4, coins: 44, deliveries: 2 } }));
    phone.show('wallet');
    expect(view('wallet').textContent).toContain('44');
  });

  it('stub apps say when they arrive; settings lists the key bindings from config', () => {
    expect(STUB_APPS).not.toHaveProperty('garage');
    expect(STUB_APPS).not.toHaveProperty('shop');
    expect(STUB_APPS).toMatchObject({
      wardrobe: { sp: 6 },
      leaderboard: { sp: 7 },
      settings: { sp: 3 },
    });
    expect(view('leaderboard').textContent).toContain('Coming in SP7');
    const settings = view('settings').textContent;
    expect(settings).toContain('Coming in SP3');
    expect(settings).toContain('Tab');
    expect(settings).toContain(clientConfig.input.bindings.accept[0]!.replace('Key', ''));
    expect(settings).toContain('Esc');
  });

  it('the Shop app renders the shop rows; Buy and the confirm sheet reach the callbacks', () => {
    phone.open('shop');
    expect(view('shop').textContent).not.toContain('Coming in');
    const game = { kind: 'game', usd: '$1', game: 4166e6, maxGame: 4250e6, text: '$1 ≈ 4,166 GAME' } as const;
    phone.render(
      model({
        shop: [
          { itemId: 'cosmetic.outfit.coral', tab: 'coins', section: 'Outfits', label: 'Coral outfit', detail: 'Outfit colour', price: { kind: 'coins', coins: 50, text: '50 Coins' }, state: 'buy' },
          { itemId: 'line.bag.1', tab: 'token', section: 'Bag', label: 'Bag 1', detail: '2 slots · 10 kg', price: game, state: 'buy' },
        ],
      }),
    );
    const btn = (attr: 'id' | 'action', v: string): FakeElement => view('shop').findAll((e) => e.tagName === 'BUTTON' && e.dataset[attr] === v)[0]!;
    btn('id', 'cosmetic.outfit.coral').click();
    btn('id', 'line.bag.1').click();
    btn('action', 'cancel').click();
    btn('id', 'line.bag.1').click();
    btn('action', 'confirm').click();
    expect(calls).toEqual(['shop buy cosmetic.outfit.coral', 'shop cancel', 'shop confirm line.bag.1']);
  });

  it('the Garage app renders the garage rows and Summon reaches the callback', () => {
    phone.open('garage');
    expect(view('garage').textContent).not.toContain('Coming in');
    phone.render(
      model({
        garage: [
          { tier: 'car', status: 'parked', position: { x: 0, y: 0, z: 240 }, distance: 240, fuel: 0.5, summon: 'ok', readyIn: 0 },
          { tier: 'bicycle', status: 'parked', position: { x: 0, y: 0, z: 40 }, distance: 40, fuel: null, summon: 'tooClose', readyIn: 0 },
        ],
      }),
    );
    expect(view('garage').textContent).toContain('Parked · 240 m');
    const summon = view('garage').findAll((e) => e.tagName === 'BUTTON' && e.dataset.action === 'summon');
    expect(summon.map((b) => b.disabled)).toEqual([false, true]);
    summon[0]!.click();
    summon[1]!.click();
    expect(calls).toEqual(['summon car']);
  });

  it('Settings has "Respawn at nearest hospital", reaching the respawn callback', () => {
    phone.open('settings');
    const b = view('settings').findAll((e) => e.tagName === 'BUTTON' && e.dataset.action === 'respawn')[0]!;
    expect(b.textContent).toBe('Respawn at nearest hospital');
    b.click();
    expect(calls).toEqual(['respawn']);
  });

  it('the phone has seven apps and no Map tab', () => {
    expect(PHONE_APPS).toEqual(['orders', 'garage', 'shop', 'wallet', 'wardrobe', 'leaderboard', 'settings']);
    expect(dom.host.byClass('phone-nav-btn').map((b) => b.dataset.app)).toEqual([...PHONE_APPS]);
    expect(dom.host.findAll((e) => e.dataset.app === 'map')).toHaveLength(0);
  });
});
