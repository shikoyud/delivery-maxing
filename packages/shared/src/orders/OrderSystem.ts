import { dispatcherTuning, type DispatcherTuning } from '../economy/dispatcher';
import type { OrdersConfig, VehicleTier } from '../config/types';
import type { Vec3 } from '../math/vec3';
import { NO_MODS, type SimEvent, type StatModifiers } from '../movement/types';
import type { Rng } from '../util/rng';
import type { PathDistance } from '../world/distance';
import type { OrderRules, Poi } from '../world/mapTypes';
import type { PlayerZones } from '../world/zones';
import type { DistanceTable } from './distanceTable';
import { generateOffer } from './offers';
import { maxPointsFor, scoreOrder } from './rules';
import type { ActiveOrder, Bonus, CarrierCapacity, Offer } from './types';

/** What broke a carried Fragile package: a fall, a respawn, or a crash into a wall on a vehicle. */
export type FragileBreak = 'fall' | 'respawn' | 'crash';

export type AcceptResult = 'ok' | 'gone' | 'expired' | 'no_slots' | 'too_heavy';
export type CancelResult = 'ok' | 'unknown';

export type OrderEvent =
  | { kind: 'offered'; offerId: string }
  | { kind: 'offerExpired'; offerId: string }
  | { kind: 'prepStarted'; orderId: string; readySeconds: number }
  | { kind: 'pickedUp'; orderId: string }
  | { kind: 'fragileBroken'; orderId: string; reason: FragileBreak }
  | {
      kind: 'completed';
      orderId: string;
      points: number;
      coins: number;
      bonuses: Bonus[];
      inTime: boolean;
      expressOnTime: boolean | null;
      /** The most points the order could have earned (the payout roll's quality is points ÷ maxPoints, spec §3.6). */
      maxPoints: number;
      /** The order's vehicle tier, fixed when it was accepted. */
      tier: VehicleTier;
    }
  | { kind: 'pickupMissed'; orderId: string; lockoutSeconds: number }
  | { kind: 'lockoutEnded' };

export type CompletedEvent = Extract<OrderEvent, { kind: 'completed' }>;

export interface Totals {
  points: number;
  coins: number;
  deliveries: number;
}

export interface OrderSystemOptions {
  pois: Poi[];
  distance: PathDistance;
  /** Build-time pickup→dropoff distances (the city); offers fall back to `distance` without it. */
  table?: DistanceTable;
  rules: OrderRules;
  cfg: OrdersConfig;
  rng: Rng;
  capacity: CarrierCapacity;
  totals?: Totals;
  /** The owned Dispatcher tier's tuning, read each tick (Game: the chain's tier); absent: tier 0. */
  dispatcher?: () => DispatcherTuning;
  /** The capacity tier (the ride, else the last ride), read on accept: the order's vehicle tier. Absent: walk. */
  vehicleTier?: () => VehicleTier;
}

/** Per-player order state: offers on the phone, accepted orders, lockout and totals (spec §3.2–§3.5). */
export class OrderSystem {
  private readonly opts: OrderSystemOptions;
  private readonly poiById: Map<string, Poi>;
  private readonly _offers: Offer[] = [];
  private readonly _active: ActiveOrder[] = [];
  /** Pickup and dropoff door ids of accepted orders, with the accept time (reuse rule). */
  private used: { ids: [string, string]; at: number }[] = [];
  private idCounter = 0;
  private lockoutActive = false;

  totals: Totals;
  capacity: CarrierCapacity;
  lockoutUntil = 0;
  /** Why offers are locked: a cancel or a missed pickup deadline. Null when no lockout is running. */
  lockoutReason: 'cancelled' | 'missedPickup' | null = null;
  nextOfferAt: number;

  constructor(opts: OrderSystemOptions, now: number) {
    this.opts = opts;
    this.poiById = new Map(opts.pois.map((p) => [p.id, p]));
    this.capacity = opts.capacity;
    this.totals = opts.totals ? { ...opts.totals } : { points: 0, coins: 0, deliveries: 0 };
    this.nextOfferAt = now + this.interval();
  }

  get offers(): ReadonlyArray<Offer> {
    return this._offers;
  }

  get active(): ReadonlyArray<ActiveOrder> {
    return this._active;
  }

  private tuning(): DispatcherTuning {
    return this.opts.dispatcher ? this.opts.dispatcher() : dispatcherTuning(0);
  }

  private interval(): number {
    const { minIntervalSeconds: lo, maxIntervalSeconds: hi } = this.opts.cfg.offers;
    return (lo + this.opts.rng() * (hi - lo)) * this.tuning().intervalScale;
  }

  canSwitchCapacity(c: CarrierCapacity): boolean {
    return this.usedSlots() <= c.slots && this.carriedKg() <= c.maxPackageKg;
  }

  /** Switch carrier capacity; ignored when the active orders would not fit (orders are never dropped). */
  setCapacity(c: CarrierCapacity): void {
    if (this.canSwitchCapacity(c)) this.capacity = c;
  }

