import type * as THREE from 'three';
import {
  OrderSystem,
  Refueller,
  emptyInput,
  movementConfig,
  mulberry32,
  ordersConfig,
  playerZones,
  pumpAt,
  ridingConfig,
  dispatcherTuning,
  effectiveCapacity,
  boostMultiplier,
  payoutQuality,
  rollPayoutUsd,
  economyConfig,
  type ChainSource,
  type CompletedEvent,
  type Payout,
  type AcceptResult,
  type AccessKind,
  type ButtonState,
  type ActiveOrder,
  type Bonus,
  type CancelResult,
  type CarrierCapacity,
  type DistanceTable,
  type InputFrame,
  type MapData,
  type MoveMode,
  type OrderKind,
  type NavRouter,
  type OrderEvent,
  type PathDistance,
  type PlayerZones,
  type RefuelEvent,
  type RideTier,
  type Rng,
  type SimEvent,
  shoesSprintMul,
  type StatModifiers,
  type SavedVehicle,
  type SummonResult,
  type Totals,
  type Vec3,
  type VehicleState,
  type VehicleTier,
} from '@dm/shared';
import type { ClientConfig } from '../clientConfig';
import type { ActionState } from '../input/actionState';
import { buildPoiMeshes, type PoiMeshes } from '../render/poiMeshes';
import { MAX_WAYPOINTS, buildWaypoints, type Waypoints } from '../render/waypoints';
import { keyLabel } from '../ui/dom';
import { Hud, type HudView } from '../ui/hud';
import { boostText, gameText, hudModel, parkedOf, poiIndex, promptFor, pointsText, stageText, usdText, walletModel, type HudModel } from '../ui/hudModel';
import { createMinimap } from '../ui/minimap';
import { MapScreen, type MapScreenView } from '../ui/map/MapScreen';
import { RIDE_NAME, type GarageRow } from '../ui/phone/garageApp';
import { Phone, type PhoneApp, type PhoneCallbacks, type PhoneView } from '../ui/phone/Phone';
import { Popups, type PopupSink, type PopupTone } from '../ui/popups';
import { SlotColorAssigner } from '../ui/slotColors';
import type { ProgressStore } from './progress';
import { defaultWardrobe, type Purchases, type Wardrobe } from '../economy/Purchases';
import { shopRows, type ShopRow } from '../ui/phone/shopApp';
import { RouteCache } from './routes';

export interface DeliveryDeps {
  host: HTMLElement;
  scene: THREE.Scene;
  map: MapData;
  cfg: ClientConfig;
  actions: ActionState;
  progress: ProgressStore;
  /** Offer RNG seed (?seed=N, else Date.now()). */
  seed: number;
  /** Sim time (s) of the tick about to run, and the player's sim state. */
  now(): number;
  player(): { position: Vec3; mode: MoveMode; heading?: number; grounded?: boolean; lastGrounded?: Vec3 };
  /**
   * The courier's ride (Game: the sim state): the tier ridden and the one last ridden (capacity follows them), the
   * speed (m/s), and what F would mount now on foot.
   */
  rider(): { riding: RideTier | null; lastRide: RideTier | null; speed: number; mountCandidate(): RideTier | null };
  /** Sets the tier last ridden (Game: sim.state.lastRide): the Garage app's Switch on foot. */
  setLastRide?(t: RideTier): void;
  /** The owned Bag tier (Game: the chain's `ownership().lines.bag`); it and the ride set the capacity (spec §3.3). */
  bagTier(): number;
  /** The owned Dispatcher tier (Game: the chain's `ownership().lines.dispatcher`); it sets how many offers, how often, how good. */
  dispatcherTier(): number;
  /** The reward chain (Game: the browser MockChain): every completed order's GAME payout accrues there (spec §9). */
  chain: ChainSource;
  /** Wall-clock ms a payout is recorded at (the chain's time); Date.now when absent. */
  wallClock?(): number;
  /**
   * The Shop's purchases (Game: Purchases), updated each tick at the wall clock; the Shop app's rows, Buy and Confirm
   * go through it. Absent (tests): no Shop rows, and its buttons do nothing.
   */
  purchases?(): Pick<Purchases, 'update' | 'quote' | 'pending' | 'fuelTarget' | 'buy' | 'buyWithCoins'> | null;
  /** The Coin cosmetics to save (Game: the wardrobe); absent: the stored ones are kept. */
  wardrobe?(): Wardrobe;
  /** Path distance for offers: the on-foot path (Game: the walk navmesh), Infinity when there is none. */
  distance: PathDistance;
  /** The city's build-time pickup→dropoff distances (offers ask `distance` for pairs it lacks); absent on the greybox. */
  table?: DistanceTable;
  /**
   * Door routes for the HUD arrow, the stops' distances and the map screen (Game: the NavRouter), cached for
   * ui.routeRefreshSeconds. Absent (tests): straight lines.
   */
  router?: Pick<NavRouter, 'routeToDoor'>;
  /** The rendered camera's world yaw, per frame (the next-stop arrow turns with it); 0 when absent. */
  cameraYaw?(): number;
  /** Sprint stamina as a fraction 0..1 (the HUD ring); full when absent (tests). */
  stamina?(): number;
  /**
   * HUD, popups, the phone and the map screen; default to the DOM ones on `host` (tests pass recorders). `phone`
   * builds the phone from the callbacks DeliveryLoop wires (accept, cancel, skip, closed) and its close keys; `map`
   * the map screen from its close keys and closed callback.
   */
  ui?: {
    hud: HudView;
    popups: PopupSink;
    phone: (cb: PhoneCallbacks, closeCodes: string[]) => PhoneView;
    map: (closeCodes: string[], closed: () => void) => MapScreenView;
  };
  /** The phone or the map screen opened (true) or closed (false): Game exits or re-requests the pointer lock. */
  phoneChanged?(open: boolean): void;
  /**
   * The owned vehicles (Game: the sim's garage): the Garage app's rows at sim time `now`, a summon at `now`
   * (Garage.summon with findRoadSpot), and the Settings app's respawn (PlayerSim.respawnAtHospital). Absent (tests):
   * no rows, and summon and respawn do nothing.
   */
  vehicles?: {
    rows(now: number): GarageRow[];
    summon(t: RideTier, now: number): SummonResult;
    /** A ride's live state (Game: Garage.state): refuelling fills its tank. */
    state(t: RideTier): VehicleState;
    respawn(): SimEvent[];
    /** The owned vehicles as saved (Game: Garage.snapshot: a ridden one parked where it is). */
    snapshot(): SavedVehicle[];
  };
}

