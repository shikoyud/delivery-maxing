import * as THREE from 'three';
import type { AcceptResult, ActiveOrder, MoveMode, Order, ThiefState, Totals, Vec3 } from '@dm/shared';
import type { CourierDebug } from '../render/courier/CourierView';
import type { ThiefDebug } from '../render/thieves/ThiefView';
import type { MapDebugView } from '../ui/mapDebug';
import type { Game } from './Game';
import type { PerfResult } from './perf';

/** Test and debugging API on window.__dm, installed only with ?debug. */
export interface DebugApi {
  /** True once the first frame has been drawn. */
  readonly ready: boolean;
  readonly tick: number;
  /**
   * Pauses or resumes the simulation: while paused, frames still draw but run no ticks, and only advance() moves sim time
   * (tests that must not depend on how fast headless frames draw).
   */
  pauseSim(paused: boolean): void;
  /** Runs `ticks` simulation ticks synchronously (the player, the orders and the thieves, as a frame would); returns the tick after. */
  advance(ticks: number): number;
  player(): { position: Vec3; velocity: Vec3; mode: MoveMode; onBoard: boolean; heading: number };
  /** Moves the player into the air at `p`, optionally moving at velocity `v` (m/s). */
  teleport(p: Vec3, v?: Vec3): void;
  /** False while a boost orb is collected and waiting to respawn. */
  orbVisible(id: string): boolean;
  /** Position of a boost orb, zip line end `a`, jump pad or rail start, by feature id. */
  featurePosition(id: string): Vec3;
  /** Places the player on the ground at `feet` and looks at `target`. */
  viewpoint(feet: Vec3, target: Vec3): void;
  renderInfo(): { calls: number; triangles: number };
  /** The F4 map debug view (null on the greybox): shown or not, and what it shows (see MapDebugView.debug). */
  mapDebug(): ReturnType<MapDebugView['debug']> | null;
  /** Physics chunks with colliders loaded ("cx,cz"); empty on the greybox (everything is loaded). */
  loadedChunks(): string[];
  /** City only: every building InstancedMesh's bounding sphere contains all the instances it draws (Review Focus 5). */
  cityBoundsOk(): boolean;
  /** City only: props per LOD ring after the last sort (null on the greybox). */
  cityStats(): { lod0: number; lod1: number; lod2: number } | null;
  /** The finished ?perf=1 flythrough's result (null until it has finished or without ?perf=1). */
  perf(): PerfResult | null;
  /** The delivery loop: copies of the board, active orders and totals; accept uses the player's position now. */
  orders: {
    board(): (Order | null)[];
    active(): ActiveOrder[];
    totals(): Totals;
    /** Points earned in the current reward epoch (local; as of the wall clock now). */
    epochPoints(): number;
    accept(id: string): AcceptResult;
  };
  /** Copies of the street thieves' states (empty on the greybox, which has none). */
  thieves(): ThiefState[];
  /** Moves a thief to the street point nearest `p` (kept on the streets by projection); returns its new state. City only. */
  placeThief(id: string, p: Vec3): ThiefState;
  /** The drawn thieves (empty on the greybox): within renderRadius, the model or capsule, clip and mixer time. */
  thiefViews(): ThiefDebug[];
  /** Whether the Order Board is open. */
  boardOpen(): boolean;
  /** Ground point of a POI zone, by id. */
  poiPosition(id: string): Vec3;
  /** Position of the HUB Order Board kiosk. */
  kiosk(): Vec3;
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
    pauseSim(paused) {
      game.simPaused = paused;
    },
    advance(ticks) {
      game.advance(ticks);
      return game.tick;
    },
    player() {
      const s = game.sim.state;
      return { position: { ...s.position }, velocity: { ...s.velocity }, mode: s.mode, onBoard: s.onBoard, heading: s.heading };
    },
    teleport(p, v) {
      game.teleport(p, v);
    },
    orbVisible(id) {
      return game.features.isOrbVisible(id);
    },
    featurePosition(id) {
      const m = game.map;
      const p =
        m.boostOrbs.find((o) => o.id === id)?.position ??
        m.jumpPads.find((o) => o.id === id)?.position ??
        m.zipLines.find((o) => o.id === id)?.a ??
        m.rails.find((o) => o.id === id)?.points[0];
      if (!p) throw new Error(`unknown feature ${id}`);
      return { ...p };
    },
    viewpoint(feet, target) {
      game.viewpoint(feet, target);
    },
    renderInfo() {
      return game.renderer.info();
    },
    mapDebug: () => game.mapDebug?.debug() ?? null,
    loadedChunks: () => [...(game.pager?.loadedChunks() ?? [])],
    cityBoundsOk() {
      if (!game.city) throw new Error('cityBoundsOk needs the city map (not ?map=greybox)');
      return game.city.boundsOk();
    },
    cityStats: () => game.city?.stats() ?? null,
    perf: () => (game.perfResult ? structuredClone(game.perfResult) : null),
    orders: {
      board: () => structuredClone([...game.delivery.orders.board]),
      active: () => structuredClone([...game.delivery.orders.active]),
      totals: () => ({ ...game.delivery.orders.totals }),
      epochPoints: () => game.delivery.epochPoints(),
      accept: (id) => game.delivery.accept(id),
    },
    thieves: () => structuredClone(game.delivery.thieves?.thieves ?? []),
    placeThief: (id, p) => structuredClone(game.placeThief(id, p)),
    thiefViews: () => game.thiefView?.debug() ?? [],
    boardOpen: () => game.delivery.modalOpen,
    poiPosition(id) {
      const p = game.map.pois.find((x) => x.id === id);
      if (!p) throw new Error(`unknown POI ${id}`);
      return { ...p.position };
    },
    kiosk: () => ({ ...game.map.hub.kiosk }),
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