  usedSlots(): number {
    return this._active.length;
  }

  freeSlots(): number {
    return Math.max(0, this.capacity.slots - this.usedSlots());
  }

  /** Package kg of every active order, picked up or not (reserved on accept). */
  carriedKg(): number {
    return this._active.reduce((kg, a) => kg + (a.order.weightKg ?? 0), 0);
  }

  canAccept(offerId: string, now: number): AcceptResult {
    const offer = this._offers.find((o) => o.order.id === offerId);
    if (!offer) return 'gone';
    if (now >= offer.expiresAt) return 'expired';
    if (this.freeSlots() <= 0) return 'no_slots';
    const kg = offer.order.weightKg ?? 0;
    if (kg > 0 && kg > this.capacity.maxPackageKg - this.carriedKg()) return 'too_heavy';
    return 'ok';
  }

  accept(offerId: string, now: number): AcceptResult {
    const result = this.canAccept(offerId, now);
    if (result !== 'ok' && result !== 'expired') return result;
    const i = this._offers.findIndex((o) => o.order.id === offerId);
    const [offer] = this._offers.splice(i, 1) as [Offer];
    if (result === 'expired') return result;
    this._active.push({
      order: offer.order,
      acceptedAt: now,
      pickupBy: now + this.opts.cfg.pickupDeadline.seconds,
      prepStartedAt: null,
      pickedUpAt: null,
      fragileIntact: true,
      tier: this.opts.vehicleTier?.() ?? 'walk',
    });
    this.used.push({ ids: [offer.order.pickupPoiId, offer.order.dropoffPoiId], at: now });
    return 'ok';
  }

  /** Cancel an accepted order (picked up or not): it disappears without reward and starts the offer lockout. */
  cancel(orderId: string, now: number): CancelResult {
    const i = this._active.findIndex((a) => a.order.id === orderId);
    if (i < 0) return 'unknown';
    this._active.splice(i, 1);
    this.startLockout(now, this.opts.cfg.lockout.seconds, 'cancelled');
    return 'ok';
  }

  /** Only ever extends: a longer lockout still running is never cut short by a shorter one. */
  private startLockout(now: number, seconds: number, reason: 'cancelled' | 'missedPickup'): void {
    const until = now + seconds;
    if (until >= this.lockoutUntil) this.lockoutReason = reason;
    this.lockoutUntil = Math.max(this.lockoutUntil, until);
    this.lockoutActive = true;
  }

  /** Pays `n` Coins (fuel); false and no change when the player holds fewer. */
  spendCoins(n: number): boolean {
    if (n > this.totals.coins) return false;
    this.totals = { ...this.totals, coins: this.totals.coins - n };
    return true;
  }

  /** The confirmed lockout skip (and the dev panel): ends the lockout now. */
  skipLockout(): void {
    this.lockoutUntil = 0;
    this.lockoutReason = null; // over now; the next update still reports lockoutEnded
  }

  isCarried(a: ActiveOrder): boolean {
    return a.pickedUpAt !== null;
  }

  /** When a food order's prep finishes (pickup possible from then on), or null before the courier first arrived. */
  prepReadyAt(a: ActiveOrder): number | null {
    return a.prepStartedAt === null ? null : a.prepStartedAt + this.opts.cfg.prep.foodSeconds;
  }

  currentTarget(a: ActiveOrder): string {
    return this.isCarried(a) ? a.order.dropoffPoiId : a.order.pickupPoiId;
  }

  statModifiers(): StatModifiers {
    const bulky = this._active.some((a) => this.isCarried(a) && a.order.weightClass === 'bulky');
    return bulky ? { ...NO_MODS, canSprint: false } : NO_MODS;
  }

