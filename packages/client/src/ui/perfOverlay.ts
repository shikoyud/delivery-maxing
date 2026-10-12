import type { PerfResult } from '../game/perf';
import { el, setText } from './dom';

export interface PerfOverlay {
  /** The run is `elapsed` of `total` seconds in (refreshed a couple of times a second, to stay out of the timings). */
  progress(elapsed: number, total: number): void;
  /** Replaces the running message with the result and a "Copy result" button. */
  show(result: PerfResult): void;
}

const PROGRESS_MS = 500;

const ms = (v: number): string => `${v.toFixed(1)} ms`;

/** The ?perf=1 panel: a running message, then the frame-time summary, the JSON to paste and a copy button. */
export function mountPerfOverlay(host: HTMLElement, opts: { warmupSeconds: number }): PerfOverlay {
  const root = el('div', 'perf-overlay', host);
  const title = el('h2', 'perf-title', root);
  const lines = el('pre', 'perf-lines', root);
  setText(title, 'Perf flythrough');
  let lastProgress = -Infinity;
  return {
    progress(elapsed, total) {
      const now = performance.now();
      if (now - lastProgress < PROGRESS_MS) return;
      lastProgress = now;
      setText(lines, `Running ${Math.min(elapsed, total).toFixed(0)} / ${total} s. Input is ignored. Leave the tab in front.`);
    },
    show(r) {
      document.exitPointerLock(); // a locked pointer can't click the button
      setText(title, `Perf result: ${r.fpsAtP95.toFixed(1)} fps at p95`);
      setText(
        lines,
        [
          `p50 ${ms(r.p50Ms)}   p95 ${ms(r.p95Ms)}   p99 ${ms(r.p99Ms)}   max ${ms(r.maxMs)}`,
          `fps at p95  ${r.fpsAtP95.toFixed(1)}   (target: p95 <= 16.7 ms)`,
          `max draw calls ${r.maxDrawCalls}   max triangles ${r.maxTriangles}`,
          `city update p95 ${ms(r.cityUpdateP95Ms)}`,
          `GPU ${r.gpu}`,
          `${r.frames} frames over ${r.seconds} s; the first ${opts.warmupSeconds} s (warm-up) is left out.`,
        ].join('\n'),
      );
      const json = el('pre', 'perf-json', root);
      json.textContent = JSON.stringify(r, null, 2);
      const copy = el('button', 'perf-copy', root);
      copy.type = 'button';
      copy.textContent = 'Copy result';
      copy.addEventListener('click', () => {
        const select = (): void => {
          const range = document.createRange();
          range.selectNodeContents(json);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        };
        const text = json.textContent ?? '';
        const fallback = (): void => {
          select();
          copy.textContent = 'Press Ctrl+C to copy the selection';
        };
        if (!navigator.clipboard) {
          fallback();
          return;
        }
        navigator.clipboard.writeText(text).then(() => {
          copy.textContent = 'Copied';
        }, fallback);
      });
    },
  };
}
