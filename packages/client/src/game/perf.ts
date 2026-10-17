import type { Vec3 } from '@dm/shared';
import type { PerfConfig } from '../clientConfig';
import { mountPerfOverlay } from '../ui/perfOverlay';
import type { Game } from './Game';

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
  /** Index of the route entry being flown. */
  index: number;
  feet: Vec3;
  /** What the camera looks at: the entry's own target. */
  target: Vec3;
  /** The run's time is up (the pose stays at the end of the last entry). */
  done: boolean;
}

/** Seconds each route entry gets: the run split equally. */
export function legSeconds(seconds: number, entries: number): number {
  return seconds / entries;
}

/**
 * Where the flythrough is `elapsed` seconds into a `seconds`-long run: the run is split equally across the route
 * entries; each starts at its `feet` and glides horizontally toward its `target` at `speed` m/s (keeping its height, and
 * stopping at the target), looking at the target.
 */
export function viewpointAt(route: PerfConfig['route'], speed: number, seconds: number, elapsed: number): RoutePose {
  const share = legSeconds(seconds, route.length);
  const index = Math.min(route.length - 1, Math.max(0, Math.floor(elapsed / share)));
  const { feet, target } = route[index]!;
  const t = Math.min(share, Math.max(0, elapsed - index * share));
  const dx = target.x - feet.x;
  const dz = target.z - feet.z;
  const distance = Math.hypot(dx, dz);
  const glided = distance > 0 ? Math.min(speed * t, distance) / distance : 0;
  return {
    index,
    feet: { x: feet.x + dx * glided, y: feet.y, z: feet.z + dz * glided },
    target: { ...target },
    done: elapsed >= seconds,
  };
}

/** What the recorder holds when the run ends. */
export interface RecordedRun {
  overall: FrameSummary;
  /** One summary per route entry (zeros for an entry that got no counted frames). */
  perViewpoint: FrameSummary[];
  maxCalls: number;
  maxTriangles: number;
  /** The most draw calls and triangles of a counted frame, per route entry (zeros for an entry with none). */
  viewpointRender: { maxCalls: number; maxTriangles: number }[];
  /** p95 of CityView.update's wall-clock cost per frame (ms). */
  cityUpdateP95: number;
}

/** What the renderer reports about the frame just drawn. */
export interface FrameRender {
  calls: number;
  triangles: number;
  cityMs: number;
}

/**
 * Collects the frame times of a flythrough. `frame()` is called before each frame is drawn, so what it reads belongs to
 * the frame before. Frames up to `warmupMs` from the first call, and the first `skipFrames` frames drawn after each
 * teleport to another viewpoint (the jump itself), are not counted.
 */
export class PerfRecorder {
  private start: number | null = null;
  private prev = 0;
  private current = -1;
  private sinceJump = 0;
  private readonly all: number[] = [];
  private readonly byViewpoint: number[][];
  private readonly renderByViewpoint: { maxCalls: number; maxTriangles: number }[];
  private readonly city: number[] = [];
  private maxCalls = 0;
  private maxTriangles = 0;

  constructor(
    viewpoints: number,
    private readonly warmupMs: number,
    private readonly skipFrames: number,
  ) {
    this.byViewpoint = Array.from({ length: viewpoints }, () => []);
    this.renderByViewpoint = Array.from({ length: viewpoints }, () => ({ maxCalls: 0, maxTriangles: 0 }));
  }

  /** Frames counted so far. */
  get measured(): number {
    return this.all.length;
  }

  /** Milliseconds since the first call (0 before it). */
  elapsedMs(nowMs: number): number {
    return this.start === null ? 0 : nowMs - this.start;
  }