/** "3 min" for whole minutes, else seconds. */
const durationText = (s: number): string => (s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);

const BONUS_LINE: Record<Bonus, string> = { hot: 'Still hot', par: 'Within par', express: 'Express on time', fragile: 'Fragile intact' };

export const TIER_LABEL: Record<VehicleTier, string> = {
  walk: 'walking',
  skateboard: 'skateboard',
  bicycle: 'bicycle',
  motorbike: 'motorbike',
  car: 'car',
};

const ACCEPT_REFUSED: Partial<Record<AcceptResult, string>> = {
  expired: 'Offer expired',
  no_slots: 'No free slot',
  too_heavy: 'Too heavy for your ride',
};

/** The popup for a refused summon ('ok' shows "{Tier} is here"). */
const SUMMON_REFUSED: Record<Exclude<SummonResult, 'ok'>, string> = {
  riding: "You're riding it",
  carried: 'It travels with you',
  tooClose: 'Already nearby',
  cooldown: 'Summon cooling down',
  noSpot: 'No road nearby',
};

/** accessBlocked hints: "{Tier}s can't {phrase}". */
const ACCESS_PHRASE: Record<AccessKind, string> = {
  alley: 'go down alleys',
  steepLane: 'climb steep lanes',
  stairs: 'take stairs',
  path: 'use paths',
};

/** The hint for each refused get-off (Decision 9: F gets off at any speed, so none asks to slow down). */
export const MOUNT_REFUSED: Record<Extract<SimEvent, { kind: 'mountRefused' }>['reason'], string> = {
  noRoom: 'No room to get off',
  airborne: 'Land first',
};

/**
 * The info hint a sim event shows (null for none): refused get-offs, a tow, an empty tank, and an access zone the
 * ridden tier (`riding`) may not enter.
 */
export function simEventHint(e: SimEvent, riding: RideTier | null, map: MapData): string | null {
  switch (e.kind) {
    case 'mountRefused':
      return MOUNT_REFUSED[e.reason];
    case 'towed': {
      const name = map.hospitals.find((h) => h.id === e.hospitalId)?.name ?? 'the hospital';
      return `${RIDE_NAME[e.tier]} towed to ${name} bay`;
    }
    case 'fuelEmpty':
      return 'Out of fuel';
    case 'accessBlocked':
      return riding ? `${RIDE_NAME[riding]}s can't ${ACCESS_PHRASE[e.zone]}` : null;
    default:
      return null;
  }
}

const ZERO: Totals = { points: 0, coins: 0, deliveries: 0 };

/** No POI zones: while riding nothing is picked up or handed over (every delivery ends on foot). */
const NO_POIS: ReadonlySet<string> = new Set();

/**
 * The delivery loop on the client (spec §3, §8): owns the OrderSystem (its capacity follows the ride) and saved
 * progress, POI markers, waypoint beams, the HUD and popups. Game calls beforeStep → sim.step → afterStep each tick
 * with the same sim time (`now()`), and draw each frame.
 */
export class DeliveryLoop {
  readonly poiMeshes: PoiMeshes;
  readonly waypoints: Waypoints;
  private readonly phone: PhoneView;
  private readonly mapScreen: MapScreenView;
  private sys: OrderSystem;
  /** Sim time from which each get-off hint may show again (ui.hintCooldownSeconds). */
  private readonly hintAt = new Map<string, number>();
  private readonly rng: Rng;
  private readonly hud: HudView;
  private readonly popups: PopupSink;
  private zones: PlayerZones;
  private readonly minimap: ReturnType<typeof createMinimap> | null;
  private nextHudAt = 0;
  private readonly colors = new SlotColorAssigner();
  private readonly colorIndex = (id: string): number => this.colors.indexOf(id);
  private readonly routes: RouteCache | null;
  /** E as the player pressed it this tick (released while the phone is open). */
  private interact: ButtonState = { held: false, pressed: false };
  /** One refuelling session per ridden vehicle: replaced (its session settled) when the ride changes. */
  private refueller = new Refueller();
  private refuelTier: RideTier | null = null;

