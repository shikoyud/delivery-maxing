import type { MapData, Vec3 } from '@dm/shared';
import { slotColor } from '../render/waypoints';
import { el } from './dom';

/** An active order's current stop on the minimap, in the order's stable waypoint colour. */
export interface MinimapTarget {
  position: Vec3;
  colorIndex: number;
}

export interface MinimapOptions {
  /** Canvas edge (px). */
  sizePx: number;
  /** Metres of world visible from the player to the canvas edge. */
  viewRadius: number;
}

export const MINIMAP_DEFAULTS: MinimapOptions = { sizePx: 176, viewRadius: 70 };

/** Player-centred, north-up canvas point for a world position (the player sits at the centre). */
export function toMinimap(p: Vec3, player: Vec3, opts: MinimapOptions): { x: number; y: number } {
  const scale = opts.sizePx / (2 * opts.viewRadius);
  const half = opts.sizePx / 2;
  return { x: (p.x - player.x) * scale + half, y: (p.z - player.z) * scale + half };
}

/** Clamps a canvas point onto the square's edge (minus `margin`), so off-screen markers show their direction. */
export function clampToEdge(pt: { x: number; y: number }, sizePx: number, margin: number): { x: number; y: number; clamped: boolean } {
  const half = sizePx / 2;
  const dx = pt.x - half;
  const dy = pt.y - half;
  const limit = half - margin;
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  if (d <= limit) return { ...pt, clamped: false };
  const k = limit / d;
  return { x: half + dx * k, y: half + dy * k, clamped: true };
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/**
 * The always-on minimap, bottom right: a player-centred, north-up cut of the city. Buildings and hospital blocks are
 * boxes, hospitals a red cross, offer pickups hollow dots, each active order's current stop a dot in its waypoint
 * colour (clamped to the edge when out of range). Without a 2D context (tests) it draws nothing.
 */
export function createMinimap(
  host: HTMLElement,
  map: MapData,
  opts: MinimapOptions = MINIMAP_DEFAULTS,
): { el: HTMLElement; render(player: Vec3, heading: number, targets: MinimapTarget[], offerPickups: Vec3[]): void } {
  const root = el('div', 'minimap', host);
  const canvas = el('canvas', 'minimap-canvas', root);
  canvas.width = canvas.height = opts.sizePx;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  const scale = opts.sizePx / (2 * opts.viewRadius);
  // Solids worth drawing, with their half-sizes (rotation is ignored: close enough for the greybox map).
  const boxes = map.solids
    .filter((s) => s.kind === 'building' || s.kind === 'hospital' || s.kind === 'prop')
    .map((s) => ({ x: s.center.x, z: s.center.z, hx: s.size.x / 2, hz: s.size.z / 2 }));

  return {
    el: root,
    render(player, heading, targets, offerPickups) {
      if (!ctx) return;
      ctx.fillStyle = '#e9e6dc'; // ground
      ctx.fillRect(0, 0, opts.sizePx, opts.sizePx);

      ctx.fillStyle = '#8f9aa5'; // buildings
      const reach = opts.viewRadius;
      for (const b of boxes) {
        if (Math.abs(b.x - player.x) - b.hx > reach || Math.abs(b.z - player.z) - b.hz > reach) continue;
        const p = toMinimap({ x: b.x - b.hx, y: 0, z: b.z - b.hz }, player, opts);
        ctx.fillRect(p.x, p.y, b.hx * 2 * scale, b.hz * 2 * scale);
      }

      ctx.fillStyle = '#d63a3a'; // hospitals: red cross
      for (const h of map.hospitals) {
        const p = clampToEdge(toMinimap(h.center, player, opts), opts.sizePx, 8);
        if (p.clamped) continue; // hospitals only show while in range
        const arm = 7;
        ctx.fillRect(p.x - arm, p.y - arm / 3, arm * 2, (arm * 2) / 3);
        ctx.fillRect(p.x - arm / 3, p.y - arm, (arm * 2) / 3, arm * 2);
      }

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#444'; // offers' pickups: hollow dots
      for (const o of offerPickups) {
        const p = clampToEdge(toMinimap(o, player, opts), opts.sizePx, 8);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (const t of targets) {
        const p = clampToEdge(toMinimap(t.position, player, opts), opts.sizePx, 8);
        ctx.fillStyle = hex(slotColor(t.colorIndex));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.clamped ? 4 : 5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Player triangle at the centre; heading yaw has forward = (-sin, -cos) in (x, z), so north (-z) is up at 0.
      const half = opts.sizePx / 2;
      ctx.save();
      ctx.translate(half, half);
      ctx.rotate(-heading);
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(6, 6);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };
}
