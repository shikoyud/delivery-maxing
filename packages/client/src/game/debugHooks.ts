import type { MoveMode, Vec3 } from '@dm/shared';
import type { Game } from './Game';

/** Test and debugging API on window.__dm, installed only with ?debug. */
export interface DebugApi {
  /** True once the first frame has been drawn. */
  readonly ready: boolean;
  readonly tick: number;
  player(): { position: Vec3; velocity: Vec3; mode: MoveMode; onBoard: boolean };
  teleport(p: Vec3): void;
  renderInfo(): { calls: number; triangles: number };
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
    renderInfo() {
      return game.renderer.info();
    },
  };
  window.__dm = api;
}
