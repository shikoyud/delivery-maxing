import type { OrdersConfig } from '../config/types';
import { pickWeighted, type Rng } from '../util/rng';
import type { PoiInfo } from '../world/distance';
import type { DistanceTable } from './distanceTable';
import { expressLimit, orderSteps, parLimit, slotsFor } from './rules';
import { districtWeight, eligiblePois, horizontalDistance, type SelectionContext } from './selection';
import type { Modifier, Order, OrderType, Unlocks } from './types';

export interface BoardContext {
  pois: PoiInfo[];
  /** Path metres for the routes: navmesh-measured on the city, street distance on the greybox. */
  distances: DistanceTable;
  /** The player's recent use, recent districts and active orders' POIs, for the spec §5.3 rules. */
  selection: SelectionContext;
  rng: Rng;
  cfg: OrdersConfig;
  baseSprintSpeed: number;
  unlocks: Unlocks;
  backpackCapacity: number;
  nextId: () => string;
}

/**
 * Up to `cfg.board.size` orders. The POIs come from those the selection rules allow (reuse, spread from active
 * orders); each pick is weighted by district balance and removes every POI within the spread of it from the pool,
 * so no two board POIs are closer than `spreadMeters`. When the rules leave too few POIs the board is shorter (never
 * an error, never a retry loop): a Chain whose second POI is missing becomes a single-POI order.
 */
export function generateBoard(ctx: BoardContext): Order[] {
  const { cfg, rng, distances: dist } = ctx;
  let pool = eligiblePois(ctx.pois, ctx.selection, cfg.selection);
  const take = (): PoiInfo | null => {
    if (pool.length === 0) return null;
    const weights: Record<string, number> = {};
    for (const p of pool) weights[p.poi.id] = districtWeight(p.poi.district, ctx.selection, cfg.selection);
    const id = pickWeighted(rng, weights);
    const picked = pool.find((p) => p.poi.id === id) as PoiInfo;
    pool = pool.filter((p) => horizontalDistance(p.poi.position, picked.poi.position) >= cfg.selection.spreadMeters);
    return picked;
  };
  const tw = cfg.mix.typeWeights;
  const singleType = (): 'dropoff' | 'pickup' => pickWeighted(rng, { dropoff: tw.dropoff, pickup: tw.pickup });
  const orders: Order[] = [];

  while (orders.length < cfg.board.size && pool.length > 0) {
    let type: OrderType = pickWeighted(rng, {
      dropoff: tw.dropoff,
      pickup: tw.pickup,
      chain: ctx.unlocks.chain && pool.length >= 2 ? tw.chain : 0,
    });
    const first = take() as PoiInfo;

    if (type === 'chain') {
      const second = take();
      if (second) {
        orders.push(chainOrder(ctx, first, second));
        continue;
      }
      type = singleType(); // the spread cut every candidate for B: offer A on its own
    }

    const mw = cfg.mix.modifierWeights;
    const picked = pickWeighted(rng, {
      none: mw.none,
      express: ctx.unlocks.express ? mw.express : 0,
      fragile: mw.fragile,
      heavy: ctx.backpackCapacity >= cfg.heavy.slots ? mw.heavy : 0,
    });
    const modifier: Modifier | null = picked === 'none' ? null : picked;
    const id = first.poi.id;
    const routeDistance = type === 'pickup' ? dist.fromHub(id) + dist.toHub(id) : dist.fromHub(id);
    orders.push({
      id: ctx.nextId(),
      type,
      modifier,
      steps: orderSteps(type, [id]),
      band: first.band,
      hubDistance: first.hubDistance,
      routeDistance,
      slots: slotsFor(modifier, cfg),
      expressLimit: modifier === 'express' ? expressLimit(routeDistance, ctx.baseSprintSpeed, cfg) : null,
      parLimit: parLimit(routeDistance, ctx.baseSprintSpeed, cfg),
    });
  }
  return orders;
}

/** HUB → A → B → HUB: fromHub(A) + between(A, B) + toHub(B). No band and no modifier. */
function chainOrder(ctx: BoardContext, a: PoiInfo, b: PoiInfo): Order {
  const dist = ctx.distances;
  const routeDistance = dist.fromHub(a.poi.id) + dist.between(a.poi.id, b.poi.id) + dist.toHub(b.poi.id);
  return {
    id: ctx.nextId(),
    type: 'chain',
    modifier: null,
    steps: orderSteps('chain', [a.poi.id, b.poi.id]),
    band: null,
    hubDistance: a.hubDistance,
    routeDistance,
    slots: slotsFor(null, ctx.cfg),
    expressLimit: null,
    parLimit: parLimit(routeDistance, ctx.baseSprintSpeed, ctx.cfg),
  };
}
