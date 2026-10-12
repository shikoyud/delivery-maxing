import type { MoveMode, Vec3 } from '@dm/shared';
import { el, setText } from './dom';

export interface OverlayStats {
  drawCalls: number;
  speed: number;
  mode: MoveMode;
  onBoard: boolean;
  tick: number;
  position: Vec3;
}

export interface DebugOverlay {
  toggle(): void;
  readonly visible: boolean;
  /** Call once per rendered frame with the wall clock (ms); the text refreshes a few times a second. */
  frame(nowMs: number, stats: () => OverlayStats): void;
}

const REFRESH_MS = 250;

/** F3 overlay: FPS, draw calls, speed, mode, onBoard, tick, position. DOM only (no draw calls). */
export function mountDebugOverlay(host: HTMLElement, visible: boolean): DebugOverlay {
  const root = el('pre', 'debug-overlay', host);
  root.hidden = !visible;
  let frames = 0;
  let since = 0;
  let fps = 0;
  return {
    toggle() {
      root.hidden = !root.hidden;
    },
    get visible() {
      return !root.hidden;
    },
    frame(nowMs, stats) {
      frames++;
      if (since === 0) since = nowMs;
      if (nowMs - since < REFRESH_MS) return;
      fps = (frames * 1000) / (nowMs - since);
      frames = 0;
      since = nowMs;
      if (root.hidden) return;
      const s = stats();
      const p = s.position;
      setText(
        root,
        [
          `fps    ${fps.toFixed(0)}`,
          `calls  ${s.drawCalls}`,
          `speed  ${s.speed.toFixed(2)} m/s`,
          `mode   ${s.mode}`,
          `board  ${s.onBoard}`,
          `tick   ${s.tick}`,
          `pos    ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
        ].join('\n'),
      );
    },
  };
}