  update(now: number, player: Vec3, zones: PlayerZones): OrderEvent[] {
    const events: OrderEvent[] = [];
    const { cfg } = this.opts;

    for (let i = this._offers.length - 1; i >= 0; i--) {
      const offer = this._offers[i] as Offer;
      if (now >= offer.expiresAt) {
        this._offers.splice(i, 1);
        events.push({ kind: 'offerExpired', offerId: offer.order.id });
      }
    }

    // An order not reached by its pickup deadline fails like a cancel; the lockout it starts blocks this tick's roll.
    // Standing at the pickup on the deadline tick counts as reaching it (the arrival is handled below).
    for (let i = this._active.length - 1; i >= 0; i--) {
      const a = this._active[i] as ActiveOrder;
      if (now < a.pickupBy || a.prepStartedAt !== null || a.pickedUpAt !== null || zones.poiIds.has(a.order.pickupPoiId)) continue;
      this._active.splice(i, 1);
      const lockoutSeconds = cfg.pickupDeadline.lockoutSeconds;
      this.startLockout(now, lockoutSeconds, 'missedPickup');
      events.push({ kind: 'pickupMissed', orderId: a.order.id, lockoutSeconds });
    }

    if (this.lockoutActive && now >= this.lockoutUntil) {
      this.lockoutActive = false;
      this.lockoutReason = null;
      events.push({ kind: 'lockoutEnded' });
    }

    if (now >= this.nextOfferAt && this._offers.length < this.tuning().maxShown && this.freeSlots() > 0 && now >= this.lockoutUntil) {
      const order = generateOffer({
        pois: this.opts.pois,
        distance: this.opts.distance,
        table: this.opts.table,
        rules: this.opts.rules,
        cfg,
        rng: this.opts.rng,
        player,
        capacity: this.capacity,
        carriedKg: this.carriedKg(),
        freeSlots: this.freeSlots(),
        blockedDoors: this.blockedDoors(),
        recentlyUsed: this.recentlyUsed(now),
        nextId: () => `o${++this.idCounter}`,
        dispatcher: this.tuning(),
      });
      if (order) {
        this._offers.push({ order, offeredAt: now, expiresAt: now + cfg.offers.lifetimeSeconds });
        events.push({ kind: 'offered', offerId: order.id });
      }
      this.nextOfferAt = now + this.interval();
    }

    for (let i = 0; i < this._active.length; i++) {
      const a = this._active[i] as ActiveOrder;
      if (a.pickedUpAt === null) {
        if (!zones.poiIds.has(a.order.pickupPoiId)) continue;
        // Food waits for the kitchen: the first arrival starts the prep timer, and the pickup needs the courier at
        // the counter once it is ready (prep keeps running while they are away). foodSeconds <= 0 disables prep.
        if (a.order.kind === 'food' && cfg.prep.foodSeconds > 0) {
          if (a.prepStartedAt === null) {
            a.prepStartedAt = now;
            events.push({ kind: 'prepStarted', orderId: a.order.id, readySeconds: cfg.prep.foodSeconds });
            continue;
          }
          if (now < a.prepStartedAt + cfg.prep.foodSeconds) continue;
        }
        a.pickedUpAt = now;
        events.push({ kind: 'pickedUp', orderId: a.order.id });
        continue;
      }
      if (!zones.poiIds.has(a.order.dropoffPoiId)) continue;
      const elapsed = now - a.pickedUpAt;
      const inTime = elapsed <= a.order.timeLimit;
      const expressOnTime = a.order.modifier === 'express' && a.order.expressLimit !== null ? elapsed <= a.order.expressLimit : null;
      const score = scoreOrder(a.order, { inTime, expressOnTime: expressOnTime ?? false, intact: a.fragileIntact }, cfg);
      this.totals = {
        points: this.totals.points + score.points,
        coins: this.totals.coins + score.coins,
        deliveries: this.totals.deliveries + 1,
      };
      this._active.splice(i--, 1);
      events.push({ kind: 'completed', orderId: a.order.id, ...score, inTime, expressOnTime, maxPoints: maxPointsFor(a.order, cfg), tier: a.tier });
      // Pacing after a delivery (server-side only, no UI): the next offer waits at least the cooldown.
      const { minSeconds, maxSeconds } = cfg.deliveryCooldown;
      this.nextOfferAt = Math.max(this.nextOfferAt, now + minSeconds + this.opts.rng() * (maxSeconds - minSeconds));
    }
    return events;
  }

  /**
   * Fragile damage from the movement sim, carried orders only: a fall above maxFallMeters, a respawn, or a vehicle
   * crash (the sim reports `crashed` only above fragile.crashSpeed).
   */
  onSimEvents(simEvents: SimEvent[]): OrderEvent[] {
    const events: OrderEvent[] = [];
    for (const e of simEvents) {
      let reason: FragileBreak | null = null;
      if (e.kind === 'landed' && e.fallHeight > this.opts.cfg.fragile.maxFallMeters) reason = 'fall';
      else if (e.kind === 'respawned') reason = 'respawn';
      else if (e.kind === 'crashed') reason = 'crash';
      if (!reason) continue;
      for (const a of this._active) {
        if (a.order.modifier === 'fragile' && a.fragileIntact && this.isCarried(a)) {
          a.fragileIntact = false;
          events.push({ kind: 'fragileBroken', orderId: a.order.id, reason });
        }
      }
    }
    return events;
  }

  private blockedDoors(): Vec3[] {
    const doors: Vec3[] = [];
    for (const order of [...this._offers.map((o) => o.order), ...this._active.map((a) => a.order)]) {
      for (const id of [order.pickupPoiId, order.dropoffPoiId]) {
        const poi = this.poiById.get(id);
        if (poi) doors.push(poi.position);
      }
    }
    return doors;
  }

  private recentlyUsed(now: number): Set<string> {
    const window = this.opts.cfg.spacing.reuseSeconds;
    this.used = this.used.filter((u) => now - u.at < window);
    const ids = new Set<string>();
    for (const u of this.used) for (const id of u.ids) ids.add(id);
    return ids;
  }
}
