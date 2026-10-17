import type { DispatcherTuning } from '../economy/dispatcher';
import type { OrdersConfig } from '../config/types';
import type { Vec3 } from '../math/vec3';
import { pickIndexWeighted, pickWeighted, shuffle, type Rng } from '../util/rng';
import { bandFor, type PathDistance } from '../world/distance';
import type { OrderRules, Poi, PoiRole } from '../world/mapTypes';
import type { DistanceTable } from './distanceTable';
import { itemPhrase } from './orderText';
import { expressLimit, timeLimit, weightClassFor } from './rules';
import type { CarrierCapacity, Modifier, Order, OrderKind } from './types';

export interface OfferContext {
  pois: Poi[];
  /** The router's on-foot path distance (the player→pickup leg, and pickup→dropoff pairs the table lacks). */
  distance: PathDistance;
  /** Build-time pickup→dropoff path distances (the city's map/city.distances.bin.gz); absent: every leg asks `distance`. */
  table?: DistanceTable;
  rules: OrderRules;
  cfg: OrdersConfig;
  rng: Rng;
  player: Vec3;
  capacity: CarrierCapacity;
  carriedKg: number;
  freeSlots: number;
  /** Doors of active orders and current offers (spacing). */
  blockedDoors: Vec3[];
  /** Door ids used within reuseSeconds (reuse). */
  recentlyUsed: ReadonlySet<string>;
  nextId: () => string;
  /** The owned Dispatcher tier's tuning: the long band and the modifiers roll more often (Decision 16). */
  dispatcher: DispatcherTuning;
}

const pickOne = <T>(items: T[], rng: Rng): T => items[Math.floor(rng() * items.length)] as T;

/**
 * Generate one offer near the player. The kind is rolled from the mix weights; when the rolled kind has no qualifying
 * pickup/dropoff pair, the other kind is tried (if its weight and the carrier allow it). Null when neither has a pair.
 */
export function generateOffer(ctx: OfferContext): Order | null {
  const { cfg, rng, capacity } = ctx;
  const remainingKg = capacity.maxPackageKg - ctx.carriedKg;
  const packageOk = remainingKg > 0 && ctx.freeSlots > 0;
  const kindWeights = { food: cfg.mix.kindWeights.food, package: packageOk ? cfg.mix.kindWeights.package : 0 };
  if (kindWeights.food <= 0 && kindWeights.package <= 0) return null;
  const kind: OrderKind = pickWeighted(rng, kindWeights);
  // one budget of offers.maxPathQueries player→pickup queries for the whole roll, the fallback kind included
  const budget = { left: cfg.offers.maxPathQueries };
  const first = offerOfKind(ctx, kind, remainingKg, budget);
  if (first) return first;
  const other: OrderKind = kind === 'food' ? 'package' : 'food';
  return kindWeights[other] > 0 ? offerOfKind(ctx, other, remainingKg, budget) : null;
}

/** One offer of `kind`, or null when no pickup/dropoff pair of that kind qualifies. */
function offerOfKind(ctx: OfferContext, kind: OrderKind, remainingKg: number, budget: { left: number }): Order | null {
  const { pois, rules, cfg, rng } = ctx;
  const pickupRole: PoiRole = kind === 'food' ? 'foodPickup' : 'packagePickup';
  const dropoffRole: PoiRole = kind === 'food' ? 'dropoffFood' : 'dropoffPackage';
  const spacing = cfg.spacing.doorMeters;

  const free = (p: Poi): boolean =>
    !ctx.recentlyUsed.has(p.id) &&
    !ctx.blockedDoors.some((d) => Math.hypot(p.position.x - d.x, p.position.z - d.z) < spacing);

  // Player → pickup: a path is never shorter than the straight line, so only pickups within maxPickupDistance in a
  // straight line can qualify; of those, nearest first, as many as the roll's query budget has left get a path query.
  const straight = (p: Poi): number =>
    Math.hypot(p.position.x - ctx.player.x, p.position.y - ctx.player.y, p.position.z - ctx.player.z);
  const candidates = pois
    .filter(
      (p) =>
        p.roles.includes(pickupRole) &&
        free(p) &&
        (kind === 'food' || (p.weightKg !== undefined && p.weightKg[0] <= remainingKg)) &&
        straight(p) <= rules.maxPickupDistance,
    )
    .map((p) => ({ p, d: straight(p) }))
    .sort((a, b) => a.d - b.d || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0))
    .slice(0, Math.max(0, budget.left))
    .map(({ p }) => p);
  budget.left -= candidates.length;
  const pickups = shuffle(
    candidates.filter((p) => ctx.distance(ctx.player, p.position) <= rules.maxPickupDistance),
    rng,
  );

  const window = kind === 'food' ? rules.foodDropoff : rules.packageDropoff;
  for (const pickup of pickups) {
    const dropoffs = pois
      .filter((d) => d.id !== pickup.id && d.roles.includes(dropoffRole) && free(d))
      .map((d) => ({ poi: d, distance: ctx.table?.get(pickup.id, d.id) ?? ctx.distance(pickup.position, d.position) }))
      .filter(({ distance }) => distance >= window.min && distance <= window.max);
    if (dropoffs.length === 0) continue;
    // the long band's weight scales with the Dispatcher tier (Decision 16); at tier 0 every dropoff weighs 1
    const weights = dropoffs.map(({ distance }) => (bandFor(distance, rules.bands) === 'long' ? ctx.dispatcher.longWeightScale : 1));
    const { poi: dropoff, distance } = dropoffs[pickIndexWeighted(rng, weights)] as (typeof dropoffs)[number];

    // a quantity and concrete things for the catalog phrase ("2 baguettes and a sourdough"); the greybox's own words as they are
    const item = pickup.items && pickup.items.length > 0 ? itemPhrase(pickOne(pickup.items, rng), rng) : pickup.name;
    let weightKg: number | null = null;
    let modifier: Modifier | null = null;
    if (kind === 'package') {
      const [lo, hi] = pickup.weightKg as [number, number];
      weightKg = Math.min(Math.round((lo + rng() * (hi - lo)) * 10) / 10, remainingKg);
      const w = cfg.mix.modifierWeights;
      const k = ctx.dispatcher.modifierWeightScale;
      const m = pickWeighted(rng, { none: w.none, express: w.express * k, fragile: w.fragile * k });
      modifier = m === 'none' ? null : m;
    }
    return {
      id: ctx.nextId(),
      kind,
      pickupPoiId: pickup.id,
      dropoffPoiId: dropoff.id,
      item,
      weightKg,
      weightClass: weightKg === null ? null : weightClassFor(weightKg, cfg.weightClasses),
      modifier,
      band: bandFor(distance, rules.bands),
      distance,
      timeLimit: timeLimit(kind, distance, cfg),
      expressLimit: modifier === 'express' ? expressLimit(distance, cfg) : null,
    };
  }
  return null;
}
