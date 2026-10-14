import type { FakeDocument } from './fakeDom';

/** One stroked path: its points in canvas px, the line dash and the stroke colour when it was stroked. */
export interface Stroke {
  points: { x: number; y: number }[];
  dash: number[];
  style: string;
}

/** One filled rectangle and the fill colour it used. */
export interface FilledRect {
  x: number;
  y: number;
  w: number;
  h: number;
  style: string;
}

/**
 * A 2D context stand-in recording strokes and filled rectangles (the rest of the API is a no-op), for canvas
 * views tested on the fake DOM.
 */
export function recordingContext(): { ctx: CanvasRenderingContext2D; strokes: Stroke[]; rects: FilledRect[] } {
  const strokes: Stroke[] = [];
  const rects: FilledRect[] = [];
  let path: { x: number; y: number }[] = [];
  let dash: number[] = [];
  const state = {
    fillStyle: '' as string,
    strokeStyle: '' as string,
    beginPath: () => void (path = []),
    moveTo: (x: number, y: number) => void path.push({ x, y }),
    lineTo: (x: number, y: number) => void path.push({ x, y }),
    setLineDash: (d: number[]) => void (dash = [...d]),
    getLineDash: () => [...dash],
    stroke: () => void strokes.push({ points: [...path], dash: [...dash], style: state.strokeStyle }),
    fillRect: (x: number, y: number, w: number, h: number) => void rects.push({ x, y, w, h, style: state.fillStyle }),
  };
  const ctx = new Proxy(state as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : () => undefined),
    set: (t, k, v) => ((t[k] = v), true),
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes, rects };
}

/** Gives every canvas the fake document creates a recording 2D context (all share `rec`). */
export function recordCanvases(doc: FakeDocument): ReturnType<typeof recordingContext> {
  const rec = recordingContext();
  const create = doc.createElement.bind(doc);
  doc.createElement = (tag: string) => {
    const e = create(tag);
    if (tag === 'canvas') Object.assign(e, { width: 0, height: 0, getContext: () => rec.ctx });
    return e;
  };
  return rec;
}