  constructor(private readonly d: DeliveryDeps) {
    this.rng = mulberry32(d.seed);
    this.sys = this.makeSystem(d.progress.load().totals);
    this.poiMeshes = buildPoiMeshes(d.map, ordersConfig.zones.poiRadius);
    this.waypoints = buildWaypoints(MAX_WAYPOINTS, d.cfg.ui.waypointPulseHz);
    d.scene.add(this.poiMeshes.group, this.waypoints.mesh);
    this.hud = d.ui?.hud ?? new Hud(d.host, d.cfg.ui, keyLabel(d.cfg.input.bindings.accept[0] ?? ''));
    this.popups = d.ui?.popups ?? new Popups(d.host, d.cfg.ui.popupSeconds, d.cfg.ui.maxPopups);
    const phoneCb: PhoneCallbacks = {
      accept: (id) => void this.accept(id),
      cancel: (id) => void this.cancel(id),
      // Confirm on the Orders app's Skip sheet buys the lockout skip (GAME), as the Shop's Confirm does.
      skipLockout: (maxGame) => void this.shopConfirm('lockoutSkip', maxGame),
      shopBuy: (id) => this.shopBuy(id),
      shopConfirm: (id, maxGame) => void this.shopConfirm(id, maxGame),
      shopCancel: () => undefined,
      claim: () => void this.claim(),
      lockGame: (game) => this.lockGame(game),
      withdrawLock: () => this.withdrawLock(),
      summon: (t) => void this.summon(t),
      switchRide: (t) => void this.switchTo(t),
      respawn: () => this.respawn(),
      closed: () => {
        this.d.actions.releaseAll();
        this.d.phoneChanged?.(false);
      },
    };
    // Esc, the phone key and the map key close it (spec §8; Tab opens it through the `phone` action in beforeStep, so
    // it toggles; M closes it but does not open the map over it).
    const closeCodes = ['Escape', ...d.cfg.input.bindings.phone, ...d.cfg.input.bindings.map];
    this.phone = d.ui ? d.ui.phone(phoneCb, closeCodes) : new Phone(d.host, phoneCb, closeCodes);
    // Esc and the map key close the map screen (M opens it through the `map` action in beforeStep).
    const mapCodes = ['Escape', ...d.cfg.input.bindings.map];
    const mapClosed = (): void => {
      this.d.actions.setLookFrozen(false);
      this.d.actions.releaseAll();
      this.d.phoneChanged?.(false);
    };
    this.mapScreen = d.ui
      ? d.ui.map(mapCodes, mapClosed)
      : new MapScreen(d.host, d.map, this.colorIndex, { closeCodes: mapCodes, closed: mapClosed });
    this.minimap = d.ui ? null : createMinimap(d.host, d.map);
    this.zones = playerZones(d.player().position, d.map, ordersConfig.zones);
    this.routes = d.router ? new RouteCache(d.router, d.cfg.ui.routeRefreshSeconds, d.cfg.ui.routeDriftMeters) : null;
  }

  private makeSystem(totals: Totals): OrderSystem {
    return new OrderSystem(
      {
        pois: this.d.map.pois,
        distance: this.d.distance,
        ...(this.d.table ? { table: this.d.table } : {}),
        rules: this.d.map.orderRules,
        cfg: ordersConfig,
        rng: this.rng,
        capacity: this.capacity(),
        totals,
        dispatcher: () => dispatcherTuning(this.d.dispatcherTier()),
        vehicleTier: () => this.capacityTier,
      },
      this.d.now(),
    );
  }

  /** The player's order state (rebuilt by resetProgress). */
  get orders(): OrderSystem {
    return this.sys;
  }

  /** The effective capacity (spec §3.3): the Bag tier's slots and kg, each capped by the ride (or the last ride). */
  capacity(): CarrierCapacity {
    return effectiveCapacity(this.d.bagTier(), this.capacityTier);
  }

  /** The capacity tier: the ride, else the last ride, else walking. */
  get capacityTier(): VehicleTier {
    const r = this.d.rider();
    return r.riding ?? r.lastRide ?? 'walk';
  }

  /** Id of the hospital whose safe zone the player is in (as of the last tick), or null. */
  get safeZone(): string | null {
    return this.zones.safeZone;
  }

  /** Packages the courier is carrying now (picked up, not yet delivered or cancelled). */
  carriedCount(): number {
    return this.sys.active.filter((a) => this.sys.isCarried(a)).length;
  }

  statModifiers(): StatModifiers {
    return { ...this.sys.statModifiers(), sprintMul: shoesSprintMul(this.d.chain.ownership().lines.shoes) };
  }

  /** Whether the phone is up (the sim then gets only the look, and Y is ignored: accept with the phone's buttons). */
  get phoneOpen(): boolean {
    return this.phone.isOpen;
  }

  /** Whether the full-screen map is up (M; the sim then gets only the look). */
  get mapOpen(): boolean {
    return this.mapScreen.isOpen;
  }

