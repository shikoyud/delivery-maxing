import type { OrdersConfig } from '../config/types';
import type { Bonus, Order, OrderKind, WeightClass } from './types';

export function weightClassFor(kg: number, cfg: OrdersConfig['weightClasses']): WeightClass {
  if (kg <= cfg.smallMax) return 'small';
  if (kg <= cfg.mediumMax) return 'medium';
  if (kg <= cfg.largeMax) return 'large';
  return 'bulky';
}

/** Hot limit for food, par limit for packages (seconds from pickup). */
export function timeLimit(kind: OrderKind, distance: number, cfg: OrdersConfig): number {
  const rule = kind === 'food' ? cfg.hot : cfg.par;
  return (rule.distanceFactor * distance) / cfg.referenceSpeed + rule.extraSeconds;
}

export function expressLimit(distance: number, cfg: OrdersConfig): number {
  return (cfg.express.distanceFactor * distance) / cfg.referenceSpeed + cfg.express.extraSeconds;
}

export function scoreOrder(
  order: Order,
  outcome: { inTime: boolean; expressOnTime: boolean; intact: boolean },
  cfg: OrdersConfig,
): { points: number; coins: number; bonuses: Bonus[] } {
  const mult = order.kind === 'package' && order.weightClass ? cfg.weightMultiplier[order.weightClass] : 1;
  let points = Math.round(cfg.points[order.band] * mult);
  let coins = Math.round(cfg.coins[order.band] * mult);
  const bonuses: Bonus[] = [];
  const add = (b: Bonus): void => {
    points += cfg.points[b];
    coins += cfg.coins[b];
    bonuses.push(b);
  };
  if (outcome.inTime) add(order.kind === 'food' ? 'hot' : 'par');
  if (order.kind === 'package') {
    if (order.modifier === 'express' && outcome.expressOnTime) add('express');
    if (order.modifier === 'fragile' && outcome.intact) add('fragile');
  }
  return { points, coins, bonuses };
}

/**
 * The most points `order` can earn (the payout roll's quality denominator, spec §3.6): the band value times the
 * weight multiplier (rounded, as scoreOrder), plus the hot (food) or par (package) bonus, plus Express and Fragile
 * when the package has them.
 */
export function maxPointsFor(order: Order, cfg: OrdersConfig): number {
  return scoreOrder(order, { inTime: true, expressOnTime: true, intact: true }, cfg).points;
}
