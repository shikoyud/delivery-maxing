import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expandGreybox, type GreyboxSource } from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { FUEL_ICON_COLOR, VEHICLE_ICON_COLOR, MINIMAP_DEFAULTS, clampToEdge, createMinimap, toMinimap } from '../src/ui/minimap';
import { recordCanvases } from './canvasRecorder';
import { installFakeDom } from './fakeDom';

const opts = { sizePx: 200, viewRadius: 50 }; // 2 px per metre, centre at (100, 100)

describe('minimap projection', () => {
  it('is player-centred and north-up: the player maps to the centre, +x east, -z up', () => {
    const player = { x: 30, y: 0, z: -20 };
    expect(toMinimap(player, player, opts)).toEqual({ x: 100, y: 100 });
    expect(toMinimap({ x: 40, y: 0, z: -20 }, player, opts)).toEqual({ x: 120, y: 100 });
    expect(toMinimap({ x: 30, y: 5, z: -45 }, player, opts)).toEqual({ x: 100, y: 50 });
  });

  it('clampToEdge keeps in-range points and pins far ones to the edge, keeping their direction', () => {
    expect(clampToEdge({ x: 130, y: 100 }, 200, 8)).toEqual({ x: 130, y: 100, clamped: false });
    const far = clampToEdge(toMinimap({ x: 0, y: 0, z: 500 }, { x: 0, y: 0, z: 0 }, opts), opts.sizePx, 8);
    expect(far.clamped).toBe(true);
    expect(far).toMatchObject({ x: 100, y: 192 }); // straight south, pinned 8 px off the edge
  });
});

describe('createMinimap', () => {
  let dom: ReturnType<typeof installFakeDom>;
  beforeEach(() => {
    dom = installFakeDom();
  });
  afterEach(() => dom.restore());

  it('mounts a canvas of the default size and renders without a 2D context (fake DOM) without crashing', () => {
    const map = expandGreybox(greybox as GreyboxSource);
    const mini = createMinimap(dom.asHost, map);
    expect(dom.host.byClass('minimap')).toHaveLength(1);
    const canvas = dom.host.byClass('minimap-canvas')[0] as unknown as HTMLCanvasElement;
    expect(canvas.width).toBe(MINIMAP_DEFAULTS.sizePx);
    mini.render({ x: 0, y: 0, z: 0 }, 0.5, [{ position: { x: 10, y: 0, z: 10 }, colorIndex: 1 }], [{ x: 5, y: 0, z: -5 }]);
  });

  it('shows gas stations in range as fuel icons', () => {
    const rec = recordCanvases(dom.doc);
    const map = expandGreybox(greybox as GreyboxSource);
    const g = map.gasStations[0]!;
    const mini = createMinimap(dom.asHost, map);
    const player = { x: g.position.x + 10, y: 0, z: g.position.z };
    mini.render(player, 0, [], []);
    const c = toMinimap(g.position, player, MINIMAP_DEFAULTS);
    const hit = rec.rects.some((r) => r.style === FUEL_ICON_COLOR && Math.abs(r.x + r.w / 2 - c.x) < 8 && Math.abs(r.y + r.h / 2 - c.y) < 8);
    expect(hit).toBe(true);
  });

  it('a parked motorbike 50 m away is drawn inside the ring; one 300 m away is clamped to the edge (Decision 15)', () => {
    const rec = recordCanvases(dom.doc);
    const map = expandGreybox(greybox as GreyboxSource);
    const mini = createMinimap(dom.asHost, map);
    const player = { x: 0, y: 0, z: 0 };
    const size = MINIMAP_DEFAULTS.sizePx;
    const glyphs = () => rec.rects.filter((r) => r.style === VEHICLE_ICON_COLOR);
    const centre = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

    mini.render(player, 0, [], [], [{ tier: 'motorbike', position: { x: 50, y: 0, z: 0 } }]);
    expect(glyphs()).toHaveLength(1);
    const inside = centre(glyphs()[0]!);
    const want = toMinimap({ x: 50, y: 0, z: 0 }, player, MINIMAP_DEFAULTS);
    expect(inside.x).toBeCloseTo(want.x, 0);
    expect(inside.y).toBeCloseTo(want.y, 0);
    expect(inside.x).toBeLessThan(size - 8);

    rec.rects.length = 0;
    mini.render(player, 0, [], [], [{ tier: 'motorbike', position: { x: 0, y: 0, z: -300 } }]);
    expect(glyphs()).toHaveLength(1);
    const edge = centre(glyphs()[0]!);
    const pinned = clampToEdge(toMinimap({ x: 0, y: 0, z: -300 }, player, MINIMAP_DEFAULTS), size, 8);
    expect(pinned.clamped).toBe(true);
    expect(edge.x).toBeCloseTo(pinned.x, 0);
    expect(edge.y).toBeCloseTo(pinned.y, 0); // north, 8 px off the edge
  });
});