  /**
   * Opens the map screen (at any speed, on foot or riding; not over the phone). Held keys are released, the mouse look
   * freezes (drags pan the map, so they must not turn the camera) and the pointer lock is released as for the phone.
   */
  openMap(): void {
    if (this.mapScreen.isOpen || this.phone.isOpen) return;
    this.mapScreen.open();
    this.d.actions.releaseAll();
    this.d.actions.setLookFrozen(true);
    this.nextHudAt = 0; // draw the map at once
    this.d.phoneChanged?.(true);
  }

  /** Closes the map screen (its `closed` callback frees the look, releases keys and reports it). */
  closeMap(): void {
    this.mapScreen.close();
  }

  /** Opens the phone on `app` (Orders by default), or switches to `app` when it is already open. */
  openPhone(app: PhoneApp = 'orders'): void {
    if (this.mapScreen.isOpen) return;
    if (this.phone.isOpen) {
      this.phone.show(app);
      return;
    }
    this.phone.open(app);
    this.d.actions.releaseAll(); // keys held when it opened must not stay pressed underneath
    this.nextHudAt = 0; // draw the phone at once
    this.d.phoneChanged?.(true);
  }

  /** Closes the phone (its `closed` callback releases keys and reports it). */
  closePhone(): void {
    this.phone.close();
  }

  togglePhone(): void {
    if (this.phone.isOpen) this.closePhone();
    else this.openPhone();
  }

  /**
   * The input the sim sees this tick. M toggles the map screen at any speed (Decision 11); while it is open the sim
   * gets only the look (no move, brake, jump, F or Y) and the phone key does nothing. The phone key toggles the phone,
   * but while riding faster than ridingConfig.riding.stoppedSpeed it only says "Stop to use the phone" (spec §8:
   * notifications only while riding); M with the phone open is the phone's close key, so it does not open the map.
   * Y accepts the top offer here, riding or not, before afterStep's update, so an accept on an offer's expiry tick
   * reports 'expired' (Review Focus 1). While the phone is open Y is ignored and only the look passes (the Orders
   * app's buttons accept, between ticks at `now()`), with the brake held on a vehicle so it stays put: Space (the
   * handbrake) on a ride whose Space does not jump, S on one that ollies (its jumpHeight is set; it does not reverse, so
   * S only brakes, slopes included). F on foot
   * next to a ride that can't hold the active orders is swallowed (the sim never mounts it) with the reason.
   */
  beforeStep(frame: InputFrame): InputFrame {
    this.interact = { held: false, pressed: false };
    if (this.mapScreen.isOpen) {
      if (frame.map.pressed) this.closeMap(); // the screen's own key handler usually closes it first
    } else if (frame.phone.pressed) {
      if (this.phone.isOpen) this.closePhone();
      else if (this.phoneAllowed()) this.openPhone();
    } else if (frame.map.pressed && !this.phone.isOpen) this.openMap();
    if (this.mapScreen.isOpen) {
      const look = emptyInput();
      look.look = frame.look;
      return look;
    }
    if (!this.phone.isOpen) {
      this.interact = frame.interact;
      if (frame.accept.pressed) {
        const top = this.sys.offers[0];
        if (top) this.accept(top.order.id);
      }
      if (frame.mount.pressed && !this.canMount()) return { ...frame, mount: { held: false, pressed: false } };
      return frame;
    }
    const idle = emptyInput();
    idle.look = frame.look;
    const tier = this.d.rider().riding;
    if (tier !== null) {
      if (ridingConfig.rides[tier].jumpHeight === null) idle.jump = { held: true, pressed: false }; // Space: the handbrake
      else idle.move = { x: 0, y: -1 }; // S: the brake (Space would not brake a ride that jumps)
    }
    return idle;
  }

  /** The phone opens on foot or stopped on a ride; moving faster, a hint (at most once per hintCooldownSeconds). */
  private phoneAllowed(): boolean {
    const r = this.d.rider();
    if (r.riding === null || r.speed <= ridingConfig.riding.stoppedSpeed) return true;
    this.hint('Stop to use the phone', this.d.now());
    return false;
  }

  /** An info popup, at most once per ui.hintCooldownSeconds of sim time per text. */
  private hint(text: string, now: number): void {
    if (now < (this.hintAt.get(text) ?? -Infinity)) return;
    this.hintAt.set(text, now + this.d.cfg.ui.hintCooldownSeconds);
    this.popups.show(text, [], 'info');
  }

  /**
   * Whether F may go to the sim: always while riding (dismount) or with nothing to mount; on foot, only when the
   * candidate ride holds the active orders (else a warning says why).
   */
  private canMount(): boolean {
    const r = this.d.rider();
    if (r.riding !== null) return true;
    const tier = r.mountCandidate();
    if (tier === null) return true;
    const cap = effectiveCapacity(this.d.bagTier(), tier);
    if (this.sys.canSwitchCapacity(cap)) return true;
    const kg = cap.maxPackageKg > 0 ? ` and ${cap.maxPackageKg} kg` : ' and no packages';
    this.popups.show(`Can't ride the ${TIER_LABEL[tier]}`, [`Your orders don't fit: ${cap.slots} slot${cap.slots === 1 ? '' : 's'}${kg}`], 'warn');
    return false;
  }

