import type { OrdersConfig } from '../config/types';
import type { Vec3 } from '../math/vec3';
import { pickWeighted, type Rng } from '../util/rng';
import { bandFor, type PathDistance } from '../world/distance';
import type { OrderRules, Poi, PoiRole } from '../world/mapTypes';
import { expressLimit, timeLimit, weightClassFor } from './rules';
import type { CarrierCapacity, Modifier, Order, OrderKind } from './types';

export interface OfferContext {
  pois: Poi[];
  distance: PathDistance;
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

/** Generate one offer near the player, or null when no pickup/dropoff pair qualifies. */
export function generateOffer(ctx: OfferContext): Order | null {
  const { pois, rules, cfg, rng, capacity } = ctx;
  const remainingKg = capacity.maxPackageKg - ctx.carriedKg;
  const packageOk = remainingKg > 0 && ctx.freeSlots > 0;
  const kindWeights = { food: cfg.mix.kindWeights.food, package: packageOk ? cfg.mix.kindWeights.package : 0 };
  if (kindWeights.food <= 0 && kindWeights.package <= 0) return null;
  const kind: OrderKind = pickWeighted(rng, kindWeights);
  const pickupRole: PoiRole = kind === 'food' ? 'foodPickup' : 'packagePickup';
  const dropoffRole: PoiRole = kind === 'food' ? 'dropoffFood' : 'dropoffPackage';
  const spacing = cfg.spacing.doorMeters;

  const free = (p: Poi): boolean =>
    !ctx.recentlyUsed.has(p.id) &&
    !ctx.blockedDoors.some((d) => Math.hypot(p.position.x - d.x, p.position.z - d.z) < spacing);

  const pickups = shuffle(
    pois.filter(
      (p) =>
        p.roles.includes(pickupRole) &&
        free(p) &&
        ctx.distance(ctx.player, p.position) <= rules.maxPickupDistance &&
        (kind === 'food' || (p.weightKg !== undefined && p.weightKg[0] <= remainingKg)),
    ),
    rng,
  );

  for (const pickup of pickups) {
    const dropoffs = pois
      .filter((d) => d.id !== pickup.id && d.roles.includes(dropoffRole) && free(d))
      .map((d) => ({ poi: d, distance: ctx.distance(pickup.position, d.position) }))
      .filter(({ distance }) => kind !== 'food' || (distance >= rules.foodDropoff.min && distance <= rules.foodDropoff.max));
    if (dropoffs.length === 0) continue;
    const { poi: dropoff, distance } = pickOne(dropoffs, rng);

    const item = pickup.items && pickup.items.length > 0 ? pickOne(pickup.items, rng) : pickup.name;
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
