import { describe, expect, it, test } from 'vitest';
import * as THREE from 'three';
import {
  emptyInput,
  expandGreybox,
  ordersConfig,
  ridingConfig,
  streetDistance,
  vehiclesConfig,
  type GreyboxSource,
  type Offer,
  type PathDistance,
  type RideTier,
  type SimEvent,
  type SummonResult,
  type Vec3,
  type VehicleState,
} from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { clientConfig } from '../src/clientConfig';
import { DeliveryLoop, MOUNT_REFUSED, simEventHint } from '../src/game/delivery';
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

/**
 * A DeliveryLoop with recording HUD and popups (no DOM), in-memory storage, a movable player and a fake rider (on foot,
 * last ridden `lastRide`). `distance` defaults to the street grid.
 */
function setup(lastRide: RideTier | null = 'car', saved?: Progress, distance: PathDistance = streetDistance) {
  const data = new Map<string, string>();
  const progress = createProgressStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }, 'greybox');
  if (saved) progress.save(saved);
  const popups: Popup[] = [];
  const huds: HudModel[] = [];
  const env = { now: 0, position: { ...map.hospitals[0]!.spawn } as Vec3, grounded: true, lastGrounded: undefined as Vec3 | undefined };
  /** What the sim reports: the ridden and last ridden tier, and what F would mount on foot. */
  const rider = { riding: null as RideTier | null, lastRide, speed: 0, candidate: null as RideTier | null };
  /** A recording garage: what summon answers, the cooldown left, and the calls summon and respawn got. */
  const vehicles = { result: 'ok' as SummonResult, readyIn: 0, calls: [] as string[] };
  /** Each ride's dynamic state (refuelling reads and fills `fuel`). */
  const states = Object.fromEntries(
    (['skateboard', 'bicycle', 'motorbike', 'car'] as RideTier[]).map((tier): [RideTier, VehicleState] => [
      tier,
      { tier, position: { x: 0, y: 0, z: 0 }, heading: 0, velocity: { x: 0, y: 0, z: 0 }, grounded: true, groundNormal: { x: 0, y: 1, z: 0 }, airApexY: 0, fuel: 1 },
    ]),
  ) as Record<RideTier, VehicleState>;
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
    player: () => ({ position: env.position, mode: 'ground', grounded: env.grounded, lastGrounded: env.lastGrounded }),
    rider: () => ({ riding: rider.riding, lastRide: rider.lastRide, speed: rider.speed, mountCandidate: () => rider.candidate }),
    distance,
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
    vehicles: {
      rows: () => [{ tier: 'car', status: 'parked', position: { x: 0, y: 0, z: 240 }, distance: 240, fuel: 1, summon: 'ok', readyIn: vehicles.readyIn }],
      summon: (t, now) => {
        vehicles.calls.push(`summon ${t} at ${now}`);
        return vehicles.result;
      },
      state: (t) => states[t],
      snapshot: () => [{ tier: 'car', spot: { kind: 'parked', position: { x: 1, y: 0, z: 2 }, heading: 0.5 }, fuel: states.car.fuel }],
      respawn: () => {
        vehicles.calls.push('respawn');
        env.position = { ...map.hospitals[0]!.spawn };
        return [{ kind: 'respawned', hospitalId: map.hospitals[0]!.id }];
      },
    },
  });
  /** The frames beforeStep handed to the sim. */
  const simFrames: ReturnType<typeof emptyInput>[] = [];
  /**
   * One tick as Game runs it: beforeStep, (sim), afterStep, all at the same sim time. `extra.mount` presses F;
   * `extra.events` are the sim events afterStep gets.
   */
  const tick = (
    accept = false,
    phoneKey = false,
    mapKey = false,
    extra: { mount?: boolean; events?: SimEvent[]; interact?: { held: boolean; pressed: boolean }; move?: { x: number; y: number } } = {},
  ): void => {
    const frame = emptyInput();
    if (extra.interact) frame.interact = extra.interact;
    if (extra.move) frame.move = extra.move;
    if (accept) frame.accept = { held: true, pressed: true };
    if (phoneKey) frame.phone = { held: true, pressed: true };
    if (mapKey) frame.map = { held: true, pressed: true };
    if (extra.mount) frame.mount = { held: true, pressed: true };
    simFrames.push(loop.beforeStep(frame));
    loop.afterStep(extra.events ?? [], env.position, env.now);
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
  /** Ticks for `seconds` with the player standing where they are. */
  const wait = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds / TICK); i++) tick();
  };
  const poiPos = (id: string): Vec3 => ({ ...map.pois.find((p) => p.id === id)!.position });
  return { loop, env, rider, popups, huds, phone, actions, tick, simFrames, waitForOffer, goTo, wait, poiPos, stored, vehicles, states };
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

  it('starts from the saved totals and the last ridden tier', () => {
    const s = setup('bicycle', { totals: { points: 5, coins: 50, deliveries: 3 }, garage: [], lastRide: null });
    expect(s.loop.orders.totals).toEqual({ points: 5, coins: 50, deliveries: 3 });
    expect(s.loop.orders.capacity).toEqual(vehiclesConfig.bicycle);
  });

  it('resetProgress zeroes the totals, drops the orders and saves; capacity still follows the ride', () => {
    const s = setup('car', { totals: { points: 5, coins: 50, deliveries: 3 }, garage: [], lastRide: null });
    const offer = s.waitForOffer();
    s.loop.accept(offer.order.id);
    s.loop.resetProgress();
    expect(s.loop.orders.totals).toEqual({ points: 0, coins: 0, deliveries: 0 });
    expect(s.loop.orders.capacity).toEqual(vehiclesConfig.car);
    expect(s.loop.orders.active).toHaveLength(0);
    expect(s.stored().totals).toEqual({ points: 0, coins: 0, deliveries: 0 });
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

  it('Review Focus 4: two food orders, last ride bicycle, F next to the skateboard is swallowed with the reason and both orders stay', () => {
    const s = setup('bicycle');
    for (let n = 0; n < 2; n++) s.loop.accept(s.waitForOffer((o) => o.order.kind === 'food').order.id);
    const ids = s.loop.orders.active.map((a) => a.order.id);
    expect(ids).toHaveLength(2);
    s.rider.candidate = 'skateboard';
    const before = s.popups.length;
    s.tick(false, false, false, { mount: true });
    expect(s.simFrames.at(-1)!.mount).toEqual({ held: false, pressed: false });
    expect(s.popups.length).toBe(before + 1);
    expect(s.popups.at(-1)).toEqual({ text: "Can't ride the skateboard", lines: ["Your orders don't fit: 1 slot and no packages"], tone: 'warn' });
    expect(s.loop.orders.active.map((a) => a.order.id)).toEqual(ids);
    expect(s.loop.capacityTier).toBe('bicycle');
    expect(s.loop.orders.capacity).toEqual(vehiclesConfig.bicycle);
    // A ride that holds them (a car next to the courier) passes F to the sim.
    s.rider.candidate = 'car';
    s.tick(false, false, false, { mount: true });
    expect(s.simFrames.at(-1)!.mount.pressed).toBe(true);
    expect(s.popups.length).toBe(before + 1);
  });

  it('riding through the pickup zone does not pick up and shows the get-off hint once per cooldown', () => {
    const s = setup('bicycle');
    const offer = s.waitForOffer((o) => o.order.kind === 'food');
    s.loop.accept(offer.order.id);
    s.rider.riding = 'bicycle';
    s.env.position = s.poiPos(offer.order.pickupPoiId);
    const cooldown = clientConfig.ui.hintCooldownSeconds;
    const hints = (): number => s.popups.filter((p) => p.text === 'Get off to pick up').length;
    s.wait(cooldown - TICK);
    expect(hints()).toBe(1);
    s.wait(TICK * 2);
    expect(hints()).toBe(2);
    s.wait(ordersConfig.prep.foodSeconds + 1);
    expect(s.popups.some((p) => p.text.startsWith('Preparing') || p.text.startsWith('Picked up'))).toBe(false);
    expect(s.loop.orders.active[0]!.prepStartedAt).toBeNull();
    expect(s.loop.carriedCount()).toBe(0);
    expect(s.loop.safeZone).toBeNull();
  });

  it('stepping off inside the pickup zone starts the food prep', () => {
    const s = setup('bicycle');
    const offer = s.waitForOffer((o) => o.order.kind === 'food');
    s.loop.accept(offer.order.id);
    s.rider.riding = 'bicycle';
    s.env.position = s.poiPos(offer.order.pickupPoiId);
    s.wait(1);
    expect(s.loop.orders.active[0]!.prepStartedAt).toBeNull();
    s.rider.riding = null;
    s.tick();
    expect(s.popups.at(-1)!.text).toBe(`Preparing ${offer.order.item}`);
    s.goTo(offer.order.pickupPoiId);
    expect(s.loop.carriedCount()).toBe(1);
    // Riding to the door: no hand-over until the courier gets off.
    s.rider.riding = 'bicycle';
    s.env.position = s.poiPos(offer.order.dropoffPoiId);
    s.wait(1);
    expect(s.popups.filter((p) => p.text === 'Get off to hand over')).toHaveLength(1);
    expect(s.loop.orders.totals.deliveries).toBe(0);
    s.rider.riding = null;
    s.tick();
    expect(s.loop.orders.totals.deliveries).toBe(1);
  });

  it('capacity follows the ridden tier, then the last ridden tier on foot', () => {
    const s = setup(null);
    s.tick();
    expect(s.loop.capacityTier).toBe('walk');
    expect(s.loop.orders.capacity).toEqual(vehiclesConfig.walk);
    s.rider.riding = 'motorbike';
    s.rider.lastRide = 'motorbike';
    s.tick();
    expect(s.loop.capacityTier).toBe('motorbike');
    expect(s.loop.orders.capacity).toEqual(vehiclesConfig.motorbike);
    s.rider.riding = null;
    s.tick();
    expect(s.loop.capacityTier).toBe('motorbike');
    expect(s.loop.orders.capacity).toEqual(vehiclesConfig.motorbike);
    s.rider.riding = 'bicycle';
    s.rider.lastRide = 'bicycle';
    s.tick();
    expect(s.loop.orders.capacity).toEqual(vehiclesConfig.bicycle);
  });

  it('Review Focus 5: after a tow, carried orders are kept and the Fragile break popup shows once', () => {
    const s = setup('car');
    const offer = s.waitForOffer((o) => o.order.modifier === 'fragile');
    s.loop.accept(offer.order.id);
    s.goTo(offer.order.pickupPoiId);
    expect(s.loop.carriedCount()).toBe(1);
    s.rider.riding = 'car';
    s.tick(false, false, false, { events: [{ kind: 'crashed', speed: 15 }] });
    const crash = s.popups.filter((p) => p.text === 'Crashed · Fragile bonus lost');
    expect(crash).toHaveLength(1);
    expect(crash[0]!.tone).toBe('warn');
    // Out of bounds: respawned at the hospital, the car towed to its bay, the courier on foot.
    s.rider.riding = null;
    s.tick(false, false, false, { events: [{ kind: 'respawned', hospitalId: map.hospitals[0]!.id }, { kind: 'towed', tier: 'car', hospitalId: map.hospitals[0]!.id }] });
    s.tick(false, false, false, { events: [{ kind: 'crashed', speed: 20 }] });
    expect(s.popups.filter((p) => p.text.includes('Fragile'))).toHaveLength(1);
    expect(s.loop.orders.active.map((a) => a.order.id)).toEqual([offer.order.id]);
    expect(s.loop.carriedCount()).toBe(1);
    expect(s.loop.orders.capacity).toEqual(vehiclesConfig.car);
  });

  it('an offer whose door has no walk path is never generated', () => {
    /** Distinct door ids used by the offers seen over `seconds` of play. */
    const doorsSeen = (s: ReturnType<typeof setup>, seconds: number): Map<string, number> => {
      const seen = new Map<string, number>();
      const ids = new Set<string>();
      for (let i = 0; i < seconds / TICK; i++) {
        s.tick();
        for (const o of s.loop.orders.offers) {
          if (ids.has(o.order.id)) continue;
          ids.add(o.order.id);
          for (const d of [o.order.pickupPoiId, o.order.dropoffPoiId]) seen.set(d, (seen.get(d) ?? 0) + 1);
        }
      }
      return seen;
    };
    const free = doorsSeen(setup('car'), 600);
    // Block the door offered most often (not vacuous: it does come up when it has a path).
    const [blocked] = [...free.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const door = map.pois.find((p) => p.id === blocked)!.position;
    const noPath: PathDistance = (a, b) => (a === door || b === door ? Infinity : streetDistance(a, b));
    const seen = doorsSeen(setup('car', undefined, noPath), 600);
    expect(seen.size).toBeGreaterThan(0);
    expect(seen.has(blocked)).toBe(false);
  });

  it('offers are measured from the last grounded feet while the courier is in the air', () => {
    const froms: Vec3[] = [];
    const ground = { ...map.hospitals[0]!.spawn };
    const s = setup('car', undefined, (a, b) => {
      froms.push(a);
      return streetDistance(a, b);
    });
    s.env.grounded = false;
    s.env.lastGrounded = ground;
    s.env.position = { ...ground, y: ground.y + 1.5 };
    s.waitForOffer();
    expect(froms.some((f) => f === ground)).toBe(true);
    expect(froms.some((f) => f === s.env.position)).toBe(false);
  });

  it('riding an airborne vehicle, offers are measured from the last grounded spot too (final review 4)', () => {
    const froms: Vec3[] = [];
    const ground = { ...map.hospitals[0]!.spawn };
    const s = setup('car', undefined, (a, b) => {
      froms.push(a);
      return streetDistance(a, b);
    });
    s.rider.riding = 'car';
    s.env.grounded = false;
    s.env.lastGrounded = ground;
    s.env.position = { ...ground, y: ground.y + 1.5 };
    s.waitForOffer();
    expect(froms.some((f) => f === ground)).toBe(true);
    expect(froms.some((f) => f === s.env.position)).toBe(false);
  });

  it('Garage Summon: "Car is here", or the refusal; the phone callback summons at sim time', () => {
    const s = setup('car');
    s.env.now = 12;
    s.loop.openPhone('garage');
    s.phone.cb!.summon('car');
    expect(s.vehicles.calls).toEqual(['summon car at 12']);
    expect(s.popups.at(-1)).toEqual({ text: 'Car is here', lines: [], tone: 'info' });
    s.vehicles.result = 'noSpot';
    expect(s.loop.summon('car')).toBe('noSpot');
    expect(s.popups.at(-1)).toEqual({ text: 'No road nearby', lines: [], tone: 'warn' });
    s.vehicles.result = 'cooldown';
    s.vehicles.readyIn = 41.2;
    s.loop.summon('car');
    expect(s.popups.at(-1)).toEqual({ text: 'Summon cooling down', lines: ['Ready in 42 s'], tone: 'warn' });
    s.vehicles.result = 'tooClose';
    s.loop.summon('car');
    expect(s.popups.at(-1)!.text).toBe('Already nearby');
    // The Garage app's rows ride on the HUD model.
    expect(s.loop.model(12).garage.map((r) => r.tier)).toEqual(['car']);
  });

  it('Settings Respawn: orders kept, a carried Fragile lost, the phone closed', () => {
    const s = setup('car');
    const offer = s.waitForOffer((o) => o.order.modifier === 'fragile');
    s.loop.accept(offer.order.id);
    s.goTo(offer.order.pickupPoiId);
    expect(s.loop.carriedCount()).toBe(1);
    s.loop.openPhone('settings');
    s.phone.cb!.respawn();
    expect(s.vehicles.calls).toEqual(['respawn']);
    expect(s.loop.orders.active.map((a) => a.order.id)).toEqual([offer.order.id]);
    expect(s.loop.orders.active[0]!.fragileIntact).toBe(false);
    expect(s.popups.filter((p) => p.text === 'Fragile package damaged')).toHaveLength(1);
    expect(s.popups.at(-1)!.text).toBe(`Respawned at ${map.hospitals[0]!.name}`);
    expect(s.phone.isOpen).toBe(false);
  });

  it('Tab at 8 m/s on the car does not open the phone and shows the hint; at rest it opens and the car holds still', () => {
    const s = setup('car');
    s.rider.riding = 'car';
    s.rider.speed = 8;
    s.tick(false, true);
    expect(s.loop.phoneOpen).toBe(false);
    expect(s.popups.at(-1)).toMatchObject({ text: 'Stop to use the phone' });
    // M is refused too, and the hint waits out its cooldown.
    s.tick(false, false, true);
    expect(s.loop.phoneOpen).toBe(false);
    expect(s.popups.filter((p) => p.text === 'Stop to use the phone')).toHaveLength(1);
    s.wait(clientConfig.ui.hintCooldownSeconds);
    s.tick(false, true);
    expect(s.popups.filter((p) => p.text === 'Stop to use the phone')).toHaveLength(2);
    // Stopped (at or under stoppedSpeed): Tab opens it, and the sim gets an idle input with the handbrake held.
    s.rider.speed = ridingConfig.riding.stoppedSpeed;
    s.tick(false, true);
    expect(s.loop.phoneOpen).toBe(true);
    s.tick(false, false, false, { move: { x: 0, y: 1 } });
    const f = s.simFrames.at(-1)!;
    expect(f.move).toEqual({ x: 0, y: 0 });
    expect(f.jump).toEqual({ held: true, pressed: false });
    expect(f.mount.pressed).toBe(false);
    // On foot the phone's idle input holds nothing.
    s.loop.closePhone();
    s.rider.riding = null;
    s.rider.speed = 6;
    s.tick(false, true);
    expect(s.loop.phoneOpen).toBe(true);
    expect(s.simFrames.at(-1)!.jump.held).toBe(false);
  });

  it('Y accepts the top offer while riding at speed', () => {
    const s = setup('car');
    s.rider.riding = 'car';
    s.rider.speed = 20;
    s.waitForOffer();
    const first = s.loop.orders.offers[0]!.order.id;
    s.tick(true);
    expect(s.loop.phoneOpen).toBe(false);
    expect(s.loop.orders.active.map((a) => a.order.id)).toEqual([first]);
  });

  it('holding E at a pump on the car charges coins and fills the tank; on foot nothing happens', () => {
    const s = setup('car', { totals: { points: 0, coins: 100, deliveries: 0 }, garage: [], lastRide: null });
    const pump = map.gasStations[0]!.pumps[0]!;
    s.env.position = { ...pump };
    const hold = (ticks: number): void => {
      for (let i = 0; i < ticks; i++) s.tick(false, false, false, { interact: { held: true, pressed: i === 0 } });
    };
    // On foot: nothing.
    hold(5);
    expect(s.popups).toHaveLength(0);
    expect(s.loop.orders.totals.coins).toBe(100);
    // On the car, stopped at the pump with half a tank: 0.25 tank/s on the 30 Hz step, 80 Coins a full tank.
    s.rider.riding = 'car';
    s.states.car.fuel = 0.5;
    const ticks = Math.ceil(0.5 / (ridingConfig.refuel.tankPerSecond / 30)) + 2;
    hold(ticks);
    expect(s.states.car.fuel).toBe(1);
    expect(s.loop.orders.totals.coins).toBe(60);
    expect(s.stored().totals.coins).toBe(60);
    expect(s.popups.filter((p) => p.text.startsWith('Refuelled'))).toEqual([{ text: 'Refuelled · −40 coins', lines: [], tone: 'info' }]);
  });

  it('a refuel cut short by getting off is still charged; E at a pump on a ride with no tank says so', () => {
    const s = setup('car', { totals: { points: 0, coins: 100, deliveries: 0 }, garage: [], lastRide: null });
    s.env.position = { ...map.gasStations[0]!.pumps[0]! };
    s.rider.riding = 'car';
    s.states.car.fuel = 0.5;
    for (let i = 0; i < 30; i++) s.tick(false, false, false, { interact: { held: true, pressed: i === 0 } });
    expect(s.states.car.fuel).toBeCloseTo(0.75);
    s.rider.riding = null; // dismounted with E still held
    s.tick(false, false, false, { interact: { held: true, pressed: false } });
    expect(s.loop.orders.totals.coins).toBe(80);
    expect(s.popups.at(-1)!.text).toBe('Refuelled · −20 coins');
    // The bicycle has no tank.
    s.rider.riding = 'bicycle';
    s.tick(false, false, false, { interact: { held: true, pressed: true } });
    expect(s.popups.at(-1)!.text).toBe('This one runs on legs');
    expect(s.loop.orders.totals.coins).toBe(80);
  });

  it('refuelRefused shows "No Coins for fuel" once; a fill cut short shows "Out of Coins · tank 57 %"', () => {
    const s = setup('car', { totals: { points: 0, coins: 0, deliveries: 0 }, garage: [], lastRide: null });
    s.env.position = { ...map.gasStations[0]!.pumps[0]! };
    s.rider.riding = 'car';
    s.states.car.fuel = 0.2;
    for (let i = 0; i < 10; i++) s.tick(false, false, false, { interact: { held: true, pressed: i === 0 } });
    expect(s.popups.filter((p) => p.text === 'No Coins for fuel')).toEqual([{ text: 'No Coins for fuel', lines: [], tone: 'warn' }]);
    const t = setup('car', { totals: { points: 0, coins: 30, deliveries: 0 }, garage: [], lastRide: null });
    t.env.position = { ...map.gasStations[0]!.pumps[0]! };
    t.rider.riding = 'car';
    t.states.car.fuel = 0.195;
    for (let i = 0; i < 60; i++) t.tick(false, false, false, { interact: { held: true, pressed: i === 0 } });
    expect(t.popups.map((p) => p.text)).toContain('Out of Coins · tank 57 %');
    expect(t.popups.map((p) => p.text)).not.toContain('No Coins for fuel');
    expect(t.loop.orders.totals.coins).toBe(0);
  });

  it('the prompt follows the rider: ride candidate, get off, refuel at a pump, nothing with the phone open', () => {
    const s = setup('car', { totals: { points: 0, coins: 10, deliveries: 0 }, garage: [], lastRide: null });
    s.rider.candidate = 'car';
    expect(s.loop.prompt()).toBe('F · Ride the car');
    s.rider.candidate = null;
    s.rider.riding = 'car';
    expect(s.loop.prompt()).toBe('F · Get off');
    s.env.position = { ...map.gasStations[0]!.pumps[0]! };
    expect(s.loop.prompt()).toBe('F · Get off'); // a full tank: nothing to refuel
    s.states.car.fuel = 0.5;
    expect(s.loop.prompt()).toBe('Hold E · Refuel');
    s.rider.speed = 9;
    expect(s.loop.prompt()).toBe('F · Get off'); // moving: no refuel, but F gets off at any speed (Decision 9)
    s.rider.speed = 0;
    s.rider.riding = null;
    expect(s.loop.prompt()).toBe('Get on to refuel');
    s.loop.openPhone();
    expect(s.loop.prompt()).toBeNull();
  });

  it('saves the garage and the last ride on mount, dismount and a successful summon, not on a refused one', () => {
    const s = setup('car', { totals: { points: 0, coins: 0, deliveries: 0 }, garage: [], lastRide: null });
    expect(s.stored().garage).toEqual([]);
    s.rider.riding = 'car';
    s.tick();
    expect(s.stored().garage).toEqual([{ tier: 'car', spot: { kind: 'parked', position: { x: 1, y: 0, z: 2 }, heading: 0.5 }, fuel: 1 }]);
    expect(s.stored().lastRide).toBe('car');
    s.rider.lastRide = 'bicycle';
    s.rider.riding = null; // dismounted
    s.tick();
    expect(s.stored().lastRide).toBe('bicycle');
    s.states.car.fuel = 0.3;
    s.vehicles.result = 'cooldown';
    s.loop.summon('car');
    expect(s.stored().garage[0]!.fuel).toBe(1);
    s.vehicles.result = 'ok';
    s.loop.summon('car');
    expect(s.stored().garage[0]!.fuel).toBe(0.3);
  });

  it('resetProgress mid-refuel ends the session: no later charge or popup', () => {
    const s = setup('car', { totals: { points: 0, coins: 100, deliveries: 0 }, garage: [], lastRide: null });
    s.env.position = { ...map.gasStations[0]!.pumps[0]! };
    s.rider.riding = 'car';
    s.states.car.fuel = 0.5;
    const hold = (): void => s.tick(false, false, false, { interact: { held: true, pressed: false } });
    for (let i = 0; i < 20; i++) hold();
    expect(s.states.car.fuel).toBeGreaterThan(0.5);
    s.loop.resetProgress();
    s.states.car.fuel = 1; // the dev panel refills every tank
    s.loop.orders.spendCoins(0);
    hold();
    s.tick(); // E released
    expect(s.popups.filter((p) => p.text.startsWith('Refuelled'))).toEqual([]);
    expect(s.loop.orders.totals.coins).toBe(0);
  });
});

describe('simEventHint (final review 3)', () => {
  it('maps sim events to hints: get-off refusals, tow, empty tank, access per zone kind for the ridden tier', () => {
    expect(simEventHint({ kind: 'mountRefused', reason: 'noRoom' }, 'car', map)).toBe('No room to get off');
    expect(simEventHint({ kind: 'mountRefused', reason: 'airborne' }, 'skateboard', map)).toBe('Land first');
    expect(simEventHint({ kind: 'towed', tier: 'car', hospitalId: 'harbor-hospital' }, null, map)).toBe('Car towed to Harbor Clinic bay');
    expect(simEventHint({ kind: 'fuelEmpty', tier: 'motorbike' }, 'motorbike', map)).toBe('Out of fuel');
    expect(simEventHint({ kind: 'accessBlocked', zone: 'alley' }, 'car', map)).toBe("Cars can't go down alleys");
    expect(simEventHint({ kind: 'accessBlocked', zone: 'steepLane' }, 'car', map)).toBe("Cars can't climb steep lanes");
    expect(simEventHint({ kind: 'accessBlocked', zone: 'stairs' }, 'bicycle', map)).toBe("Bicycles can't take stairs");
    expect(simEventHint({ kind: 'accessBlocked', zone: 'path' }, 'motorbike', map)).toBe("Motorbikes can't use paths");
    expect(simEventHint({ kind: 'jumped' }, null, map)).toBeNull();
    expect(simEventHint({ kind: 'mounted', tier: 'car' }, 'car', map)).toBeNull();
  });

  test('no refusal copy says "Slow down"', () => {
    // Decision 9: F gets off at any speed; only no room or the air refuse it.
    expect(Object.keys(MOUNT_REFUSED).sort()).toEqual(['airborne', 'noRoom']);
    for (const copy of Object.values(MOUNT_REFUSED)) expect(copy).not.toMatch(/slow down/i);
  });

  it('afterStep shows each hint once per hintCooldownSeconds', () => {
    const s = setup('car');
    s.rider.riding = 'car';
    const ev: SimEvent[] = [{ kind: 'accessBlocked', zone: 'alley' }, { kind: 'mountRefused', reason: 'noRoom' }];
    s.tick(false, false, false, { events: ev });
    s.tick(false, false, false, { events: ev });
    expect(s.popups.filter((p) => p.text === "Cars can't go down alleys")).toHaveLength(1);
    expect(s.popups.filter((p) => p.text === 'No room to get off')).toHaveLength(1);
    s.wait(clientConfig.ui.hintCooldownSeconds);
    s.tick(false, false, false, { events: ev });
    expect(s.popups.filter((p) => p.text === "Cars can't go down alleys")).toHaveLength(2);
    s.tick(false, false, false, { events: [{ kind: 'fuelEmpty', tier: 'car' }] });
    expect(s.popups.at(-1)).toMatchObject({ text: 'Out of fuel', tone: 'info' });
  });
});