  /**
   * After sim.step: capacity follows the ride, Fragile damage, then zones and the order update (same tick), then
   * popups. While riding the POI zones count as empty (deliveries end on foot) and an active order's stop shows a
   * get-off hint instead.
   */
  afterStep(simEvents: SimEvent[], position: Vec3, now: number): void {
    const ridden = this.d.rider().riding;
    const riding = ridden !== null;
    for (const e of simEvents) {
      const text = simEventHint(e, ridden, this.d.map);
      if (text) this.hint(text, now);
    }
    this.sys.setCapacity(this.capacity());
    const events = this.sys.onSimEvents(simEvents);
    const before = [...this.sys.active];
    this.zones = playerZones(position, this.d.map, ordersConfig.zones);
    if (riding) this.getOffHints(now);
    this.refuel(position, now);
    const zones = riding ? { poiIds: NO_POIS, safeZone: this.zones.safeZone } : this.zones;
    events.push(...this.sys.update(now, this.offerOrigin(position), zones));
    for (const e of events) this.announce(e, before);
    this.d.purchases?.()?.update(this.d.wallClock?.() ?? Date.now());
  }

  /** A popup (Purchases: bought, parked, failed). */
  popup(title: string, lines: string[] = [], tone: PopupTone = 'info'): void {
    this.popups.show(title, lines, tone);
    this.nextHudAt = 0;
  }

  /**
   * Refuelling (spec §4.5): E held, stopped, at a pump, on the motorbike or car. Each `refuelled` event is paid
   * (OrderSystem.spendCoins, the Refueller sees the balance before it). When the ride changes or the courier gets off,
   * the old vehicle's session is settled first, so a fill cut short is still charged and no session carries over. E
   * at a pump on a ride without a tank says so; on foot E does nothing here.
   */
  private refuel(position: Vec3, now: number): void {
    const v = this.d.vehicles;
    if (!v) return;
    const r = this.d.rider();
    if (r.riding !== this.refuelTier) {
      if (this.refuelTier !== null) {
        const old = this.refuelTier;
        this.pay(this.refueller.tick(v.state(old), ridingConfig.rides[old], { holding: false, atPump: false, stopped: true, coins: this.sys.totals.coins, dt: 0 }));
      }
      this.refueller = new Refueller();
      this.refuelTier = r.riding;
      this.save(); // mounted or dismounted: the vehicle's spot and the last ride are saved
    }
    if (r.riding === null) return;
    const spec = ridingConfig.rides[r.riding];
    const atPump = pumpAt(this.d.map, position, ridingConfig.refuel.pumpRadius) !== null;
    if (!spec.fuel) {
      if (this.interact.pressed && atPump) this.hint('This one runs on legs', now);
      return;
    }
    this.pay(
      this.refueller.tick(v.state(r.riding), spec, {
        holding: this.interact.held,
        atPump,
        stopped: r.speed <= ridingConfig.riding.stoppedSpeed,
        coins: this.sys.totals.coins,
        dt: 1 / movementConfig.tickRate,
      }),
    );
  }

  private pay(events: RefuelEvent[]): void {
    for (const e of events) {
      if (e.kind === 'refuelRefused') {
        this.nextHudAt = 0;
        this.popups.show('No Coins for fuel', [], 'warn');
        continue;
      }
      if (e.kind !== 'refuelled') continue;
      this.nextHudAt = 0;
      if (e.cost <= 0) continue;
      this.sys.spendCoins(e.cost);
      this.save();
      this.popups.show(`Refuelled · −${e.cost} coins`, [], 'info');
      if (e.reason === 'coins') this.popups.show(`Out of Coins · tank ${Math.round(e.fuel * 100)} %`, [], 'warn');
    }
  }

  /**
   * Where offers are measured from: the feet, or in the air (on foot or riding) the last grounded feet (walk paths
   * start on the ground, so a jump at the offer roll would otherwise find no pickup in reach).
   */
  private offerOrigin(position: Vec3): Vec3 {
    const p = this.d.player();
    return p.grounded === false && p.lastGrounded ? p.lastGrounded : position;
  }

  /** Riding into an active order's stop: "Get off to pick up / hand over", each at most once per hintCooldownSeconds. */
  private getOffHints(now: number): void {
    for (const a of this.sys.active) {
      if (!this.zones.poiIds.has(this.sys.currentTarget(a))) continue;
      this.hint(this.sys.isCarried(a) ? 'Get off to hand over' : 'Get off to pick up', now);
    }
  }

  accept(offerId: string): AcceptResult {
    const offer = this.sys.offers.find((o) => o.order.id === offerId);
    const result = this.sys.accept(offerId, this.d.now());
    if (result === 'ok') {
      const a = this.sys.active.find((x) => x.order.id === offerId);
      this.popups.show('Offer accepted', a ? [stageText(a, poiIndex(this.d.map))] : [], 'info');
    } else if (offer) {
      const text = ACCEPT_REFUSED[result];
      if (text) this.popups.show(text, [], 'warn');
    }
    this.nextHudAt = 0;
    return result;
  }

  cancel(orderId: string): CancelResult {
    const result = this.sys.cancel(orderId, this.d.now());
    if (result === 'ok') {
      this.popups.show(`Order cancelled · no new offers for ${ordersConfig.lockout.seconds} s`, [], 'warn');
      this.nextHudAt = 0;
    }
    return result;
  }

