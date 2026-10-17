import {
  GAME_UNITS,
  boostMultiplier,
  economyConfig,
  payoutRange,
  shopItem,
  usdToGame,
  dropoffText,
  ordersConfig,
  orderText,
  pickupText,
  scoreOrder,
  type AcceptResult,
  type ActiveOrder,
  type Band,
  type ChainSource,
  type EconomyConfig,
  type MapData,
  type Payout,
  type OrderKind,
  type OrderSystem,
  type Poi,
  ridingConfig,
  type RideTier,
  type RouteToDoor,
  type Totals,
  type TxStatus,
  type VehicleTier,
  type Vec3,
} from '@dm/shared';
import { clientConfig } from '../clientConfig';
import { nextCorner, yawTo } from '../game/routes';
import { keyLabel } from './dom';
import type { ParkedMarker } from './minimap';
import type { GarageRow } from './phone/garageApp';
import type { ShopRow } from './phone/shopApp';

/** A countdown: seconds left (0 once over) and whether the limit has passed. */
export interface HudTimer {
  secondsLeft: number;
  late: boolean;
}

export interface HudOrder {
  id: string;
  kind: OrderKind;
  item: string;
  /** "Pick up {item} from {pickup name}, {address}." before pickup, "Deliver to {dropoff address}" after. */
  stage: string;
  /** Name of the current target (pickup, then dropoff). */
  targetName: string;
  target: Vec3;
  /** Route length (the current tier's) to the current target, rounded; straight-line when there is no route. */
  distance: number;
  /** The current tier's route to the current target (the Map app draws it), or null (no navmesh, unreachable). */
  route: RouteToDoor | null;
  /** Food being prepared at the pickup: how far along (0..1) and whether it is ready. Null before arrival and after pickup. */
  prep: { progress: number; ready: boolean } | null;
  /** Seconds to reach the pickup before the order fails (spec §3.5); null once the courier has arrived. */
  pickup: HudTimer | null;
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
  /** Where the pickup is (the Map app's hollow dot). */
  pickup: Vec3;
  /** The dropoff's household or business name, shown above `dropoffText`; null when the door has no address (greybox). */
  dropoffName: string | null;
  /** "Deliver to {address}" (the name when there is no address). */
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

/** The active order to head for next (the HUD arrow). */
export interface HudNextStop {
  orderId: string;
  /** The current target's name. */
  name: string;
  /** Route length, rounded. */
  distance: number;
  /** World yaw (0 faces -Z, positive turns left) to the route's next corner. */
  bearing: number;
}

/** What the courier rides (bottom left: speed, and fuel on the motorbike and car). */
export interface HudRide {
  tier: RideTier;
  /** m/s. */
  speed: number;
  /** Tank 0..1, or null for a ride without one. */
  fuel: number | null;
}

/** Routing and riding inputs of the model (DeliveryLoop binds the tier, start and time into `route`). */
export interface HudNav {
  /** The current tier's route from the player to a target's door, or null; absent (tests): straight lines. */
  route?(targetId: string, door: Vec3): RouteToDoor | null;
  ride?: HudRide | null;
  /** The key prompt line (DeliveryLoop: `promptFor`). */
  prompt?: string | null;
  /** The wallet (DeliveryLoop: walletModel over the chain); absent (tests): emptyWallet. */
  wallet?: HudWallet;
  /** The Shop app's rows (DeliveryLoop: shopRows over Purchases); absent (tests): none. */
  shop?: ShopRow[];
}

/** The lock-to-boost lock as the Wallet shows it (spec §6.4). */
export interface HudLock {
  game: number;
  /** "×1.15": the multiplier of the GAME locked, valued when locked. */
  boostText: string;
  /** The end of the current 7-day period (dateText). */
  unlocksAt: string;
  canWithdraw: boolean;
}

/** One order's payout row: "Car · hot" with "$0.21" and its GAME, or unpaid (the vault was empty). */
export interface HudPayout {
  label: string;
  usd: string;
  game: number;
  paid: boolean;
  when: string;
}

/** One GAME purchase row: what it bought, the GAME charged, burned and sent to the vault, and its status. */
export interface HudTx {
  label: string;
  game: number;
  burned: number;
  vault: number;
  status: TxStatus;
  when: string;
  error?: string;
}

/** The reward wallet as the HUD and the Wallet app show it (walletModel). GAME amounts are base units. */
export interface HudWallet {
  address: string;
  /** The browser mock (Decision 1): the "Mock wallet" badge shows. */
  mock: boolean;
  /** Spendable GAME (the Shop's balance). */
  balance: number;
  /** GAME paid out by orders, not yet claimed (the HUD's top-right GAME figure, spec §8). */
  accrued: number;
  /** GAME the reward vault holds, and its USD value at the rate ("" without a rate). */
  vault: number;
  vaultUsd: string;
  /** The vault cannot cover the walk minimum: orders pay no GAME (Review Focus 5). */
  vaultEmpty: boolean;
  /** The rate (the Lock form's live boost preview); null without one. */
  usdPerGame: number | null;
  lock: HudLock | null;
  /** The last 20, newest first; empty while the phone is closed. */
  payouts: HudPayout[];
  /** GAME purchases, the last 20, newest first; empty while the phone is closed. */
  history: HudTx[];
  /** Claims, the last 20, newest first; empty while the phone is closed. */
  claims: { game: number; when: string }[];
}

/** Rows each Wallet list shows. */
export const WALLET_LIST_ROWS = 20;

/** A wallet with nothing in it (tests without a chain). */
export function emptyWallet(): HudWallet {
  return { address: '', mock: true, balance: 0, accrued: 0, vault: 0, vaultUsd: '', vaultEmpty: true, usdPerGame: null, lock: null, payouts: [], history: [], claims: [] };
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function whenText(atMs: number, nowMs: number): string {
  const s = Math.max(0, nowMs - atMs) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

/** A date and time in the player's zone: "Oct 24, 14:05". */
export function dateText(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** "×1.15" (two decimals). */
export function boostText(boost: number): string {
  return `×${boost.toFixed(2)}`;
}

const TIER_LABEL: Record<VehicleTier, string> = { walk: 'On foot', skateboard: 'Skateboard', bicycle: 'Bicycle', motorbike: 'Motorbike', car: 'Car' };

/** "Car · hot", "Bicycle · on time", "On foot · late"; "Order" for a payout saved without its order. */
function payoutLabel(p: Payout): string {
  const d = p.detail;
  if (!d) return 'Order';
  const how = d.kind === 'food' ? (d.inTime ? 'hot' : 'cold') : d.inTime ? 'on time' : 'late';
  return `${TIER_LABEL[d.tier]} · ${how}`;
}

function itemLabel(itemId: string): string {
  try {
    return shopItem(itemId).label;
  } catch {
    return itemId;
  }
}

/** The last `n` of an oldest-first list, newest first. */
const newest = <T>(list: readonly T[], n = WALLET_LIST_ROWS): T[] => list.slice(-n).reverse();

/**
 * The wallet at wall-clock `nowMs` from the chain: figures always, the payout, purchase and claim lists only when
 * `lists` (the phone is open), so the HUD does not build them every update.
 */
export function walletModel(chain: ChainSource, nowMs: number, lists: boolean, cfg: EconomyConfig = economyConfig): HudWallet {
  const rate = chain.rate();
  const vault = chain.vault();
  const lock = chain.lock();
  return {
    address: chain.wallet,
    mock: chain.mock,
    balance: chain.balance(),
    accrued: chain.accrued(),
    vault,
    // base units × USD per GAME = micro-USD
    vaultUsd: rate ? usdText(Math.floor(vault * rate.usdPerGame)) : '',
    // As accrue decides: the walk minimum, converted at the rate, must fit in the vault.
    vaultEmpty: rate ? vault < usdToGame(payoutRange('walk', cfg).minMicro, rate) : vault === 0,
    usdPerGame: rate ? rate.usdPerGame : null,
    lock: lock && {
      game: lock.game,
      boostText: boostText(boostMultiplier(lock.usdMicroAtLock, cfg)),
      unlocksAt: dateText(lock.unlocksAt),
      canWithdraw: chain.withdrawable(nowMs),
    },
    payouts: lists
      ? newest(chain.payouts()).map((p) => ({ label: payoutLabel(p), usd: usdText(p.usdMicro), game: p.game, paid: p.paid, when: whenText(p.at, nowMs) }))
      : [],
    history: lists
      ? newest(chain.history()).map((t) => ({
          label: itemLabel(t.itemId),
          game: t.game,
          burned: t.burned,
          vault: t.vault,
          status: t.status,
          when: whenText(t.settledAt ?? t.createdAt, nowMs),
          ...(t.error !== undefined ? { error: t.error } : {}),
        }))
      : [],
    claims: lists ? newest(chain.claims()).map((c) => ({ game: c.game, when: whenText(c.at, nowMs) })) : [],
  };
}

export interface HudModel {
  totals: Totals;
  load: HudLoad;
  /** Seconds of offer lockout left (0 when none). */
  lockoutLeft: number;
  /** Why offers are locked (null when none). */
  lockoutReason: 'cancelled' | 'missedPickup' | null;
  orders: HudOrder[];
  /** In arrival order: the first is the one Y accepts. */
  offers: HudOffer[];
  /** Name of the hospital whose safe zone the player is in, or null. */
  safeZone: string | null;
  /** Sprint stamina as a fraction 0..1 (the ring top left). */
  stamina: number;
  /** The owned vehicles (the Garage app). */
  garage: GarageRow[];
  /** The owned vehicles parked in the world, where they stand (the Map app's and minimap's markers, Decision 15). */
  parked: ParkedMarker[];
  /**
   * The active order whose current target has the shortest route for the current tier (ties: the oldest order);
   * null without active orders.
   */
  nextStop: HudNextStop | null;
  /** Null on foot. */
  ride: HudRide | null;
  /** The key prompt line (bottom centre), or null. */
  prompt: string | null;
  wallet: HudWallet;
  /** The Shop app's rows, live prices and states (spec §6, §8). */
  shop: ShopRow[];
}

/** What the key prompt depends on. */
export interface PromptContext {
  riding: RideTier | null;
  /** At or under ridingConfig.riding.stoppedSpeed (refuelling needs it; getting off does not). */
  stopped: boolean;
  /** What F would mount now on foot. */
  mountCandidate: RideTier | null;
  /** Within ridingConfig.refuel.pumpRadius of a pump. */
  atPump: boolean;
  /** The ridden vehicle's tank is full (nothing to refuel). */
  tankFull: boolean;
  /** The garage holds a ride with a tank. */
  ownsFuelledRide: boolean;
  phoneOpen: boolean;
}

/**
 * The key hint for the moment (Decision 5), or null: nothing to do, or the phone is up. Riding, it is "Get off" at
 * any speed (Decision 9), or "Refuel" when stopped at a pump with room in the tank. The key letters are the first
 * `mount` and `interact` bindings.
 */
export function promptFor(
  c: PromptContext,
  bindings: { mount: readonly string[]; interact: readonly string[] } = clientConfig.input.bindings,
): string | null {
  if (c.phoneOpen) return null;
  const mount = keyLabel(bindings.mount[0] ?? 'KeyF');
  if (c.riding !== null) {
    const refuel = c.stopped && c.atPump && !c.tankFull && ridingConfig.rides[c.riding].fuel;
    return refuel ? `Hold ${keyLabel(bindings.interact[0] ?? 'KeyE')} · Refuel` : `${mount} · Get off`;
  }
  if (c.mountCandidate !== null) return `${mount} · Ride the ${c.mountCandidate}`;
  return c.atPump && c.ownsFuelledRide ? 'Get on to refuel' : null;
}

/** The parked rows' tiers and positions (copies), in row order; carried and ridden vehicles have no marker. */
export function parkedOf(rows: readonly GarageRow[]): ParkedMarker[] {
  const out: ParkedMarker[] = [];
  for (const r of rows) if (r.status === 'parked' && r.position) out.push({ tier: r.tier, position: { ...r.position } });
  return out;
}

/** "1 pt", "N pts". */
export function pointsText(n: number): string {
  return `${n} ${n === 1 ? 'pt' : 'pts'}`;
}

/** USD from micro-USD: two decimals, three below $0.10 ("$0.12", "$0.034"). */
export function usdText(usdMicro: number): string {
  return `$${(usdMicro / 1e6).toFixed(usdMicro < 100_000 ? 3 : 2)}`;
}

/** Whole GAME from base units, with thousands separators ("12,500"); fractions are cut, never rounded up. */
export function gameText(units: number): string {
  return Math.floor(units / GAME_UNITS).toLocaleString('en-US');
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
  const { order } = a;
  return a.pickedUpAt === null
    ? pickupText(pois.get(order.pickupPoiId), order.item, order.kind === 'package' ? order.weightKg : null)
    : dropoffText(pois.get(order.dropoffPoiId));
}

function prepProgress(startedAt: number, readyAt: number, now: number): { progress: number; ready: boolean } {
  const span = readyAt - startedAt;
  const progress = span > 0 ? Math.min(1, Math.max(0, (now - startedAt) / span)) : 1;
  return { progress, ready: progress >= 1 };
}

function countdown(limit: number, elapsed: number): HudTimer {
  return { secondsLeft: Math.max(0, limit - elapsed), late: elapsed > limit };
}

export function hudModel(
  orders: OrderSystem,
  map: MapData,
  player: Vec3,
  now: number,
  safeZone: string | null,
  stamina = 1,
  garage: GarageRow[] = [],
  nav: HudNav = {},
): HudModel {
  const pois = poiIndex(map);
  // Widened so the narrowing to null at the declaration does not survive the assignments in the map below.
  let next = null as { stop: HudNextStop; length: number; reachable: boolean } | null;
  const model: HudModel = {
    totals: { ...orders.totals },
    load: {
      usedSlots: orders.usedSlots(),
      slots: orders.capacity.slots,
      carriedKg: orders.carriedKg(),
      maxPackageKg: orders.capacity.maxPackageKg,
    },
    lockoutLeft: Math.max(0, orders.lockoutUntil - now),
    lockoutReason: orders.lockoutUntil > now ? orders.lockoutReason : null,
    orders: orders.active.map((a): HudOrder => {
      const { order } = a;
      const targetPoi = pois.get(orders.currentTarget(a));
      const target = targetPoi.position;
      const route = nav.route ? nav.route(targetPoi.id, target) : null;
      const length = route ? route.length : Math.hypot(player.x - target.x, player.y - target.y, player.z - target.z);
      const toward = route ? nextCorner(route, player) : target;
      // Shortest route wins, a reachable stop beats an unreachable one, ties keep the earlier (older) order.
      const better = next === null || (route !== null && !next.reachable) || ((route !== null) === next.reachable && length < next.length);
      if (better) {
        next = {
          stop: { orderId: order.id, name: targetPoi.name, distance: Math.round(length), bearing: yawTo(player, toward) },
          length,
          reachable: route !== null,
        };
      }
      const elapsed = a.pickedUpAt === null ? null : now - a.pickedUpAt;
      const readyAt = a.pickedUpAt === null ? orders.prepReadyAt(a) : null;
      return {
        id: order.id,
        kind: order.kind,
        item: order.item,
        stage: readyAt !== null && now < readyAt ? `Waiting for ${order.item} at ${pois.get(order.pickupPoiId).name}` : stageText(a, pois),
        prep: readyAt === null ? null : prepProgress(a.prepStartedAt!, readyAt, now),
        targetName: targetPoi.name,
        target: { ...target },
        distance: Math.round(length),
        route,
        pickup: a.prepStartedAt !== null || a.pickedUpAt !== null ? null : { secondsLeft: Math.max(0, a.pickupBy - now), late: false },
        timer: elapsed === null ? null : countdown(order.timeLimit, elapsed),
        express: elapsed === null || order.modifier !== 'express' || order.expressLimit === null ? null : countdown(order.expressLimit, elapsed),
        weightKg: order.weightKg,
        fragileIntact: order.modifier === 'fragile' ? a.fragileIntact : null,
      };
    }),
    offers: orders.offers.map(({ order, expiresAt }): HudOffer => {
      const dropoff = pois.get(order.dropoffPoiId);
      const text = orderText(order, pois.get(order.pickupPoiId), dropoff);
      const best = scoreOrder(order, { inTime: true, expressOnTime: true, intact: true }, ordersConfig);
      return {
        id: order.id,
        kind: order.kind,
        pickupText: text.pickup,
        pickup: pois.target(order.pickupPoiId),
        dropoffName: dropoff.address ? dropoff.name : null,
        dropoffText: text.dropoff,
        band: order.band,
        weightKg: order.weightKg,
        secondsLeft: Math.max(0, expiresAt - now),
        reward: { points: best.points, coins: best.coins },
        acceptStatus: orders.canAccept(order.id, now),
      };
    }),
    safeZone,
    stamina,
    garage,
    parked: parkedOf(garage),
    nextStop: null,
    ride: nav.ride ?? null,
    prompt: nav.prompt ?? null,
    wallet: nav.wallet ?? emptyWallet(),
    shop: nav.shop ?? [],
  };
  model.nextStop = next?.stop ?? null;
  return model;
}
