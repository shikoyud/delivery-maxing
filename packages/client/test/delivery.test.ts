import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { emptyInput, expandGreybox, ordersConfig, vehiclesConfig, type GreyboxSource, type Offer, type Vec3, type VehicleTier } from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { clientConfig } from '../src/clientConfig';
import { DeliveryLoop } from '../src/game/delivery';
import { createProgressStore, type Progress } from '../src/game/progress';
import { ActionState } from '../src/input/actionState';
import type { HudModel } from '../src/ui/hudModel';
import type { PhoneApp, PhoneCallbacks, PhoneView } from '../src/ui/phone/Phone';

const map = expandGreybox(greybox as GreyboxSource);
const TICK = 0.25;

interface Popup {
  text: string;
  lines: string[];
  tone: string;
}

/** A DeliveryLoop with recording HUD and popups (no DOM), in-memory storage and a movable player. */
function setup(capacityTier: VehicleTier = 'car', saved?: Progress) {
  const data = new Map<string, string>();
  const progress = createProgressStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) });
  if (saved) progress.save(saved);
  const popups: Popup[] = [];
  const huds: HudModel[] = [];
  const env = { now: 0, position: { ...map.hospitals[0]!.spawn } as Vec3 };
  const actions = new ActionState(clientConfig.input, -1, 1);
  /** A recording phone: open/close state, the app, the renders, the callbacks and close keys DeliveryLoop gave it. */
  const phone = {
    isOpen: false,
    app: null as PhoneApp | null,
    renders: [] as HudModel[],
    cb: null as PhoneCallbacks | null,
    closeCodes: [] as string[],
    changes: [] as boolean[],
  };
  const phoneView: PhoneView = {
    get isOpen() {
      return phone.isOpen;
    },
    open(app = 'orders') {
      phone.isOpen = true;
      phone.app = app;
    },
    show(app) {
      phone.app = app;
    },
    close() {
      if (!phone.isOpen) return;
      phone.isOpen = false;
      phone.cb!.closed();
    },
    toggle() {
      if (phone.isOpen) this.close();
      else this.open();
    },
    render: (m) => void phone.renders.push(m),
  };
  const loop = new DeliveryLoop({
    host: {} as HTMLElement,
    scene: new THREE.Scene(),
    map,
    cfg: clientConfig,
    actions,
    progress,
    seed: 11,
    now: () => env.now,
    player: () => ({ position: env.position, mode: 'ground' }),
    capacityTier,
    ui: {
      hud: { update: (m) => void huds.push(m) },
      popups: { show: (text, lines = [], tone = 'good') => void popups.push({ text, lines, tone }) },
      phone: (cb, closeCodes) => {
        phone.cb = cb;
        phone.closeCodes = closeCodes;
        return phoneView;
      },
    },
    phoneChanged: (open) => void phone.changes.push(open),
  });
  /** One tick as Game runs it: beforeStep, (sim), afterStep, all at the same sim time. */
  const tick = (accept = false, phoneKey = false, mapKey = false): void => {
    const frame = emptyInput();
    if (accept) frame.accept = { held: true, pressed: true };
    if (phoneKey) frame.phone = { held: true, pressed: true };
    if (mapKey) frame.map = { held: true, pressed: true };
    loop.beforeStep(frame);
    loop.afterStep([], env.position, env.now);
    env.now += TICK;
  };
  const waitForOffer = (want: (o: Offer) => boolean = () => true): Offer => {
    for (let i = 0; i < 20000; i++) {
      const offer = loop.orders.offers.find(want);
      if (offer) return offer;
      tick();
    }
    throw new Error('no matching offer');
  };
  /** Ticks with the player standing in a POI zone, long enough for a food prep wait to finish. */
  const goTo = (poiId: string): void => {
    env.position = { ...map.pois.find((p) => p.id === poiId)!.position };
    const ticks = 1 + Math.ceil(ordersConfig.prep.foodSeconds / TICK);
    for (let i = 0; i < ticks; i++) tick();
  };
  const stored = (): Progress => progress.load();
  return { loop, env, popups, huds, phone, actions, tick, waitForOffer, goTo, stored };
}