  /** `viewpoint` is the route entry about to be drawn (the one this call places the player at). */
  frame(nowMs: number, viewpoint: number, render: () => FrameRender): void {
    if (this.start === null) {
      this.start = nowMs;
    } else {
      const drawnAfterJump = this.sinceJump;
      this.sinceJump++;
      if (this.prev - this.start >= this.warmupMs && drawnAfterJump >= this.skipFrames) {
        const ms = nowMs - this.prev;
        const r = render();
        this.all.push(ms);
        this.byViewpoint[this.current]?.push(ms);
        this.city.push(r.cityMs);
        this.maxCalls = Math.max(this.maxCalls, r.calls);
        this.maxTriangles = Math.max(this.maxTriangles, r.triangles);
        const v = this.renderByViewpoint[this.current];
        if (v) {
          v.maxCalls = Math.max(v.maxCalls, r.calls);
          v.maxTriangles = Math.max(v.maxTriangles, r.triangles);
        }
      }
    }
    if (viewpoint !== this.current) {
      this.current = viewpoint;
      this.sinceJump = 0;
    }
    this.prev = nowMs;
  }

  result(): RecordedRun {
    return {
      overall: summarize(this.all),
      perViewpoint: this.byViewpoint.map(summarize),
      maxCalls: this.maxCalls,
      maxTriangles: this.maxTriangles,
      viewpointRender: this.renderByViewpoint.map((v) => ({ ...v })),
      cityUpdateP95: summarize(this.city).p95,
    };
  }
}

/** One route entry's own frame times, draw calls and triangles. */
export interface ViewpointResult {
  feet: Vec3;
  frames: number;
  p95Ms: number;
  maxDrawCalls: number;
  maxTriangles: number;
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
  /** Seconds each route entry was flown (seconds / entries). */
  viewpointSeconds: number;
  /** Wall-clock seconds the run actually took (longer than `seconds` when it had to wait for a first counted frame). */
  elapsedSeconds: number;
  /** The tab was hidden at some point during the run (browsers throttle hidden tabs: run it again). */
  hiddenDuringRun: boolean;
  /** The canvas drawing-buffer size in pixels (CSS size × pixelRatio). */
  canvas: { width: number; height: number };
  /** The run's own counting rules, from config perf (echoed here so a pasted result is self-explanatory). */
  warmupSeconds: number;
  teleportSkipFrames: number;
  /** Overall p95 must not exceed this (config perf.p95TargetMs) to pass. */
  p95TargetMs: number;
  /** Fewer counted frames than this (config perf.minFrames) is no result at all. */
  minFrames: number;
  tooFewFrames: boolean;
  /** Not tooFewFrames and p95Ms <= p95TargetMs. */
  pass: boolean;
  /** Frames in the overall statistics (after the warm-up and the post-teleport frames). */
  frames: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** 1000 / p95Ms. */
  fpsAtP95: number;
  maxDrawCalls: number;
  maxTriangles: number;
  /** The budgets in view (config graphics.drawCallBudget and triangleBudget) and whether every counted frame kept them. */
  drawCallBudget: number;
  triangleBudget: number;
  withinBudget: boolean;
  /** p95 of the wall-clock cost of CityView.update per frame (0 on the greybox). */
  cityUpdateP95Ms: number;
  /** CityView.stats() at the end of the run (instances drawn, block meshes shown, models loaded and missing); null on the greybox. */
  city: { instances: number; blocks: number; models: number; missing: number } | null;
  /** Pack models the loader holds at the end of the run (0 without public/packs/), still loading, and missing. */
  models: { loaded: number; loading: number; missing: number };
  /** p95 per route entry, in route order, so a slow district shows. */
  viewpoints: ViewpointResult[];
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
 * Flies the route: the run's `cfg.seconds` are split equally across its entries; each teleports the player to its
 * `feet` and glides toward its `target` at `cfg.speed` m/s with the chase camera following (input and the simulation
 * are off), timing every frame. Then shows the result panel.
 */
export function runPerf(game: Game, cfg: PerfConfig): Promise<PerfResult> {
  const overlay = mountPerfOverlay(game.host);
  const rec = new PerfRecorder(cfg.route.length, cfg.warmupSeconds * 1000, cfg.teleportSkipFrames);
  const readRender = (): FrameRender => ({ ...game.renderer.info(), cityMs: game.lastCityUpdateMs });

  let hidden = document.visibilityState === 'hidden';
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') hidden = true;
  };
  document.addEventListener('visibilitychange', onVisibility);
  const canvas = game.renderer.renderer.domElement;

