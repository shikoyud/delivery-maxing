import type { OrdersConfig } from '../config/types';
import type { Vec3 } from '../math/vec3';
import { pickWeighted, type Rng } from '../util/rng';
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
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
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
  const first = offerOfKind(ctx, kind, remainingKg);
  if (first) return first;
  const other: OrderKind = kind === 'food' ? 'package' : 'food';
  return kindWeights[other] > 0 ? offerOfKind(ctx, other, remainingKg) : null;
}

/** One offer of `kind`, or null when no pickup/dropoff pair of that kind qualifies. */
function offerOfKind(ctx: OfferContext, kind: OrderKind, remainingKg: number): Order | null {
  const { pois, rules, cfg, rng } = ctx;
  const pickupRole: PoiRole = kind === 'food' ? 'foodPickup' : 'packagePickup';
  const dropoffRole: PoiRole = kind === 'food' ? 'dropoffFood' : 'dropoffPackage';
  const spacing = cfg.spacing.doorMeters;

  const free = (p: Poi): boolean =>
    !ctx.recentlyUsed.has(p.id) &&
    !ctx.blockedDoors.some((d) => Math.hypot(p.position.x - d.x, p.position.z - d.z) < spacing);

  // Player → pickup: a path is never shorter than the straight line, so only pickups within maxPickupDistance in a
  // straight line can qualify; of those at most offers.maxPathQueries, nearest first, get a path query.
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
    .slice(0, cfg.offers.maxPathQueries)
    .map(({ p }) => p);
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
    const { poi: dropoff, distance } = pickOne(dropoffs, rng);

    // a quantity and concrete things for the catalog phrase ("2 baguettes and a sourdough"); the greybox's own words as they are
    const item = pickup.items && pickup.items.length > 0 ? itemPhrase(pickOne(pickup.items, rng), rng) : pickup.name;
    let weightKg: number | null = null;
    let modifier: Modifier | null = null;
    if (kind === 'package') {
      const [lo, hi] = pickup.weightKg as [number, number];
      weightKg = Math.min(Math.round((lo + rng() * (hi - lo)) * 10) / 10, remainingKg);
      const m = pickWeighted(rng, cfg.mix.modifierWeights);
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
