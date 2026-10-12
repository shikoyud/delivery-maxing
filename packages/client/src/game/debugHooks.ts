import type { AcceptResult, ActiveOrder, MoveMode, Order, Totals, Vec3 } from '@dm/shared';
import type { Game } from './Game';

/** Test and debugging API on window.__dm, installed only with ?debug. */
export interface DebugApi {
  /** True once the first frame has been drawn. */
  readonly ready: boolean;
  readonly tick: number;
  player(): { position: Vec3; velocity: Vec3; mode: MoveMode; onBoard: boolean };
  teleport(p: Vec3): void;
  /** False while a boost orb is collected and waiting to respawn. */
  orbVisible(id: string): boolean;
  /** Position of a boost orb, zip line end `a`, jump pad or rail start, by feature id. */
  featurePosition(id: string): Vec3;
  /** Places the player on the ground at `feet` and looks at `target`. */
  viewpoint(feet: Vec3, target: Vec3): void;
  renderInfo(): { calls: number; triangles: number };
  /** The delivery loop: copies of the board, active orders and totals; accept uses the player's position now. */
  orders: {
    board(): (Order | null)[];
    active(): ActiveOrder[];
    totals(): Totals;
    accept(id: string): AcceptResult;
  };
  /** Whether the Order Board is open. */
  boardOpen(): boolean;
  /** Ground point of a POI zone, by id. */
  poiPosition(id: string): Vec3;
  /** Position of the HUB Order Board kiosk. */
  kiosk(): Vec3;
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
      return { position: { ...s.position }, velocity: { ...s.velocity }, mode: s.mode, onBoard: s.onBoard };
    },
    teleport(p) {
      game.teleport(p);
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
    orders: {
      board: () => structuredClone([...game.delivery.orders.board]),
      active: () => structuredClone([...game.delivery.orders.active]),
      totals: () => ({ ...game.delivery.orders.totals }),
      accept: (id) => game.delivery.accept(id),
    },
    boardOpen: () => game.delivery.modalOpen,
    poiPosition(id) {
      const p = game.map.pois.find((x) => x.id === id);
      if (!p) throw new Error(`unknown POI ${id}`);
      return { ...p.position };
    },
    kiosk: () => ({ ...game.map.hub.kiosk }),
  };
  window.__dm = api;
}
