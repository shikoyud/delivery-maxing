import type { Vec3 } from '@dm/shared';
import type { PerfConfig } from '../clientConfig';
import { mountPerfOverlay } from '../ui/perfOverlay';
import type { Game } from './Game';

/** Frames in this many seconds from the start are left out of the statistics (shader compiles, first uploads). */
export const WARMUP_SECONDS = 1;

export interface FrameSummary {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  frames: number;
}

/** Nearest-rank percentile of an ascending list (rank = ceil(p/100 · n)). */
function nearestRank(sorted: readonly number[], percent: number): number {
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((percent / 100) * sorted.length)));
  return sorted[rank - 1]!;
}

/** Frame times (ms) summarised as nearest-rank p50, p95 and p99, the maximum and the frame count. Zeros for no frames. */
export function summarize(frameMs: readonly number[]): FrameSummary {
  if (frameMs.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0, frames: 0 };
  const sorted = [...frameMs].sort((a, b) => a - b);
  return {
    p50: nearestRank(sorted, 50),
    p95: nearestRank(sorted, 95),
    p99: nearestRank(sorted, 99),
    max: sorted[sorted.length - 1]!,
    frames: sorted.length,
  };
}

export interface RoutePose {
  feet: Vec3;
  /** What the camera looks at: the target of the leg being travelled. */
  target: Vec3;
  /** The end of the route has been reached (the pose stays on the last stop). */
  done: boolean;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Total length of the route's straight legs (m). */
export function routeLength(route: PerfConfig['route']): number {
  let total = 0;
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i]!.feet;
    const b = route[i + 1]!.feet;
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return total;
}

/**
 * Where a glide along the route's `feet` points (straight legs, in order) is after travelling `distance` metres, looking
 * at the target of the leg's first stop. The last stop looks at its own target.
 */
export function routeAt(route: PerfConfig['route'], distance: number): RoutePose {
  let left = Math.max(0, distance);
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    const length = Math.hypot(b.feet.x - a.feet.x, b.feet.y - a.feet.y, b.feet.z - a.feet.z);
    if (left < length) {
      const t = left / length;
      const feet = { x: lerp(a.feet.x, b.feet.x, t), y: lerp(a.feet.y, b.feet.y, t), z: lerp(a.feet.z, b.feet.z, t) };
      return { feet, target: { ...a.target }, done: false };
    }
    left -= length;
  }
  const last = route[route.length - 1]!;
  return { feet: { ...last.feet }, target: { ...last.target }, done: true };
}

/** What a flythrough measured, plus where and on what (all of it goes into the pasted JSON). */
export interface PerfResult {
  url: string;
  screen: { width: number; height: number; dpr: number };
  /** The pixel ratio the renderer used (devicePixelRatio capped by graphics.maxPixelRatio). */
  pixelRatio: number;
  /** WEBGL_debug_renderer_info's unmasked renderer, or "unknown". */
  gpu: string;
  seconds: number;
  warmupSeconds: number;
  /** Route metres actually glided (the run ends at `seconds`, wherever on the route that is). */
  metresGlided: number;
  /** Frames in the statistics (after the warm-up). */
  frames: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** 1000 / p95Ms. */
  fpsAtP95: number;
  maxDrawCalls: number;
  maxTriangles: number;
  /** p95 of the wall-clock cost of CityView.update per frame (0 on the greybox). */
  cityUpdateP95Ms: number;
}

function gpuRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Glides the player along `cfg.route` at `cfg.speed` m/s for `cfg.seconds` (the chase camera follows; input and the
 * simulation are off), timing every frame, then shows the result panel. The first WARMUP_SECONDS are left out.
 */
export function runPerf(game: Game, cfg: PerfConfig): Promise<PerfResult> {
  const overlay = mountPerfOverlay(game.host, { warmupSeconds: WARMUP_SECONDS });
  const frameMs: number[] = [];
  const cityMs: number[] = [];
  let maxCalls = 0;
  let maxTriangles = 0;
  let startMs: number | null = null;
  let prevMs = 0;

  const glide = (elapsedSeconds: number): void => {
    const pose = routeAt(cfg.route, elapsedSeconds * cfg.speed);
    game.viewpoint(pose.feet, pose.target);
  };

  return new Promise((resolve) => {
    // Called before each frame is drawn, so what it reads (interval, render info, city cost) belongs to the frame before.
    game.frameDriver = (nowMs) => {
      if (startMs === null) {
        startMs = nowMs;
      } else if (prevMs - startMs >= WARMUP_SECONDS * 1000) {
        frameMs.push(nowMs - prevMs);
        cityMs.push(game.cityUpdateMs);
        const info = game.renderer.info();
        maxCalls = Math.max(maxCalls, info.calls);
        maxTriangles = Math.max(maxTriangles, info.triangles);
      }
      prevMs = nowMs;
      const elapsed = (nowMs - startMs) / 1000;
      overlay.progress(elapsed, cfg.seconds);
      if (elapsed >= cfg.seconds) {
        game.frameDriver = null;
        const frames = summarize(frameMs);
        const dpr = window.devicePixelRatio;
        const result: PerfResult = {
          url: window.location.href,
          screen: { width: window.screen.width, height: window.screen.height, dpr },
          pixelRatio: game.renderer.renderer.getPixelRatio(),
          gpu: gpuRenderer(game.renderer.renderer.getContext()),
          seconds: cfg.seconds,
          warmupSeconds: WARMUP_SECONDS,
          metresGlided: Math.round(Math.min(cfg.seconds * cfg.speed, routeLength(cfg.route))),
          frames: frames.frames,
          p50Ms: frames.p50,
          p95Ms: frames.p95,
          p99Ms: frames.p99,
          maxMs: frames.max,
          fpsAtP95: frames.p95 > 0 ? 1000 / frames.p95 : 0,
          maxDrawCalls: maxCalls,
          maxTriangles,
          cityUpdateP95Ms: summarize(cityMs).p95,
        };
        overlay.show(result);
        resolve(result);
        return;
      }
      glide(elapsed);
    };
    glide(0);
  });
}
