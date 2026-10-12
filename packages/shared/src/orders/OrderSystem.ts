import type { OrdersConfig } from '../config/types';
import type { Vec3 } from '../math/vec3';
import { NO_MODS, type SimEvent, type StatModifiers } from '../movement/types';
import type { Rng } from '../util/rng';
import type { PathDistance, PoiInfo } from '../world/distance';
import type { PlayerZones } from '../world/zones';
import { generateBoard } from './board';
import { scoreOrder } from './rules';
import type { Bonus, Order, Step, Unlocks } from './types';

export interface ActiveOrder { order: Order; acceptedAt: number; stepIndex: number; fragileIntact: boolean }
export type AcceptResult = 'ok' | 'not_in_hub' | 'no_slots' | 'cooldown' | 'gone';
export type CancelResult = 'ok' | 'not_in_hub' | 'unknown';
export type OrderEvent =
  | { kind: 'boardRefreshed' }
  | { kind: 'stepReached'; orderId: string; stepIndex: number; step: Step }
  | { kind: 'fragileBroken'; orderId: string; reason: 'fall' | 'respawn' }
  | { kind: 'completed'; orderId: string; points: number; coins: number; bonuses: Bonus[]; onTime: boolean | null };
export interface Totals { points: number; coins: number; deliveries: number }

export interface OrderSystemOptions {
  pois: PoiInfo[];
  distance: PathDistance;
  hub: Vec3;
  cfg: OrdersConfig;
  baseSprintSpeed: number;
  rng: Rng;
  unlocks: Unlocks;
  backpackCapacity: number;
  totals?: Totals;
}

export class OrderSystem {
  board: ReadonlyArray<Order | null>;
  active: ReadonlyArray<ActiveOrder> = [];
  totals: Totals;
  nextRefreshAt: number;
  cancelCooldownUntil = 0;
  backpackCapacity: number;

  private readonly opts: OrderSystemOptions;
  private idCounter = 0;

  constructor(opts: OrderSystemOptions, now: number) {
    this.opts = opts;
    this.backpackCapacity = opts.backpackCapacity;
    this.totals = opts.totals ? { ...opts.totals } : { points: 0, coins: 0, deliveries: 0 };
    this.board = this.generate();
    this.nextRefreshAt = now + opts.cfg.board.refreshSeconds;
  }

  setBackpackCapacity(n: number): void {
    this.backpackCapacity = n;
  }

  usedSlots(): number {
    return this.active.reduce((sum, a) => sum + a.order.slots, 0);
  }

  freeSlots(): number {
    return this.backpackCapacity - this.usedSlots();
  }

  /** Precedence: gone, not_in_hub, cooldown, no_slots. */
  canAccept(orderId: string, now: number, inPlaza: boolean): AcceptResult {
    const order = this.board.find((o) => o !== null && o.id === orderId);
    if (!order) return 'gone';
    if (!inPlaza) return 'not_in_hub';
    if (now < this.cancelCooldownUntil) return 'cooldown';
    if (order.slots > this.freeSlots()) return 'no_slots';
    return 'ok';
  }

  accept(orderId: string, now: number, inPlaza: boolean): AcceptResult {
    const result = this.canAccept(orderId, now, inPlaza);
    if (result !== 'ok') return result;
    const idx = this.board.findIndex((o) => o !== null && o.id === orderId);
    const order = this.board[idx] as Order;
    this.board = this.board.map((o, i) => (i === idx ? null : o));
    this.active = [...this.active, { order, acceptedAt: now, stepIndex: 0, fragileIntact: true }];
    return 'ok';
  }

  cancel(orderId: string, now: number, inPlaza: boolean): CancelResult {
    if (!inPlaza) return 'not_in_hub';
    if (!this.active.some((a) => a.order.id === orderId)) return 'unknown';
    this.active = this.active.filter((a) => a.order.id !== orderId);
    this.cancelCooldownUntil = now + this.opts.cfg.board.cancelCooldownSeconds;
    return 'ok';
  }

  update(now: number, zones: PlayerZones): OrderEvent[] {
    const events: OrderEvent[] = [];
    if (now >= this.nextRefreshAt) {
      this.board = this.generate();
      const period = this.opts.cfg.board.refreshSeconds;
      while (this.nextRefreshAt <= now) this.nextRefreshAt += period;
      events.push({ kind: 'boardRefreshed' });
    }

    const remaining: ActiveOrder[] = [];
    for (const a of this.active) {
      const step = this.currentStep(a);
      const reached = step.kind === 'hub' ? zones.inDropZone : zones.poiIds.has(step.poiId);
      if (!reached) {
        remaining.push(a);
        continue;
      }
      const stepIndex = a.stepIndex + 1;
      if (stepIndex < a.order.steps.length) {
        remaining.push({ ...a, stepIndex });
        events.push({ kind: 'stepReached', orderId: a.order.id, stepIndex, step: a.order.steps[stepIndex] as Step });
        continue;
      }
      const onTime =
        a.order.modifier === 'express' && a.order.expressLimit !== null ? now - a.acceptedAt <= a.order.expressLimit : null;
      const { points, coins, bonuses } = scoreOrder(
        a.order,
        { onTime: onTime ?? false, intact: a.fragileIntact },
        this.opts.cfg,
      );
      this.totals = {
        points: this.totals.points + points,
        coins: this.totals.coins + coins,
        deliveries: this.totals.deliveries + 1,
      };
      events.push({ kind: 'completed', orderId: a.order.id, points, coins, bonuses, onTime });
    }
    this.active = remaining;
    return events;
  }

  onSimEvents(simEvents: SimEvent[]): OrderEvent[] {
    const events: OrderEvent[] = [];
    for (const e of simEvents) {
      let reason: 'fall' | 'respawn' | null = null;
      if (e.kind === 'landed' && e.fallHeight > this.opts.cfg.fragile.maxFallMeters) reason = 'fall';
      else if (e.kind === 'respawned') reason = 'respawn';
      if (!reason) continue;
      this.active = this.active.map((a) => {
        if (a.order.modifier !== 'fragile' || !a.fragileIntact || !this.isCarried(a)) return a;
        events.push({ kind: 'fragileBroken', orderId: a.order.id, reason: reason as 'fall' | 'respawn' });
        return { ...a, fragileIntact: false };
      });
    }
    return events;
  }

  isCarried(a: ActiveOrder): boolean {
    return a.order.type === 'dropoff' ? true : a.stepIndex >= 1;
  }

  currentStep(a: ActiveOrder): Step {
    return a.order.steps[a.stepIndex] as Step;
  }

  statModifiers(): StatModifiers {
    const heavy = this.active.some((a) => a.order.modifier === 'heavy' && this.isCarried(a));
    return heavy ? { ...NO_MODS, jumpHeightMul: this.opts.cfg.heavy.jumpHeightMultiplier } : NO_MODS;
  }

  private generate(): Order[] {
    return generateBoard({
      pois: this.opts.pois,
      distance: this.opts.distance,
      hub: this.opts.hub,
      rng: this.opts.rng,
      cfg: this.opts.cfg,
      baseSprintSpeed: this.opts.baseSprintSpeed,
      unlocks: this.opts.unlocks,
      backpackCapacity: this.backpackCapacity,
      nextId: () => `o${this.idCounter++}`,
    });
  }
}
