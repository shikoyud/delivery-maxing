import type { OrdersConfig } from '../config/types';
import { NO_MODS, type SimEvent, type StatModifiers } from '../movement/types';
import type { Rng } from '../util/rng';
import type { PoiInfo } from '../world/distance';
import type { District } from '../world/mapTypes';
import type { PlayerZones } from '../world/zones';
import { generateBoard } from './board';
import type { DistanceTable } from './distanceTable';
import { scoreOrder } from './rules';
import type { SelectionContext } from './selection';
import type { Bonus, Order, Step, Unlocks } from './types';

export interface ActiveOrder { order: Order; acceptedAt: number; stepIndex: number; fragileIntact: boolean }
export type AcceptResult = 'ok' | 'not_in_hub' | 'no_slots' | 'cooldown' | 'gone';
export type CancelResult = 'ok' | 'not_in_hub' | 'unknown';
export type OrderEvent =
  | { kind: 'boardRefreshed' }
  | { kind: 'stepReached'; orderId: string; stepIndex: number; step: Step }
  | { kind: 'fragileBroken'; orderId: string; reason: 'fall' | 'respawn' }
  | { kind: 'completed'; orderId: string; points: number; coins: number; bonuses: Bonus[]; onTime: boolean | null; withinPar: boolean };
export interface Totals { points: number; coins: number; deliveries: number }

export interface OrderSystemOptions {
  /** The board candidates (on the city, only the reachable POIs). Active orders' POIs are looked up here by id. */
  pois: PoiInfo[];
  distances: DistanceTable;
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
  /** POI id → sim time an order with it was last accepted (the reuse rule, spec §5.3). */
  readonly recentUse = new Map<string, number>();
  /** Districts of accepted POIs, most recent first, at most `selection.districtWindow` (district balance). */
  recentDistricts: readonly District[] = [];

  private readonly opts: OrderSystemOptions;
  private readonly poiById: ReadonlyMap<string, PoiInfo>;
  private idCounter = 0;

  constructor(opts: OrderSystemOptions, now: number) {
    this.opts = opts;
    this.poiById = new Map(opts.pois.map((p) => [p.poi.id, p]));
    this.backpackCapacity = opts.backpackCapacity;
    this.totals = opts.totals ? { ...opts.totals } : { points: 0, coins: 0, deliveries: 0 };
    this.board = this.generate(now);
    this.nextRefreshAt = now + opts.cfg.board.refreshSeconds;
  }

  setBackpackCapacity(n: number): void {
    this.backpackCapacity = n;
  }

  /**
   * Regenerates the board now (e.g. after the backpack capacity changed, so Heavy can appear) and restarts the
   * refresh timer. Returns the boardRefreshed event for the caller to announce, like update() does.
   */
  refreshBoard(now: number): OrderEvent[] {
    this.board = this.generate(now);
    this.nextRefreshAt = now + this.opts.cfg.board.refreshSeconds;
    return [{ kind: 'boardRefreshed' }];
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
    this.recordUse(order, now);
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
      this.board = this.generate(now);
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
      const withinPar = now - a.acceptedAt <= a.order.parLimit;
      const { points, coins, bonuses } = scoreOrder(
        a.order,
        { onTime: onTime ?? false, intact: a.fragileIntact, withinPar },
        this.opts.cfg,
      );
      this.totals = {
        points: this.totals.points + points,
        coins: this.totals.coins + coins,
        deliveries: this.totals.deliveries + 1,
      };
      events.push({ kind: 'completed', orderId: a.order.id, points, coins, bonuses, onTime, withinPar });
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

  /** Accepting "uses" each POI of the order (plan assumption 10): it starts the reuse window and enters the history. */
  private recordUse(order: Order, now: number): void {
    const window = this.opts.cfg.selection.districtWindow;
    let districts = this.recentDistricts;
    for (const id of poiIdsOf(order)) {
      this.recentUse.set(id, now);
      const info = this.poiById.get(id);
      if (info) districts = [info.poi.district, ...districts];
    }
    this.recentDistricts = districts.slice(0, window);
  }

  private selection(now: number): SelectionContext {
    // Forget uses past the reuse window, so the map stays small over a long session.
    for (const [id, at] of this.recentUse) if (now - at >= this.opts.cfg.selection.reuseSeconds) this.recentUse.delete(id);
    const activePois = this.active.flatMap((a) =>
      poiIdsOf(a.order).flatMap((id) => {
        const info = this.poiById.get(id);
        return info ? [info.poi.position] : [];
      }),
    );
    return { now, recentUse: this.recentUse, activePois, recentDistricts: this.recentDistricts };
  }

  private generate(now: number): Order[] {
    return generateBoard({
      pois: this.opts.pois,
      distances: this.opts.distances,
      selection: this.selection(now),
      rng: this.opts.rng,
      cfg: this.opts.cfg,
      baseSprintSpeed: this.opts.baseSprintSpeed,
      unlocks: this.opts.unlocks,
      backpackCapacity: this.backpackCapacity,
      nextId: () => `o${this.idCounter++}`,
    });
  }
}

/** Every POI an order visits (each step of a Chain), in step order. */
function poiIdsOf(order: Order): string[] {
  return order.steps.flatMap((s) => (s.kind === 'poi' ? [s.poiId] : []));
}
