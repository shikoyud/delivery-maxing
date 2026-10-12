import type { OrdersConfig } from '../config/types';
import type { Vec3 } from '../math/vec3';
import { pickWeighted, type Rng } from '../util/rng';
import type { PathDistance, PoiInfo } from '../world/distance';
import { expressLimit, orderSteps, parLimit, slotsFor } from './rules';
import type { Modifier, Order, OrderType, Unlocks } from './types';

export interface BoardContext {
  pois: PoiInfo[];
  distance: PathDistance;
  hub: Vec3;
  rng: Rng;
  cfg: OrdersConfig;
  baseSprintSpeed: number;
  unlocks: Unlocks;
  backpackCapacity: number;
  nextId: () => string;
}

export function generateBoard(ctx: BoardContext): Order[] {
  const { cfg, rng } = ctx;
  const remaining = [...ctx.pois];
  const take = (): PoiInfo => remaining.splice(Math.floor(rng() * remaining.length), 1)[0] as PoiInfo;
  const orders: Order[] = [];

  while (orders.length < cfg.board.size && remaining.length > 0) {
    const tw = cfg.mix.typeWeights;
    const type: OrderType = pickWeighted(rng, {
      dropoff: tw.dropoff,
      pickup: tw.pickup,
      chain: ctx.unlocks.chain && remaining.length >= 2 ? tw.chain : 0,
    });

    if (type === 'chain') {
      const a = take();
      const b = take();
      const routeDistance =
        ctx.distance(ctx.hub, a.poi.position) +
        ctx.distance(a.poi.position, b.poi.position) +
        ctx.distance(b.poi.position, ctx.hub);
      orders.push({
        id: ctx.nextId(),
        type,
        modifier: null,
        steps: orderSteps(type, [a.poi.id, b.poi.id]),
        band: null,
        hubDistance: a.hubDistance,
        routeDistance,
        slots: slotsFor(null, cfg),
        expressLimit: null,
        parLimit: parLimit(routeDistance, ctx.baseSprintSpeed, cfg),
      });
      continue;
    }

    const mw = cfg.mix.modifierWeights;
    const picked = pickWeighted(rng, {
      none: mw.none,
      express: ctx.unlocks.express ? mw.express : 0,
      fragile: mw.fragile,
      heavy: ctx.backpackCapacity >= cfg.heavy.slots ? mw.heavy : 0,
    });
    const modifier: Modifier | null = picked === 'none' ? null : picked;
    const info = take();
    const routeDistance = type === 'pickup' ? 2 * info.hubDistance : info.hubDistance;
    orders.push({
      id: ctx.nextId(),
      type,
      modifier,
      steps: orderSteps(type, [info.poi.id]),
      band: info.band,
      hubDistance: info.hubDistance,
      routeDistance,
      slots: slotsFor(modifier, cfg),
      expressLimit: modifier === 'express' ? expressLimit(routeDistance, ctx.baseSprintSpeed, cfg) : null,
      parLimit: parLimit(routeDistance, ctx.baseSprintSpeed, cfg),
    });
  }
  return orders;
}
