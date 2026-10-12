import type { ActiveOrder, MapData, Modifier, Order, OrderSystem, OrderType, Poi, Step, Totals, Vec3 } from '@dm/shared';

export interface HudOrder {
  id: string;
  title: string;
  modifier: Modifier | null;
  stage: string;
  target: Vec3;
  /** Straight-line metres to the current target, rounded. */
  distance: number;
  express: { secondsLeft: number; late: boolean } | null;
  fragileIntact: boolean | null;
}

export interface HudModel {
  totals: Totals;
  slots: { used: number; capacity: number };
  refreshIn: number;
  cooldownLeft: number;
  orders: HudOrder[];
}

const KIND_LABEL: Record<Poi['kind'], string> = { door: 'Door', mailbox: 'Mailbox', counter: 'Counter', balcony: 'Balcony' };
const DISTRICT_LABEL: Record<Poi['district'], string> = {
  hub: 'HUB',
  downtown: 'Downtown',
  harbor: 'Harbor',
  hillside: 'Hillside',
  suburbs: 'Suburbs',
};
export const TYPE_LABEL: Record<OrderType, string> = { dropoff: 'Drop-off', pickup: 'Pick-up', chain: 'Chain' };
export const MODIFIER_LABEL: Record<Modifier, string> = { express: 'Express', fragile: 'Fragile', heavy: 'Heavy' };

/** "1 pt", "N pts". */
export function pointsText(n: number): string {
  return `${n} ${n === 1 ? 'pt' : 'pts'}`;
}

/** "Mailbox · Harbor". */
export function poiLabel(poi: Poi): string {
  return `${KIND_LABEL[poi.kind]} · ${DISTRICT_LABEL[poi.district]}`;
}

/** Looks up POIs by id, so labels and targets don't scan the whole list (the full city has ~20). */
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
  label(id: string): string {
    return poiLabel(this.get(id));
  }
  target(step: Step): Vec3 {
    return step.kind === 'hub' ? this.map.hub.center : this.get(step.poiId).position;
  }
}

const indexes = new WeakMap<MapData, PoiIndex>();
export function poiIndex(map: MapData): PoiIndex {
  let idx = indexes.get(map);
  if (!idx) indexes.set(map, (idx = new PoiIndex(map)));
  return idx;
}

/**
 * One instruction per step: Drop-off "Deliver to {poi}"; Pick-up "Collect at {poi}", "Return to HUB";
 * Chain "Collect at {A}", "Deliver to {B}", "Return to HUB".
 */
export function stepTexts(order: Order, pois: PoiIndex): string[] {
  return order.steps.map((step, i) => {
    if (step.kind === 'hub') return 'Return to HUB';
    const delivering = order.type === 'dropoff' || (order.type === 'chain' && i > 0);
    return `${delivering ? 'Deliver to' : 'Collect at'} ${pois.label(step.poiId)}`;
  });
}

/** The instruction for an order's current step. */
export function stageText(a: ActiveOrder, pois: PoiIndex): string {
  return stepTexts(a.order, pois)[a.stepIndex] ?? 'Return to HUB';
}

export function hudModel(orders: OrderSystem, map: MapData, player: Vec3, now: number): HudModel {
  const pois = poiIndex(map);
  return {
    totals: { ...orders.totals },
    slots: { used: orders.usedSlots(), capacity: orders.backpackCapacity },
    refreshIn: Math.max(0, orders.nextRefreshAt - now),
    cooldownLeft: Math.max(0, orders.cancelCooldownUntil - now),
    orders: orders.active.map((a) => {
      const target = pois.target(orders.currentStep(a));
      const limit = a.order.modifier === 'express' ? a.order.expressLimit : null;
      const elapsed = now - a.acceptedAt;
      return {
        id: a.order.id,
        title: TYPE_LABEL[a.order.type],
        modifier: a.order.modifier,
        stage: stageText(a, pois),
        target: { ...target },
        distance: Math.round(Math.hypot(player.x - target.x, player.y - target.y, player.z - target.z)),
        express: limit === null ? null : { secondsLeft: Math.max(0, limit - elapsed), late: elapsed > limit },
        fragileIntact: a.order.modifier === 'fragile' ? a.fragileIntact : null,
      };
    }),
  };
}
