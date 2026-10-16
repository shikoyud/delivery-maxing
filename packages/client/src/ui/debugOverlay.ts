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
  /** The city's streaming: loaded collider chunks, CityView.stats and the CityView.update cost; absent on the greybox. */
  city?: CityOverlayStats;
}

/** The city lines' inputs (each null when it does not apply). */
export interface CityOverlayStats {
  chunks: number | null;
  city: { instances: number; blocks: number; models: number; missing: number } | null;
  /** Smoothed milliseconds per CityView.update. */
  cityUpdateMs: number | null;
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

/** `chunks 12`, `city   840 inst · 31 blocks · 22 models · 3 missing`, `cityUp 0.44 ms`; only the parts that apply. */
export function cityLines(c: CityOverlayStats): string[] {
  const out: string[] = [];
  if (c.chunks !== null) out.push(`chunks ${c.chunks}`);
  if (c.city) out.push(`city   ${c.city.instances} inst · ${c.city.blocks} blocks · ${c.city.models} models · ${c.city.missing} missing`);
  if (c.cityUpdateMs !== null) out.push(`cityUp ${c.cityUpdateMs.toFixed(2)} ms`);
  return out;
}

/**
 * F3 overlay: FPS, draw calls, speed, mode, ride (vehicle, speed and fuel), sprint, tick, position, and on the city
 * the loaded collider chunks, the CityView stats and its update cost. DOM only (no draw
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
          ...(s.city ? cityLines(s.city) : []),
        ].join('\n'),
      );
    },
  };
}