  /**
   * Garage app: summons `t` (spec §4.4) at sim time `now()`: "{Tier} is here", or the refusal (a cooldown says when
   * it ends).
   */
  summon(t: RideTier): SummonResult {
    const v = this.d.vehicles;
    if (!v) return 'noSpot';
    const now = this.d.now();
    const result = v.summon(t, now);
    if (result === 'ok') {
      this.popups.show(`${RIDE_NAME[t]} is here`, [], 'info');
      this.save();
    }
    else {
      const readyIn = v.rows(now).find((r) => r.tier === t)?.readyIn ?? 0;
      const lines = result === 'cooldown' ? [`Ready in ${Math.ceil(readyIn)} s`] : [];
      this.popups.show(SUMMON_REFUSED[result], lines, 'warn');
    }
    this.nextHudAt = 0;
    return result;
  }

  /**
   * Garage app Switch (decision 6): on foot, the tier offers, capacity and the payout range follow `t`. Refused while
   * riding ("Get off first") and when the active orders would not fit the capacity `t` caps (spec §3.3).
   */
  switchTo(t: RideTier): { ok: true } | { ok: false; message: string } {
    const refuse = (message: string): { ok: false; message: string } => {
      this.popups.show(message, [], 'warn');
      return { ok: false, message };
    };
    if (this.d.rider().riding !== null) return refuse('Get off first');
    const row = this.d.vehicles?.rows(this.d.now()).find((r) => r.tier === t);
    if (!this.d.setLastRide || (row && !row.owned)) return refuse(`You don't have the ${TIER_LABEL[t]}`);
    if (!this.sys.canSwitchCapacity(effectiveCapacity(this.d.bagTier(), t))) return refuse(`Your orders don't fit on the ${TIER_LABEL[t]}`);
    this.d.setLastRide(t);
    this.sys.setCapacity(this.capacity());
    this.popups.show(`Offers now for the ${TIER_LABEL[t]}`, [], 'info');
    this.save();
    this.nextHudAt = 0;
    return { ok: true };
  }

  /**
   * Settings app (spec §13 Vehicle stuck): respawn on foot at the nearest hospital. The orders are kept; the
   * `respawned` event breaks a carried Fragile as an out-of-bounds respawn does. The phone closes on the hospital.
   */
  respawn(): void {
    const v = this.d.vehicles;
    if (!v) return;
    const simEvents = v.respawn();
    const before = [...this.sys.active];
    for (const e of this.sys.onSimEvents(simEvents)) this.announce(e, before);
    const r = simEvents.find((e): e is Extract<SimEvent, { kind: 'respawned' }> => e.kind === 'respawned');
    const name = r ? this.d.map.hospitals.find((h) => h.id === r.hospitalId)?.name : undefined;
    if (name) this.popups.show(`Respawned at ${name}`, [], 'info');
    this.closePhone();
    this.nextHudAt = 0;
  }

  /** Dev panel and debug API: sets the Coins held, saved. */
  setCoins(n: number): void {
    this.sys.totals = { ...this.sys.totals, coins: Math.max(0, n) };
    this.save();
    this.nextHudAt = 0;
  }

  /** The Shop app's rows at sim time `now` (none without purchases). */
  private shopRows(now: number): ShopRow[] {
    const p = this.d.purchases?.();
    if (!p) return [];
    return shopRows(p, this.d.chain.ownership(), this.d.wardrobe?.() ?? defaultWardrobe(), this.sys.lockoutUntil > now);
  }

  /** The Shop's Buy on a Coin item: bought now, or a popup saying why not. */
  shopBuy(itemId: string): void {
    const p = this.d.purchases?.();
    if (!p) return;
    const r = p.buyWithCoins(itemId);
    if (!r.ok) this.popup(r.message, [], 'warn');
    this.nextHudAt = 0;
  }

  /** A confirm sheet's Confirm (the Shop's, the Orders app's Skip): sends a GAME purchase capped at `maxGame`; a refusal pops up. */
  async shopConfirm(itemId: string, maxGame: number): Promise<void> {
    const p = this.d.purchases?.();
    if (!p) return;
    this.nextHudAt = 0;
    const r = await p.buy(itemId, maxGame);
    if (!r.ok) this.popup(r.message, [], 'warn');
    this.nextHudAt = 0;
  }

  private wallMs(): number {
    return this.d.wallClock?.() ?? Date.now();
  }

  /** The Wallet's Claim: the accrued GAME moves to the balance (instant on the mock, Decision 3). */
  async claim(): Promise<void> {
    const r = await this.d.chain.claim(this.wallMs());
    if (r.ok) this.popup(`Claimed ${gameText(r.game)} GAME`, ['Added to your balance'], 'good');
    else this.popup('Nothing to claim yet', ['Deliver orders to earn GAME'], 'warn');
  }

  /** The Wallet's Lock: locks `game` base units for lock.days days (spec §6.4); a refusal pops up. */
  lockGame(game: number): void {
    const r = this.d.chain.lockGame(game, this.wallMs());
    if (!r.ok) {
      this.popup(r.reason === 'locked' ? 'GAME is already locked' : 'Not enough GAME to lock', [], 'warn');
      return;
    }
    const lock = this.d.chain.lock();
    const boost = boostText(boostMultiplier(lock ? lock.usdMicroAtLock : 0));
    this.popup(`Locked ${gameText(game)} GAME for ${economyConfig.lock.days} days`, [`${boost} boost on every order`], 'good');
  }

