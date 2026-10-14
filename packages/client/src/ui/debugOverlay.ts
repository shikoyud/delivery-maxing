import type { MoveMode, RideTier, Vec3 } from '@dm/shared';
import { el, setText } from './dom';

export interface OverlayStats {
  drawCalls: number;
  speed: number;
  mode: MoveMode;
  riding: RideTier | null;
  /** The ridden vehicle's tank (0..1), null on foot or on a ride without a tank. */
  fuel: number | null;
  sprinting: boolean;
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

/** The ride line: `ride: car · 21.4 m/s · fuel 73 %` (no fuel part without a tank), `ride: none` on foot. */
export function rideLine(riding: RideTier | null, speed: number, fuel: number | null): string {
  if (!riding) return 'ride: none';
  const parts = [`ride: ${riding}`, `${speed.toFixed(1)} m/s`];
  if (fuel !== null) parts.push(`fuel ${Math.round(fuel * 100)} %`);
  return parts.join(' · ');
}

/**
 * F3 overlay: FPS, draw calls, speed, mode, ride (vehicle, speed and fuel), sprint, tick, position. DOM only (no draw
 * calls); Game shows the access-zone volumes with it.
 */
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
          rideLine(s.riding, s.speed, s.fuel),
          `sprint ${s.sprinting ? ' on' : 'off'}`,
          `tick   ${s.tick}`,
          `pos    ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
        ].join('\n'),
      );
    },
  };
}
