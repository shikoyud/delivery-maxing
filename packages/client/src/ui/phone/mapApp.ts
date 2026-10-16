import type { CityMap, MapData, Solid, Vec3 } from '@dm/shared';
import { slotColor } from '../../render/waypoints';
import type { HudModel } from '../hudModel';
import { el } from '../dom';
import { drawFuelIcon, drawVehicleIcon, HOSPITAL_ICON_COLOR } from '../minimap';
import type { MapProjection } from './mapProjection';

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

const GROUND = '#e9e6dc';
const BUILDING = '#8f9aa5';
const WATER = '#9cc3d5';
const ROAD = '#b9b4a8';
/** City ground by level, lowest first (the harbour at y 2 up to the ridge at y 48): each terrace a shade greener. */
const LEVEL_TINTS = ['#ece4cf', '#e9e6dc', '#dfe4d3', '#d5dfc8', '#cad6bb'];
/** City areas drawn over the ground (the rest stay ground-coloured). */
const AREA_FILL: Partial<Record<string, string>> = {
  sand: '#eedca9',
  marina: WATER,
  park: '#c9dcb2',
  sports: '#bfd6a6',
  plaza: '#e2dbc9',
  parking: '#cfcbc2',
  quay: '#d8d2c4',
  containerYard: '#cdc6b6',
  pier: '#c4ab84',
  boardwalk: '#c4ab84',
  breakwater: '#b3aea4',
};

/** The level tint for ground whose top is at `y`: the nearest level's (`levels` sorted by height). */
export function levelTint(y: number, levels: readonly number[]): string {
  let best = 0;
  levels.forEach((ly, i) => {
    if (Math.abs(ly - y) < Math.abs(levels[best]! - y)) best = i;
  });
  return LEVEL_TINTS[Math.min(best, LEVEL_TINTS.length - 1)]!;
}

/**
 * The phone's Map app: a top-down canvas of the map. The static art is drawn once to an offscreen whole-map layer:
 * on the greybox the ground and buildings; on the city the sea, each level's ground tinted by its height, the
 * districts' areas (sand, parks, quays, the marina), the roads and the buildings. The hospitals, gas stations (fuel
 * icons), parked owned vehicles, offers, routes, targets and player are redrawn per render. On the city the view is a
 * window centred on the player (MapProjection.pan); on the greybox the whole map. Each active order's route for the
 * current tier is a solid line and its foot leg to the door dashed, in the order's colour (a straight line when it
 * has no route). `colorIndex` gives an order's stable colour (as its 3D waypoint).
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
    c.width = c.height = proj.layerPx;
    const g = typeof c.getContext === 'function' ? c.getContext('2d') : null;
    if (!g) return null;
    const rect = (minX: number, minZ: number, maxX: number, maxZ: number): void => {
      const a = proj.toLayer({ x: minX, y: 0, z: minZ });
      g.fillRect(a.x, a.y, (maxX - minX) * proj.scale, (maxZ - minZ) * proj.scale);
    };
    const solid = (s: Solid): void => rect(s.center.x - s.size.x / 2, s.center.z - s.size.z / 2, s.center.x + s.size.x / 2, s.center.z + s.size.z / 2);
    if (map.kind === 'city') {
      const { layout } = map as CityMap;
      const levels = Object.values(layout.levels)
        .map((l) => l.y)
        .sort((a, b) => a - b);
      g.fillStyle = WATER; // the sea, under everything
      g.fillRect(0, 0, c.width, c.height);
      for (const s of map.solids) {
        if (s.kind !== 'ground' && s.kind !== 'terrain') continue;
        g.fillStyle = levelTint(s.center.y + s.size.y / 2, levels);
        solid(s);
      }
      for (const a of layout.areas) {
        const fill = AREA_FILL[a.kind];
        if (!fill) continue;
        g.fillStyle = fill;
        rect(a.rect.minX, a.rect.minZ, a.rect.maxX, a.rect.maxZ);
      }
      g.fillStyle = ROAD;
      for (const r of layout.roads) rect(r.rect.minX, r.rect.minZ, r.rect.maxX, r.rect.maxZ);
      for (const s of map.solids) if (s.kind === 'road' || s.kind === 'ramp' || s.kind === 'stairs') solid(s);
      g.strokeStyle = ROAD;
      for (const r of layout.curvedRoads) {
        g.lineWidth = Math.max(2, r.width * proj.scale);
        g.beginPath();
        r.polyline.forEach((w, i) => {
          const p = proj.toLayer(w);
          if (i === 0) g.moveTo(p.x, p.y);
          else g.lineTo(p.x, p.y);
        });
        g.stroke();
      }
    } else {
      g.fillStyle = GROUND;
      g.fillRect(0, 0, c.width, c.height);
    }
    g.fillStyle = BUILDING;
    for (const s of map.solids) if (s.kind === 'building') solid(s);
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
      proj.pan(player);
      layer ??= buildLayer();
      if (proj.panned) {
        ctx.fillStyle = WATER; // beyond the map's edge
        ctx.fillRect(0, 0, proj.canvasPx, proj.canvasPx);
      }
      const off = proj.layerOffset;
      if (layer) ctx.drawImage(layer, -off.x, -off.y);

      ctx.fillStyle = HOSPITAL_ICON_COLOR; // hospitals: red cross
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

      for (const v of model.parked) {
        const p = proj.toCanvas(v.position);
        drawVehicleIcon(ctx, v.tier, p.x, p.y, 16);
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
