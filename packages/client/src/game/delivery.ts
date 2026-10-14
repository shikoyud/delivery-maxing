import type * as THREE from 'three';
import {
  OrderSystem,
  emptyInput,
  mulberry32,
  ordersConfig,
  playerZones,
  vehiclesConfig,
  type AcceptResult,
  type ActiveOrder,
  type Bonus,
  type CancelResult,
  type InputFrame,
  type MapData,
  type MoveMode,
  type OrderEvent,
  type PathDistance,
  type PlayerZones,
  type RideTier,
  type Rng,
  type SimEvent,
  type StatModifiers,
  type Totals,
  type Vec3,
  type VehicleTier,
} from '@dm/shared';
import type { ClientConfig } from '../clientConfig';
import type { ActionState } from '../input/actionState';
import { buildPoiMeshes, type PoiMeshes } from '../render/poiMeshes';
import { MAX_WAYPOINTS, buildWaypoints, type Waypoints } from '../render/waypoints';
import { keyLabel } from '../ui/dom';
import { Hud, type HudView } from '../ui/hud';
import { hudModel, poiIndex, pointsText, stageText, type HudModel } from '../ui/hudModel';
import { createMinimap } from '../ui/minimap';
import { createMapApp } from '../ui/phone/mapApp';
import { MapProjection } from '../ui/phone/mapProjection';
import { Phone, type PhoneApp, type PhoneCallbacks, type PhoneView } from '../ui/phone/Phone';
import { Popups, type PopupSink } from '../ui/popups';
import { SlotColorAssigner } from '../ui/slotColors';
import type { ProgressStore } from './progress';

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
  /** Path distance for offers: the on-foot path (Game: the walk navmesh), Infinity when there is none. */
  distance: PathDistance;
  /** Sprint stamina as a fraction 0..1 (the HUD ring); full when absent (tests). */
  stamina?(): number;
  /**
   * HUD, popups and the phone; default to the DOM ones on `host` (tests pass recorders). `phone` builds the phone
   * from the callbacks DeliveryLoop wires (accept, cancel, skip, closed) and its close keys.
   */
  ui?: { hud: HudView; popups: PopupSink; phone: (cb: PhoneCallbacks, closeCodes: string[]) => PhoneView };
  /** The phone opened (true) or closed (false): Game exits or re-requests the pointer lock. */
  phoneChanged?(open: boolean): void;
}

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
      skipLockout: () => this.skipLockout(),
      closed: () => {
        this.d.actions.releaseAll();
        this.d.phoneChanged?.(false);
      },
    };
    // Esc, the phone key and the map key close it (spec §8; Tab opens it through the `phone` action in beforeStep,
    // M through `map`, so both keys toggle).
    const closeCodes = ['Escape', ...d.cfg.input.bindings.phone, ...d.cfg.input.bindings.map];
    if (d.ui) this.phone = d.ui.phone(phoneCb, closeCodes);
    else {
      const phone = new Phone(d.host, phoneCb, closeCodes);
      phone.setMapApp(createMapApp(d.map, new MapProjection(d.map.size, 512), this.colorIndex));
      this.phone = phone;
    }
    this.minimap = d.ui ? null : createMinimap(d.host, d.map);
    this.zones = playerZones(d.player().position, d.map, ordersConfig.zones);
  }

  private makeSystem(totals: Totals): OrderSystem {
    return new OrderSystem(
      {
        pois: this.d.map.pois,
        distance: this.d.distance,
        rules: this.d.map.orderRules,
        cfg: ordersConfig,
        rng: this.rng,
        capacity: vehiclesConfig[this.capacityTier],
        totals,
      },
      this.d.now(),
    );
  }

  /** The player's order state (rebuilt by resetProgress). */
  get orders(): OrderSystem {
    return this.sys;
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
    return this.sys.statModifiers();
  }

  /** Whether the phone is up (the sim then gets only the look, and Y is ignored: accept with the phone's buttons). */
  get phoneOpen(): boolean {
    return this.phone.isOpen;
  }

  /** Opens the phone on `app` (Orders by default), or switches to `app` when it is already open. */
  openPhone(app: PhoneApp = 'orders'): void {
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
   * The input the sim sees this tick. The phone key toggles the phone. Y accepts the top offer here, before
   * afterStep's update, so an accept on an offer's expiry tick reports 'expired' (Review Focus 1). While the phone is
   * open Y is ignored and only the look passes (the Orders app's buttons accept, between ticks at `now()`). F on foot
   * next to a ride that can't hold the active orders is swallowed (the sim never mounts it) with the reason.
   */
  beforeStep(frame: InputFrame): InputFrame {
    if (frame.phone.pressed) this.togglePhone();
    else if (frame.map.pressed && !this.phone.isOpen) this.openPhone('map');
    if (!this.phone.isOpen) {
      if (frame.accept.pressed) {
        const top = this.sys.offers[0];
        if (top) this.accept(top.order.id);
      }
      if (frame.mount.pressed && !this.canMount()) return { ...frame, mount: { held: false, pressed: false } };
      return frame;
    }
    const idle = emptyInput();
    idle.look = frame.look;
    return idle;
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
    const cap = vehiclesConfig[tier];
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
    const riding = this.d.rider().riding !== null;
    this.sys.setCapacity(vehiclesConfig[this.capacityTier]);
    const events = this.sys.onSimEvents(simEvents);
    const before = [...this.sys.active];
    this.zones = playerZones(position, this.d.map, ordersConfig.zones);
    if (riding) this.getOffHints(now);
    const zones = riding ? { poiIds: NO_POIS, safeZone: this.zones.safeZone } : this.zones;
    events.push(...this.sys.update(now, this.offerOrigin(position, riding), zones));
    for (const e of events) this.announce(e, before);
  }

  /**
   * Where offers are measured from: the feet, or on foot in the air the last grounded feet (walk paths start on the
   * ground, so a jump at the offer roll would otherwise find no pickup in reach).
   */
  private offerOrigin(position: Vec3, riding: boolean): Vec3 {
    const p = this.d.player();
    return !riding && p.grounded === false && p.lastGrounded ? p.lastGrounded : position;
  }

  /** Riding into an active order's stop: "Get off to pick up / hand over", each at most once per hintCooldownSeconds. */
  private getOffHints(now: number): void {
    for (const a of this.sys.active) {
      if (!this.zones.poiIds.has(this.sys.currentTarget(a))) continue;
      const text = this.sys.isCarried(a) ? 'Get off to hand over' : 'Get off to pick up';
      if (now < (this.hintAt.get(text) ?? -Infinity)) continue;
      this.hintAt.set(text, now + this.d.cfg.ui.hintCooldownSeconds);
      this.popups.show(text, [], 'info');
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

  /** Dev / GAME-burn stub (price Pending): end the offer lockout now. */
  skipLockout(): void {
    this.sys.skipLockout();
    this.nextHudAt = 0;
  }

  /**
   * Dev panel: back to a fresh start — zero totals, no offers or orders (the OrderSystem is rebuilt; its capacity
   * still follows the ride) — and saved.
   */
  resetProgress(): void {
    this.sys = this.makeSystem(ZERO);
    this.save();
    this.nextHudAt = 0;
  }

  model(now: number): HudModel {
    const safe = this.zones.safeZone;
    const name = safe === null ? null : (this.d.map.hospitals.find((h) => h.id === safe)?.name ?? safe);
    return hudModel(this.sys, this.d.map, this.d.player().position, now, name, this.d.stamina?.() ?? 1);
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
    );

    if (clockSeconds < this.nextHudAt) return;
    this.nextHudAt = clockSeconds + 1 / this.d.cfg.ui.hudUpdateHz;
    const now = this.d.now();
    const m = this.model(now);
    this.hud.update(m, this.colorIndex);
    if (this.phone.isOpen) this.phone.render(m, this.d.player().position, this.d.player().heading ?? 0);
  }

  /** Saves the totals (the rest of the stored record is kept as it is). */
  private save(): void {
    this.d.progress.save({ ...this.d.progress.load(), totals: { ...this.sys.totals } });
  }

  /** `before`: the active orders before this tick's update, so a completed order's details are still known. */
  private announce(e: OrderEvent, before: readonly ActiveOrder[]): void {
    const pois = poiIndex(this.d.map);
    switch (e.kind) {
      case 'prepStarted': {
        const a = this.sys.active.find((x) => x.order.id === e.orderId);
        if (a) this.popups.show(`Preparing ${a.order.item}`, [`Ready in ${Math.ceil(e.readySeconds)} s`], 'info');
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
        const lines = e.bonuses.map((b) => `${BONUS_LINE[b]}  +${pointsText(ordersConfig.points[b])} · +${ordersConfig.coins[b]} coins`);
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
