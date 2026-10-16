import * as THREE from 'three';
import type { AcceptResult, ActiveOrder, CancelResult, Hospital, MoveMode, Offer, RideTier, Totals, Vec3, VehicleSpot, VehicleTier } from '@dm/shared';
import type { HudNextStop } from '../ui/hudModel';
import type { CourierDebug } from '../render/courier/CourierView';
import type { PhoneApp } from '../ui/phone/Phone';
import type { Game } from './Game';

/** Test and debugging API on window.__dm, installed only with ?debug. */
export interface DebugApi {
  /** True once the first frame has been drawn. */
  readonly ready: boolean;
  readonly tick: number;
  player(): { position: Vec3; velocity: Vec3; mode: MoveMode; riding: RideTier | null; heading: number };
  /** Moves the player into the air at `p`, optionally moving at velocity `v` (m/s). */
  teleport(p: Vec3, v?: Vec3): void;
  /** Places the player on the ground at `feet` and looks at `target`. */
  viewpoint(feet: Vec3, target: Vec3): void;
  renderInfo(): { calls: number; triangles: number };
  /** Ground point of a POI zone, by id. */
  poiPosition(id: string): Vec3;
  /** Copies of the map's hospitals (spawn points and safe zones). */
  hospitals(): Hospital[];
  /** Id of the hospital whose safe zone the player is in (as of the last tick), or null. */
  safeZone(): string | null;
  /** Copies of the offers on the phone, in arrival order (the first is the one Y accepts). */
  offers(): Offer[];
  /** Copies of the accepted orders. */
  active(): ActiveOrder[];
  /** Accepts an offer at the current sim time (before the next tick's update). */
  accept(offerId: string): AcceptResult;
  cancel(orderId: string): CancelResult;
  /** Delivery Points, Coins and deliveries so far. */
  totals(): Totals;
  /** The carrier capacity tier in use: the ride, else the last ride, else walking. */
  capacityTier(): VehicleTier;
  /** Sets the tier last ridden (capacity on foot follows it), as if the courier had just got off it. */
  setLastRide(t: RideTier | null): void;
  /** Parks `tier` next to the player (owning it first if need be) and mounts it; any current ride is left first. */
  ride(tier: RideTier): void;
  /** The owned vehicles: where each is, its world position and its tank (0..1). */
  vehicles(): { tier: RideTier; spot: VehicleSpot['kind']; position: Vec3; fuel: number }[];
  /** Sets the Coins held (saved). */
  setCoins(n: number): void;
  /** Sets an owned ride's tank (0..1; tests: a partial tank to refuel). */
  setFuel(tier: RideTier, fuel: number): void;
  /** The HUD's next stop and its route's points (driving leg, then the walk to the door), empty without one. */
  route(): { nextStop: HudNextStop | null; points: Vec3[] };
  /**
   * Runs `ticks` simulation ticks synchronously, with the current input, and returns the player's horizontal speed
   * (m/s) after each one: long sim windows in tests without waiting on the headless frame rate.
   */
  advance(ticks: number): number[];
  /** The key prompt line shown now (bottom centre), or null. */
  prompt(): string | null;
  /** Whether the phone is up (Tab). */
  phoneOpen(): boolean;
  /** Opens the phone on `app` (as Tab does, for Orders), or switches to it when open. */
  openPhone(app: PhoneApp): void;
  /** Closes the phone (as Esc does). */
  closePhone(): void;
  /** Sets the mouse look (radians; pitch is clamped to the chase limits). */
  setLook(yaw: number, pitch: number): void;
  /** The visible courier: the animated model (loaded) or the capsule fallback, its clip, pose and mixer time. */
  courier(): CourierDebug;
  /** Whether any of the camera's near plane is inside a map solid (a ball reaching the near-plane corners). */
  cameraInsideSolid(): boolean;
  /**
   * The chase camera: its position, boom length, distance to the courier's own pivot, whether the courier is hidden
   * (that distance under minDistance), and where
   * the courier's mid-body and top land on screen in normalised device coordinates (−1..1, +y up).
   */
  camera(): {
    position: Vec3;
    distance: number;
    courierDistance: number;
    courierHidden: boolean;
    courierNdc: { x: number; y: number };
    courierTopNdc: { x: number; y: number };
  };
}

declare global {
  interface Window {
    __dm?: DebugApi;
  }
}

export function installDebugHooks(game: Game): void {
  const api: DebugApi = {
    get ready() {
      return game.frames > 0;
    },
    get tick() {
      return game.tick;
    },
    player() {
      const s = game.sim.state;
      return { position: { ...s.position }, velocity: { ...s.velocity }, mode: s.mode, riding: s.riding, heading: s.heading };
    },
    teleport(p, v) {
      game.teleport(p, v);
    },
    viewpoint(feet, target) {
      game.viewpoint(feet, target);
    },
    renderInfo() {
      return game.renderer.info();
    },
    poiPosition(id) {
      const p = game.map.pois.find((x) => x.id === id);
      if (!p) throw new Error(`unknown POI ${id}`);
      return { ...p.position };
    },
    hospitals: () => structuredClone(game.map.hospitals),
    safeZone: () => game.delivery.safeZone,
    offers: () => structuredClone([...game.delivery.orders.offers]),
    active: () => structuredClone([...game.delivery.orders.active]),
    accept: (id) => game.delivery.accept(id),
    cancel: (id) => game.delivery.cancel(id),
    totals: () => ({ ...game.delivery.orders.totals }),
    capacityTier: () => game.delivery.capacityTier,
    setLastRide: (t) => {
      game.sim.state.lastRide = t;
    },
    ride: (tier) => game.rideNow(tier),
    vehicles: () =>
      game.sim.garage.owned().map((tier) => ({
        tier,
        spot: game.sim.garage.spot(tier).kind,
        position: { ...game.sim.garage.state(tier).position },
        fuel: game.sim.garage.state(tier).fuel,
      })),
    setCoins: (n) => game.delivery.setCoins(n),
    setFuel: (tier, fuel) => {
      game.sim.garage.state(tier).fuel = Math.max(0, Math.min(1, fuel));
    },
    route() {
      const m = game.delivery.model(game.time);
      const order = m.nextStop ? m.orders.find((o) => o.id === m.nextStop?.orderId) : undefined;
      const points = order?.route ? [...order.route.drive, ...(order.route.footLeg ?? [])] : [];
      return { nextStop: m.nextStop ? { ...m.nextStop } : null, points: points.map((p) => ({ ...p })) };
    },
    advance: (ticks) => game.advanceTicks(ticks),
    prompt: () => game.delivery.prompt(),
    phoneOpen: () => game.delivery.phoneOpen,
    openPhone: (app) => game.delivery.openPhone(app),
    closePhone: () => game.delivery.closePhone(),
    setLook: (yaw, pitch) => game.actions.setLook(yaw, pitch),
    cameraInsideSolid: () => game.cameraInsideSolid(),
    courier: () => game.courier.debug(),
    camera() {
      const cam = game.renderer.camera;
      const c = game.courier.root.position;
      const h = game.sim.cfg.capsule.height;
      const mid = new THREE.Vector3(c.x, c.y + h / 2, c.z).project(cam);
      const top = new THREE.Vector3(c.x, c.y + h, c.z).project(cam);
      return {
        position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        distance: game.chase.distance,
        courierDistance: game.chase.courierDistance,
        courierHidden: game.chase.courierHidden,
        courierNdc: { x: mid.x, y: mid.y },
        courierTopNdc: { x: top.x, y: top.y },
      };
    },
  };
  window.__dm = api;
}
