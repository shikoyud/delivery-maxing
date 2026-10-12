import type { OrdersConfig } from '../config/types';
import type { Bonus, Modifier, Order, OrderType, Step } from './types';

export function orderSteps(type: OrderType, poiIds: string[]): Step[] {
  const pois: Step[] = poiIds.map((poiId) => ({ kind: 'poi', poiId }));
  return type === 'dropoff' ? pois : [...pois, { kind: 'hub' }];
}

export function expressLimit(routeDistance: number, baseSprintSpeed: number, cfg: OrdersConfig): number {
  return (cfg.express.distanceFactor * routeDistance) / baseSprintSpeed + cfg.express.extraSeconds;
}

export function parLimit(routeDistance: number, baseSprintSpeed: number, cfg: OrdersConfig): number {
  return (cfg.par.distanceFactor * routeDistance) / baseSprintSpeed + cfg.par.extraSeconds;
}

export function slotsFor(modifier: Modifier | null, cfg: OrdersConfig): number {
  return modifier === 'heavy' ? cfg.heavy.slots : 1;
}

export function scoreOrder(
  order: Order,
  outcome: { onTime: boolean; intact: boolean; withinPar: boolean },
  cfg: OrdersConfig,
): { points: number; coins: number; bonuses: Bonus[] } {
  const key = order.type === 'chain' || order.band === null ? 'chain' : order.band;
  let points = cfg.points[key];
  let coins = cfg.coins[key];
  const bonuses: Bonus[] = [];
  if (order.type !== 'chain') {
    const earned =
      (order.modifier === 'express' && outcome.onTime) ||
      (order.modifier === 'fragile' && outcome.intact) ||
      order.modifier === 'heavy';
    if (earned && order.modifier) {
      const bonusKey = order.modifier === 'express' ? 'expressOnTime' : order.modifier === 'fragile' ? 'fragileIntact' : 'heavy';
      points += cfg.points[bonusKey];
      coins += cfg.coins[bonusKey];
      bonuses.push(order.modifier);
    }
  }
  if (outcome.withinPar) {
    points += cfg.points.withinPar;
    coins += cfg.coins.withinPar;
    bonuses.push('par');
  }
  return { points, coins, bonuses };
}
