import type { MapData, RideTier, Vec3 } from '@dm/shared';
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

/** Fill colour of the hospital cross (minimap and Map app). */
export const HOSPITAL_ICON_COLOR = '#d63a3a';

/** Fill colour of a parked vehicle's body glyph (minimap and Map app, Decision 15). */
export const VEHICLE_ICON_COLOR = '#2f8f83';

/** A parked owned vehicle (HudModel.parked). */
export interface ParkedMarker {
  tier: RideTier;
  position: Vec3;
}

/** Body width and height of each tier's glyph, as shares of its size: the car a wide box, the two-wheelers slimmer. */
const GLYPH: Record<RideTier, { w: number; h: number }> = {
  car: { w: 1, h: 0.55 },
  motorbike: { w: 0.9, h: 0.32 },
  bicycle: { w: 0.85, h: 0.22 },
  skateboard: { w: 0.7, h: 0.18 },
};

/** A parked vehicle's glyph centred on (x, y), `size` px wide: a dark outline, the teal body and two dark wheels. */
export function drawVehicleIcon(ctx: CanvasRenderingContext2D, tier: RideTier, x: number, y: number, size: number): void {
  const g = GLYPH[tier];
  const w = size * g.w;
  const h = Math.max(2, size * g.h);
  const wheel = Math.max(2, size * 0.22);
  ctx.fillStyle = '#16323a';
  ctx.fillRect(x - w / 2 - 1, y - h / 2 - 1, w + 2, h + 2);
  ctx.fillRect(x - w / 2 + wheel * 0.3, y + h / 2 - 1, wheel, wheel * 0.8);
  ctx.fillRect(x + w / 2 - wheel * 1.3, y + h / 2 - 1, wheel, wheel * 0.8);
  ctx.fillStyle = VEHICLE_ICON_COLOR;
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
}

/** Fill colour of the gas-station fuel icon (minimap and Map app). */
export const FUEL_ICON_COLOR = '#f2a33a';

/** A fuel-pump icon centred on (x, y), `size` px tall: an amber pump with a light window and a hose arm. */
export function drawFuelIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const w = size * 0.6;
  ctx.fillStyle = '#16323a'; // outline, so it reads on ground and buildings alike
  ctx.fillRect(x - w / 2 - 1, y - size / 2 - 1, w + 2, size + 2);
  ctx.fillStyle = FUEL_ICON_COLOR;
  ctx.fillRect(x - w / 2, y - size / 2, w, size);
  ctx.fillStyle = '#f7f3ea';
  ctx.fillRect(x - w / 2 + 1.5, y - size / 2 + 1.5, w - 3, size * 0.3);
  ctx.fillStyle = '#16323a';
  ctx.fillRect(x + w / 2, y - size / 4, size * 0.2, 1.5);
  ctx.fillRect(x + w / 2 + size * 0.2 - 1.5, y - size / 4, 1.5, size * 0.5);
}

/**
 * The always-on minimap, bottom right: a player-centred, north-up cut of the city. Buildings and hospital blocks are
 * boxes, hospitals a red cross, gas stations a fuel icon, parked owned vehicles a vehicle glyph (clamped to the
 * edge when out of range, so a parked ride always shows its direction), offer pickups hollow dots, each active order's current stop a dot in its waypoint
 * colour (clamped to the edge when out of range). Without a 2D context (tests) it draws nothing.
 */
export function createMinimap(
  host: HTMLElement,
  map: MapData,
  opts: MinimapOptions = MINIMAP_DEFAULTS,
): {
  el: HTMLElement;
  render(player: Vec3, heading: number, targets: MinimapTarget[], offerPickups: Vec3[], parked?: readonly ParkedMarker[]): void;
} {
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
    render(player, heading, targets, offerPickups, parked = []) {
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

      ctx.fillStyle = HOSPITAL_ICON_COLOR; // hospitals: red cross
      for (const h of map.hospitals) {
        const p = clampToEdge(toMinimap(h.center, player, opts), opts.sizePx, 8);
        if (p.clamped) continue; // hospitals only show while in range
        const arm = 7;
        ctx.fillRect(p.x - arm, p.y - arm / 3, arm * 2, (arm * 2) / 3);
        ctx.fillRect(p.x - arm / 3, p.y - arm, (arm * 2) / 3, arm * 2);
      }

      for (const g of map.gasStations) {
        const p = clampToEdge(toMinimap(g.position, player, opts), opts.sizePx, 8);
        if (!p.clamped) drawFuelIcon(ctx, p.x, p.y, 12); // in range only, like the hospitals
      }

      for (const v of parked) {
        const p = clampToEdge(toMinimap(v.position, player, opts), opts.sizePx, 8);
        drawVehicleIcon(ctx, v.tier, p.x, p.y, p.clamped ? 10 : 14);
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