  /** The Wallet's Withdraw: the locked GAME back to the balance once the period has ended; too early pops up. */
  withdrawLock(): void {
    const lock = this.d.chain.lock();
    const r = this.d.chain.withdrawLock(this.wallMs());
    if (r.ok) this.popup(`Withdrew ${gameText(lock?.game ?? 0)} GAME`, ['The boost ends'], 'good');
    else this.popup(r.reason === 'none' ? 'No GAME is locked' : 'The lock has not ended yet', [], 'warn');
  }

  /** Dev and debug: end the offer lockout now, free (the phone's Skip buys it: shopConfirm). */
  skipLockout(): void {
    this.sys.skipLockout();
    this.nextHudAt = 0;
  }

  /**
   * Dev panel: back to a fresh start — zero totals, no offers or orders (the OrderSystem is rebuilt; its capacity
   * still follows the ride) — and saved.
   */
  resetProgress(): void {
    // Any refuel in progress ends with it: its accrued cost must not be charged to the fresh balance later.
    this.refueller = new Refueller();
    this.sys = this.makeSystem(ZERO);
    this.save();
    this.nextHudAt = 0;
  }

  /**
   * The HUD model at sim time `now`. Routes are for the ridden tier (walk on foot) from the feet on the ground (in the
   * air, the last grounded feet), through the RouteCache.
   */
  model(now: number): HudModel {
    const safe = this.zones.safeZone;
    const name = safe === null ? null : (this.d.map.hospitals.find((h) => h.id === safe)?.name ?? safe);
    const player = this.d.player();
    const p = player.position;
    const r = this.d.rider();
    const tier: VehicleTier = r.riding ?? 'walk';
    const from = player.grounded === false && player.lastGrounded ? player.lastGrounded : p;
    const rows = this.d.vehicles?.rows(now) ?? [];
    const routes = this.routes;
    if (routes) routes.retain(new Set(this.sys.active.map((a) => this.sys.currentTarget(a))));
    return hudModel(this.sys, this.d.map, p, now, name, this.d.stamina?.() ?? 1, rows, {
      route: routes ? (id, door) => routes.get(tier, from, id, door, now) : undefined,
      ride: r.riding === null ? null : { tier: r.riding, speed: r.speed, fuel: rows.find((x) => x.tier === r.riding)?.fuel ?? null },
      prompt: this.prompt(),
      // The Wallet's lists, the Shop and the Orders app's Skip read the rows: built only while the phone shows them.
      wallet: walletModel(this.d.chain, this.wallMs(), this.phone.isOpen),
      shop: this.phone.isOpen ? this.shopRows(now) : [],
    });
  }

  /** The key prompt now (hud-prompt): F to ride or get off, E to refuel, a pump hint on foot; null with the phone or map up. */
  prompt(): string | null {
    const r = this.d.rider();
    const rows = this.d.vehicles?.rows(this.d.now()) ?? [];
    const fuel = r.riding === null || !this.d.vehicles ? undefined : this.d.vehicles.state(r.riding).fuel;
    return promptFor(
      {
        riding: r.riding,
        stopped: r.speed <= ridingConfig.riding.stoppedSpeed,
        mountCandidate: r.riding === null ? r.mountCandidate() : null,
        atPump: pumpAt(this.d.map, this.d.player().position, ridingConfig.refuel.pumpRadius) !== null,
        tankFull: fuel !== undefined && fuel >= 1,
        ownsFuelledRide: rows.some((x) => x.fuel !== null),
        phoneOpen: this.phone.isOpen || this.mapScreen.isOpen,
      },
      this.d.cfg.input.bindings,
    );
  }

  /** Hides the POI marker the rendered camera is in (Game calls it per frame, after the chase camera moved). */
  setCamera(p: Vec3): void {
    this.poiMeshes.setCamera(p);
  }

  /** Per frame: waypoint beams and POI markers for each order's current stop; the HUD at hudUpdateHz. */
  draw(clockSeconds: number): void {
    const pois = poiIndex(this.d.map);
    const targets: Vec3[] = [];
    const targetIds = new Set<string>();
    const colorIndices: number[] = [];
    this.colors.sync(this.sys.active.map((a) => a.order.id));
    for (const a of this.sys.active) {
      const id = this.sys.currentTarget(a);
      targets.push(pois.target(id));
      targetIds.add(id);
      colorIndices.push(this.colors.indexOf(a.order.id));
    }
    this.waypoints.update(targets, colorIndices, clockSeconds);
    this.poiMeshes.setTargets(targetIds);
    this.poiMeshes.setHighlight(this.sys.offers[0]?.order.pickupPoiId ?? null);
    this.minimap?.render(
      this.d.player().position,
      this.d.player().heading ?? 0,
      targets.map((position, i) => ({ position, colorIndex: colorIndices[i] ?? 0 })),
      this.sys.offers.map((o) => pois.target(o.order.pickupPoiId)),
      parkedOf(this.d.vehicles?.rows(this.d.now()) ?? []),
    );

    this.hud.aim?.(this.d.cameraYaw?.() ?? 0);

    if (clockSeconds < this.nextHudAt) return;
    this.nextHudAt = clockSeconds + 1 / this.d.cfg.ui.hudUpdateHz;
    const now = this.d.now();
    const m = this.model(now);
    this.hud.update(m, this.colorIndex);
    if (this.phone.isOpen) this.phone.render(m, this.d.player().position, this.d.player().heading ?? 0);
    if (this.mapScreen.isOpen) this.mapScreen.render(m, this.d.player().position, this.d.player().heading ?? 0);
  }

