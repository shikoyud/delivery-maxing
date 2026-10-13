import {
  ordersConfig,
  orderText,
  scoreOrder,
  type AcceptResult,
  type ActiveOrder,
  type Band,
  type MapData,
  type OrderKind,
  type OrderSystem,
  type Poi,
  type Totals,
  type Vec3,
} from '@dm/shared';

/** A countdown: seconds left (0 once over) and whether the limit has passed. */
export interface HudTimer {
  secondsLeft: number;
  late: boolean;
}

export interface HudOrder {
  id: string;
  kind: OrderKind;
  item: string;
  /** "Pick up {item} from {pickup}" before pickup, "Deliver to {dropoff}" after. */
  stage: string;
  /** Name of the current target (pickup, then dropoff). */
  targetName: string;
  target: Vec3;
  /** Straight-line metres to the current target, rounded. */
  distance: number;
  /** Hot (food) or par (package) time; null before pickup (timers start at pickup, spec §3.2). */
  timer: HudTimer | null;
  /** Express packages only, after pickup. */
  express: HudTimer | null;
  weightKg: number | null;
  /** Fragile packages only. */
  fragileIntact: boolean | null;
}

export interface HudOffer {
  id: string;
  kind: OrderKind;
  pickupText: string;
  dropoffText: string;
  band: Band;
  weightKg: number | null;
  secondsLeft: number;
  /** Best case: the order delivered with every bonus it can earn. */
  reward: { points: number; coins: number };
  /** `OrderSystem.canAccept` at the model's time: the phone disables Accept with the reason when not 'ok'. */
  acceptStatus: AcceptResult;
}

export interface HudLoad {
  usedSlots: number;
  slots: number;
  carriedKg: number;
  maxPackageKg: number;
}

export interface HudModel {
  totals: Totals;
  load: HudLoad;
  /** Seconds of offer lockout left (0 when none). */
  lockoutLeft: number;
  orders: HudOrder[];
  /** In arrival order: the first is the one Y accepts. */
  offers: HudOffer[];
  /** Name of the hospital whose safe zone the player is in, or null. */
  safeZone: string | null;
}

/** "1 pt", "N pts". */
export function pointsText(n: number): string {
  return `${n} ${n === 1 ? 'pt' : 'pts'}`;
}

/** "2/3 · 25/50 kg"; just "1/1" for a carrier that takes no packages. */
export function loadText(l: HudLoad): string {
  const slots = `${l.usedSlots}/${l.slots}`;
  return l.maxPackageKg > 0 ? `${slots} · ${Math.round(l.carriedKg * 10) / 10}/${l.maxPackageKg} kg` : slots;
}

export const BAND_LABEL: Record<Band, string> = { short: 'Short', medium: 'Medium', long: 'Long' };
export const KIND_LABEL: Record<OrderKind, string> = { food: 'Food', package: 'Package' };

/** Looks up POIs by id, so labels and targets don't scan the whole list. */
export class PoiIndex {
  private readonly byId = new Map<string, Poi>();
  constructor(readonly map: MapData) {
    for (const p of map.pois) this.byId.set(p.id, p);
  }
  get(id: string): Poi {
    const p = this.byId.get(id);
    if (!p) throw new Error(`unknown POI ${id}`);
    return p;
  }
  target(id: string): Vec3 {
    return this.get(id).position;
  }
}

const indexes = new WeakMap<MapData, PoiIndex>();
export function poiIndex(map: MapData): PoiIndex {
  let idx = indexes.get(map);
  if (!idx) indexes.set(map, (idx = new PoiIndex(map)));
  return idx;
}

/** The instruction for an order's current stop. */
export function stageText(a: ActiveOrder, pois: PoiIndex): string {
  return a.pickedUpAt === null
    ? `Pick up ${a.order.item} from ${pois.get(a.order.pickupPoiId).name}`
    : `Deliver to ${pois.get(a.order.dropoffPoiId).name}`;
}

function countdown(limit: number, elapsed: number): HudTimer {
  return { secondsLeft: Math.max(0, limit - elapsed), late: elapsed > limit };
}

export function hudModel(orders: OrderSystem, map: MapData, player: Vec3, now: number, safeZone: string | null): HudModel {
  const pois = poiIndex(map);
  return {
    totals: { ...orders.totals },
    load: {
      usedSlots: orders.usedSlots(),
      slots: orders.capacity.slots,
      carriedKg: orders.carriedKg(),
      maxPackageKg: orders.capacity.maxPackageKg,
    },
    lockoutLeft: Math.max(0, orders.lockoutUntil - now),
    orders: orders.active.map((a): HudOrder => {
      const { order } = a;
      const targetPoi = pois.get(orders.currentTarget(a));
      const target = targetPoi.position;
      const elapsed = a.pickedUpAt === null ? null : now - a.pickedUpAt;
      return {
        id: order.id,
        kind: order.kind,
        item: order.item,
        stage: stageText(a, pois),
        targetName: targetPoi.name,
        target: { ...target },
        distance: Math.round(Math.hypot(player.x - target.x, player.y - target.y, player.z - target.z)),
        timer: elapsed === null ? null : countdown(order.timeLimit, elapsed),
        express: elapsed === null || order.modifier !== 'express' || order.expressLimit === null ? null : countdown(order.expressLimit, elapsed),
        weightKg: order.weightKg,
        fragileIntact: order.modifier === 'fragile' ? a.fragileIntact : null,
      };
    }),
    offers: orders.offers.map(({ order, expiresAt }): HudOffer => {
      const text = orderText(order, pois.get(order.pickupPoiId), pois.get(order.dropoffPoiId));
      const best = scoreOrder(order, { inTime: true, expressOnTime: true, intact: true }, ordersConfig);
      return {
        id: order.id,
        kind: order.kind,
        pickupText: text.pickup,
        dropoffText: text.dropoff,
        band: order.band,
        weightKg: order.weightKg,
        secondsLeft: Math.max(0, expiresAt - now),
        reward: { points: best.points, coins: best.coins },
        acceptStatus: orders.canAccept(order.id, now),
      };
    }),
    safeZone,
  };
}