  return new Promise((resolve, reject) => {
    const fail = (err: unknown): void => {
      game.frameDriver = null;
      document.removeEventListener('visibilitychange', onVisibility);
      console.error(err);
      overlay.error(err instanceof Error ? err.message : String(err));
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    // Called before each frame is drawn, so what the recorder reads belongs to the frame before.
    game.frameDriver = (nowMs) => {
      try {
        drive(nowMs);
      } catch (err) {
        fail(err);
      }
    };
    const drive = (nowMs: number): void => {
      const elapsed = rec.elapsedMs(nowMs) / 1000;
      const pose = viewpointAt(cfg.route, cfg.speed, cfg.seconds, elapsed);
      rec.frame(nowMs, pose.index, readRender);
      overlay.progress(elapsed, cfg.seconds);
      // A teleport each frame, which also keeps the chase camera snapped behind. The last one places the player at the
      // end of the route, however long the frame before it took.
      game.viewpoint(pose.feet, pose.target);
      // A run that was all warm-up (very slow frames) goes on until it has something to report.
      if (pose.done && rec.measured > 0) {
        game.frameDriver = null;
        document.removeEventListener('visibilitychange', onVisibility);
        const run = rec.result();
        const dpr = window.devicePixelRatio;
        const tooFewFrames = run.overall.frames < cfg.minFrames;
        const g = game.cfg.graphics;
        const models = game.models.stats();
        const result: PerfResult = {
          url: window.location.href,
          screen: { width: window.screen.width, height: window.screen.height, dpr },
          pixelRatio: game.renderer.renderer.getPixelRatio(),
          gpu: gpuRenderer(game.renderer.renderer.getContext()),
          seconds: cfg.seconds,
          viewpointSeconds: legSeconds(cfg.seconds, cfg.route.length),
          elapsedSeconds: elapsed,
          hiddenDuringRun: hidden,
          canvas: { width: canvas.width, height: canvas.height },
          warmupSeconds: cfg.warmupSeconds,
          teleportSkipFrames: cfg.teleportSkipFrames,
          p95TargetMs: cfg.p95TargetMs,
          minFrames: cfg.minFrames,
          tooFewFrames,
          pass: !tooFewFrames && run.overall.p95 <= cfg.p95TargetMs,
          frames: run.overall.frames,
          p50Ms: run.overall.p50,
          p95Ms: run.overall.p95,
          p99Ms: run.overall.p99,
          maxMs: run.overall.max,
          fpsAtP95: run.overall.p95 > 0 ? 1000 / run.overall.p95 : 0,
          maxDrawCalls: run.maxCalls,
          maxTriangles: run.maxTriangles,
          drawCallBudget: g.drawCallBudget,
          triangleBudget: g.triangleBudget,
          withinBudget: run.maxCalls <= g.drawCallBudget && run.maxTriangles <= g.triangleBudget,
          cityUpdateP95Ms: run.cityUpdateP95,
          city: game.cityView?.stats() ?? null,
          models: { loaded: models.loaded, loading: models.loading, missing: models.missing },
          viewpoints: run.perViewpoint.map((v, i) => ({
            feet: { ...cfg.route[i]!.feet },
            frames: v.frames,
            p95Ms: v.p95,
            maxDrawCalls: run.viewpointRender[i]!.maxCalls,
            maxTriangles: run.viewpointRender[i]!.maxTriangles,
          })),
        };
        overlay.show(result);
        resolve(result);
      }
    };
  });
}