describe('DeliveryLoop', () => {
  it('Y (accept.pressed) in beforeStep accepts the first offer', () => {
    const s = setup('car');
    s.waitForOffer();
    const first = s.loop.orders.offers[0]!.order.id;
    s.tick(true);
    expect(s.loop.orders.active.map((a) => a.order.id)).toEqual([first]);
    expect(s.loop.orders.offers.some((o) => o.order.id === first)).toBe(false);
    expect(s.popups.at(-1)!.text).toBe('Offer accepted');
  });

  it('Y with no offers does nothing', () => {
    const s = setup('car');
    s.tick(true);
    expect(s.loop.orders.active).toHaveLength(0);
    expect(s.popups).toHaveLength(0);
  });

  it('an accept on the expiry tick runs before the update and reports expired (Review Focus 1)', () => {
    const s = setup('car');
    const offer = s.waitForOffer();
    s.env.now = offer.expiresAt;
    s.tick(true);
    expect(s.loop.orders.active).toHaveLength(0);
    expect(s.loop.orders.offers.some((o) => o.order.id === offer.order.id)).toBe(false);
    expect(s.popups.at(-1)).toMatchObject({ text: 'Offer expired', tone: 'warn' });
    expect(s.loop.accept(offer.order.id)).toBe('gone');
  });

  it('while the phone is open only the look passes to the sim', () => {
    const s = setup();
    s.loop.openPhone();
    expect(s.loop.phoneOpen).toBe(true);
    const frame = emptyInput();
    frame.move = { x: 1, y: 0 };
    frame.look = { yaw: 1.5, pitch: 0.2 };
    frame.jump = { held: true, pressed: true };
    const out = s.loop.beforeStep(frame);
    expect(out.move).toEqual({ x: 0, y: 0 });
    expect(out.jump.pressed).toBe(false);
    expect(out.look).toEqual({ yaw: 1.5, pitch: 0.2 });
  });

  it('the phone key (Tab) opens the phone on Orders, releases held keys and reports it', () => {
    const s = setup();
    s.actions.keyDown('KeyW');
    s.tick(false, true);
    expect(s.loop.phoneOpen).toBe(true);
    expect(s.phone.app).toBe('orders');
    expect(s.phone.changes).toEqual([true]);
    expect(s.actions.sampleTick().move).toEqual({ x: 0, y: 0 }); // W was released
    expect(s.phone.closeCodes).toEqual(['Escape', ...clientConfig.input.bindings.phone, ...clientConfig.input.bindings.map]);
  });

  it('the map key (M) opens the phone straight on the Map app; while open it is a close key, not a toggle here', () => {
    const s = setup();
    s.tick(false, false, true);
    expect(s.loop.phoneOpen).toBe(true);
    expect(s.phone.app).toBe('map');
    expect(s.phone.changes).toEqual([true]);
    // While the phone is open the real M keydown is swallowed by the phone's close handler (closeCodes above);
    // a map press reaching beforeStep anyway must not reopen or switch apps.
    s.phone.app = 'orders';
    s.tick(false, false, true);
    expect(s.phone.app).toBe('orders');
    expect(s.loop.phoneOpen).toBe(true);
  });

  it('closing the phone (Esc or Tab in the phone) reports it and gives the sim its input back', () => {
    const s = setup();
    s.loop.openPhone('wallet');
    expect(s.phone.app).toBe('wallet');
    s.loop.closePhone();
    expect(s.loop.phoneOpen).toBe(false);
    expect(s.phone.changes).toEqual([true, false]);
    const frame = emptyInput();
    frame.move = { x: 1, y: 0 };
    expect(s.loop.beforeStep(frame).move).toEqual({ x: 1, y: 0 });
  });

  it('openPhone(app) while open switches the app without reporting a second open', () => {
    const s = setup();
    s.loop.openPhone();
    s.loop.openPhone('settings');
    expect(s.phone.app).toBe('settings');
    expect(s.phone.changes).toEqual([true]);
  });

  it('Y is ignored while the phone is open; the Orders app Accept goes through accept()', () => {
    const s = setup('car');
    const offer = s.waitForOffer();
    s.loop.openPhone();
    s.tick(true);
    expect(s.loop.orders.active).toHaveLength(0);
    s.phone.cb!.accept(offer.order.id);
    expect(s.loop.orders.active.map((a) => a.order.id)).toEqual([offer.order.id]);
    expect(s.popups.at(-1)!.text).toBe('Offer accepted');
    s.phone.cb!.cancel(offer.order.id);
    expect(s.loop.orders.active).toHaveLength(0);
    expect(s.loop.orders.lockoutUntil).toBeGreaterThan(s.env.now);
    s.phone.cb!.skipLockout();
    expect(s.loop.orders.lockoutUntil).toBeLessThanOrEqual(s.env.now);
  });

  it('draw renders the phone with the HUD model while it is open', () => {
    const s = setup('car');
    s.waitForOffer();
    s.loop.draw(0);
    expect(s.phone.renders).toHaveLength(0);
    s.loop.openPhone();
    s.loop.draw(0.01); // opening forces a refresh
    expect(s.phone.renders).toHaveLength(1);
    expect(s.phone.renders[0]!.offers.length).toBeGreaterThan(0);
    expect(s.phone.renders[0]!.offers[0]!.acceptStatus).toBe('ok');
  });

  it('pickup then dropoff completes the order, adds totals, saves progress and announces it', () => {
    const s = setup('car');
    const offer = s.waitForOffer((o) => o.order.kind === 'food');
    expect(s.loop.accept(offer.order.id)).toBe('ok');
    expect(s.loop.carriedCount()).toBe(0);
    s.goTo(offer.order.pickupPoiId);
    expect(s.loop.carriedCount()).toBe(1);
    expect(s.popups.some((p) => p.text === `Preparing ${offer.order.item}`)).toBe(true);
    expect(s.popups.at(-1)!.text).toBe(`Picked up ${offer.order.item}`);
    s.goTo(offer.order.dropoffPoiId);
    expect(s.loop.carriedCount()).toBe(0);
    const totals = s.loop.orders.totals;
    expect(totals.deliveries).toBe(1);
    expect(totals.points).toBeGreaterThan(0);
    expect(s.stored().totals).toEqual(totals);
    const done = s.popups.at(-1)!;
    expect(done.text).toBe(`Delivered! +${totals.points} pts · +${totals.coins} coins`);
    expect(done.lines.some((l) => l.startsWith('Still hot'))).toBe(true);
  });

  it('carriedCount drops after cancelling a picked-up order (Review Focus 3)', () => {
    const s = setup('car');
    const offer = s.waitForOffer((o) => o.order.kind === 'food');
    s.loop.accept(offer.order.id);
    s.goTo(offer.order.pickupPoiId);
    expect(s.loop.carriedCount()).toBe(1);
    expect(s.loop.cancel(offer.order.id)).toBe('ok');
    expect(s.loop.carriedCount()).toBe(0);
    expect(s.loop.orders.active).toHaveLength(0);
    expect(s.popups.at(-1)).toMatchObject({ text: `Order cancelled · no new offers for ${ordersConfig.lockout.seconds} s`, tone: 'warn' });
    expect(s.loop.cancel(offer.order.id)).toBe('unknown');
  });

  it("setCapacityTier('walk') is refused while carrying a package; a fitting tier is applied and saved", () => {
    const s = setup('car');
    const offer = s.waitForOffer((o) => o.order.kind === 'package');
    expect(s.loop.accept(offer.order.id)).toBe('ok');
    s.goTo(offer.order.pickupPoiId);
    expect(s.loop.carriedCount()).toBe(1);
    const before = s.popups.length;
    expect(s.loop.setCapacityTier('walk')).toBe(false);
    expect(s.loop.orders.capacity).toEqual(vehiclesConfig.car);
    expect(s.popups.length).toBe(before + 1);
    expect(s.popups.at(-1)!.tone).toBe('warn');
    expect(s.stored().capacityTier).toBe('walk'); // nothing saved by the refusal (storage still holds the default)

    const fresh = setup('walk');
    expect(fresh.loop.setCapacityTier('motorbike')).toBe(true);
    expect(fresh.loop.orders.capacity).toEqual(vehiclesConfig.motorbike);
    expect(fresh.stored().capacityTier).toBe('motorbike');
  });

  it('starts from the saved totals and the given capacity tier', () => {
    const s = setup('bicycle', { totals: { points: 5, coins: 50, deliveries: 3 }, capacityTier: 'bicycle' });
    expect(s.loop.orders.totals).toEqual({ points: 5, coins: 50, deliveries: 3 });
    expect(s.loop.orders.capacity).toEqual(vehiclesConfig.bicycle);
  });

  it('resetProgress zeroes the totals, drops to walk and saves', () => {
    const s = setup('car', { totals: { points: 5, coins: 50, deliveries: 3 }, capacityTier: 'car' });
    const offer = s.waitForOffer();
    s.loop.accept(offer.order.id);
    s.loop.resetProgress();
    expect(s.loop.orders.totals).toEqual({ points: 0, coins: 0, deliveries: 0 });
    expect(s.loop.orders.capacity).toEqual(vehiclesConfig.walk);
    expect(s.loop.orders.active).toHaveLength(0);
    expect(s.stored()).toEqual({ totals: { points: 0, coins: 0, deliveries: 0 }, capacityTier: 'walk' });
  });

  it('draw feeds the HUD model at hudUpdateHz', () => {
    const s = setup('car');
    s.loop.draw(0);
    s.loop.draw(0.01);
    expect(s.huds).toHaveLength(1);
    s.loop.draw(1 / clientConfig.ui.hudUpdateHz + 0.001);
    expect(s.huds).toHaveLength(2);
    expect(s.huds[0]!.load.slots).toBe(vehiclesConfig.car.slots);
  });
});