  /**
   * Saves the totals, the garage (Game: Garage.snapshot) and the last ride. Also called by Game after the dev panel
   * changes ownership.
   */
  save(): void {
    const stored = this.d.progress.load();
    this.d.progress.save({
      totals: { ...this.sys.totals },
      garage: this.d.vehicles ? this.d.vehicles.snapshot() : stored.garage,
      lastRide: this.d.rider().lastRide,
      cosmetics: this.d.wardrobe ? this.d.wardrobe() : stored.cosmetics,
    });
  }

  /**
   * Rolls and records a completed order's GAME payout (spec §3.6, §9; Decision 3): `luck` from the seeded RNG, the
   * quality points ÷ maxPoints, the order's tier's range, the lock-to-boost multiplier of the GAME locked (valued when
   * locked), applied once inside the shared roll. The chain converts that USD at its rate (a stale rate is still the
   * last good one, Decision 14) and pays from the vault, or records it unpaid when the vault cannot cover it.
   */
  payOut(e: CompletedEvent, nowMs: number, kind: OrderKind | null = null): Payout | null {
    const chain = this.d.chain;
    const rate = chain.rate();
    // Unreachable with the MockChain (it always has a rate); a chain without one pays nothing and adds no GAME lines.
    if (rate === null) return null;
    const lock = chain.lock();
    const boost = boostMultiplier(lock ? lock.usdMicroAtLock : 0);
    const luck = this.rng();
    const quality = payoutQuality(e.points, e.maxPoints);
    const usdMicro = rollPayoutUsd({ tier: e.tier, points: e.points, maxPoints: e.maxPoints, luck, boost });
    const detail = kind === null ? {} : { detail: { tier: e.tier, kind, inTime: e.inTime } };
    return chain.accrue({ orderId: e.orderId, usdMicro, luck, quality, usdPerGame: rate.usdPerGame, boost, at: nowMs, ...detail });
  }

  /** The delivery popup's GAME lines: "+$0.12 ≈ 500 GAME" (and "×1.15 boost" when locked), or "Vault empty · no GAME". */
  private payoutLines(p: Payout | null): string[] {
    if (p === null) return [];
    if (!p.paid) return ['Vault empty · no GAME'];
    const lines = [`+${usdText(p.usdMicro)} ≈ ${gameText(p.game)} GAME`];
    const boost = Number(p.boost.toFixed(2));
    if (boost > 1) lines.push(`×${boost} boost`); // shown only above ×1.00 once rounded
    return lines;
  }

  /** `before`: the active orders before this tick's update, so a completed order's details are still known. */
  private announce(e: OrderEvent, before: readonly ActiveOrder[]): void {
    const pois = poiIndex(this.d.map);
    switch (e.kind) {
      case 'prepStarted': {
        const a = this.sys.active.find((x) => x.order.id === e.orderId);
        if (a) this.popups.show(`Preparing ${a.order.item}`, ['Wait at the counter'], 'info');
        this.nextHudAt = 0;
        break;
      }
      case 'pickupMissed': {
        const missed = before.find((a) => a.order.id === e.orderId);
        this.popups.show(`Missed the pickup${missed ? ` · ${missed.order.item}` : ''}`, [`No new offers for ${durationText(e.lockoutSeconds)}`], 'warn');
        this.nextHudAt = 0;
        break;
      }
      case 'pickedUp': {
        const a = this.sys.active.find((x) => x.order.id === e.orderId);
        if (a) this.popups.show(`Picked up ${a.order.item}`, [stageText(a, pois)], 'info');
        this.nextHudAt = 0;
        break;
      }
      case 'completed': {
        this.save();
        const done = before.find((a) => a.order.id === e.orderId);
        const lines = this.payoutLines(this.payOut(e, this.wallMs(), done?.order.kind ?? null));
        lines.push(...e.bonuses.map((b) => `${BONUS_LINE[b]}  +${pointsText(ordersConfig.points[b])} · +${ordersConfig.coins[b]} coins`));
        if (!e.inTime) lines.push(done?.order.kind === 'food' ? 'Cold · no hot bonus' : 'Over par · no bonus');
        if (e.expressOnTime === false) lines.push('Express late · no bonus');
        if (done?.order.modifier === 'fragile' && !done.fragileIntact) lines.push('Fragile damaged · no bonus');
        this.popups.show(`Delivered! +${pointsText(e.points)} · +${e.coins} coins`, lines);
        this.nextHudAt = 0;
        break;
      }
      case 'fragileBroken':
        if (e.reason === 'crash') this.popups.show('Crashed · Fragile bonus lost', ['The order still counts'], 'warn');
        else this.popups.show('Fragile package damaged', ['Bonus lost · the order still counts'], 'warn');
        break;
      case 'offered':
      case 'offerExpired':
      case 'lockoutEnded':
        this.nextHudAt = 0; // toasts and the lockout chip update at once
        break;
    }
  }
}
