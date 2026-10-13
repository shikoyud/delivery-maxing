import * as THREE from 'three';
import type { Hospital, MoveMode, Vec3 } from '@dm/shared';
import type { CourierDebug } from '../render/courier/CourierView';
import type { Game } from './Game';

/** Test and debugging API on window.__dm, installed only with ?debug. */
export interface DebugApi {
  /** True once the first frame has been drawn. */
  readonly ready: boolean;
  readonly tick: number;
  player(): { position: Vec3; velocity: Vec3; mode: MoveMode; onBoard: boolean; heading: number };
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
      return { position: { ...s.position }, velocity: { ...s.velocity }, mode: s.mode, onBoard: s.onBoard, heading: s.heading };
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
