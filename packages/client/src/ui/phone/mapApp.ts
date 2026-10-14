import type { MapData, Vec3 } from '@dm/shared';
import { slotColor } from '../../render/waypoints';
import type { HudModel } from '../hudModel';
import { el } from '../dom';
import { drawFuelIcon } from '../minimap';
import type { MapProjection } from './mapProjection';

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/**
 * The phone's Map app: a top-down canvas of the city. Buildings are drawn once to an offscreen layer; the hospitals,
 * gas stations (fuel icons), offers, routes, targets and player are redrawn per render. Each active order's route for
 * the current tier is a solid line and its foot leg to the door dashed, in the order's colour (a straight line when
 * it has no route). `colorIndex` gives an order's stable colour (as its 3D waypoint).
 * Without a 2D context (tests) it draws nothing.
 */
export function createMapApp(
  map: MapData,
  proj: MapProjection,
  colorIndex: (orderId: string) => number = () => 0,
): { el: HTMLElement; render(model: HudModel, player: Vec3, heading: number): void } {
  const root = el('section', 'phone-app phone-map');
  const canvas = el('canvas', 'phone-map-canvas', root);
  canvas.width = canvas.height = proj.canvasPx;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  let layer: HTMLCanvasElement | null = null;

  function buildLayer(): HTMLCanvasElement | null {
    const c = document.createElement('canvas');
    c.width = c.height = proj.canvasPx;
    const g = typeof c.getContext === 'function' ? c.getContext('2d') : null;
    if (!g) return null;
    g.fillStyle = '#e9e6dc'; // ground
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#8f9aa5'; // buildings
    for (const s of map.solids) {
      if (s.kind !== 'building') continue;
      const a = proj.toCanvas({ x: s.center.x - s.size.x / 2, y: 0, z: s.center.z - s.size.z / 2 });
      g.fillRect(a.x, a.y, s.size.x * proj.scale, s.size.z * proj.scale);
    }
    return c;
  }

  /** Strokes the world points as one path. */
  function polyline(points: readonly Vec3[]): void {
    if (!ctx || points.length < 2) return;
    ctx.beginPath();
    points.forEach((w, i) => {
      const p = proj.toCanvas(w);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }

  return {
    el: root,
    render(model, player, heading) {
      if (!ctx) return;
      layer ??= buildLayer();
      if (layer) ctx.drawImage(layer, 0, 0);

      ctx.fillStyle = '#d63a3a'; // hospitals: red cross
      const arm = Math.max(2, 3 * proj.scale * 2);
      for (const h of map.hospitals) {
        const p = proj.toCanvas(h.center);
        ctx.fillRect(p.x - arm, p.y - arm / 3, arm * 2, (arm * 2) / 3);
        ctx.fillRect(p.x - arm / 3, p.y - arm, (arm * 2) / 3, arm * 2);
      }

      for (const g of map.gasStations) {
        const p = proj.toCanvas(g.position);
        drawFuelIcon(ctx, p.x, p.y, 12);
      }

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#444'; // offers' pickups: hollow dots
      for (const o of model.offers) {
        const p = proj.toCanvas(o.pickup);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      const me = proj.toCanvas(player);
      for (const o of model.orders) {
        const col = hex(slotColor(colorIndex(o.id)));
        const t = proj.toCanvas(o.target);
        ctx.strokeStyle = col;
        ctx.lineWidth = 3;
        if (o.route) {
          polyline(o.route.drive);
          if (o.route.footLeg) {
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 4]);
            polyline(o.route.footLeg);
            ctx.setLineDash([]);
          }
        } else {
          ctx.beginPath(); // no route (unreachable for this tier): a straight line
          ctx.moveTo(me.x, me.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
        }
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Player triangle; heading is yaw with forward = (-sin, -cos) in (x, z), so north (-z) is up at heading 0.
      ctx.save();
      ctx.translate(me.x, me.y);
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
