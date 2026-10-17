import type { CityMap, MapData, Solid, Vec3 } from '@dm/shared';
import { clientConfig } from '../../clientConfig';
import { slotColor } from '../../render/waypoints';
import type { HudModel } from '../hudModel';
import { el, keyLabel } from '../dom';
import { drawFuelIcon, drawVehicleIcon, FUEL_ICON_COLOR, HOSPITAL_ICON_COLOR, VEHICLE_ICON_COLOR } from '../minimap';
import { MapProjection } from './mapProjection';
import { MapView } from './mapView';

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

const GROUND = '#e9e6dc';
const BUILDING = '#8f9aa5';
const WATER = '#9cc3d5';
const ROAD = '#b9b4a8';
const PLAYER = '#111';
const OFFER = '#444';
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

/** Marker sizes in screen px: fixed, so they read the same at every zoom. */
const PX = { crossArm: 7, fuel: 14, vehicle: 18, offer: 5, target: 6, player: 10, route: 3, footLeg: 2 };

/** The legend's rows: label and swatch shape, with the marker colour. */
const LEGEND: { label: string; shape: string; color: string }[] = [
  { label: 'You', shape: 'player', color: PLAYER },
  { label: 'Orders', shape: 'dot', color: hex(slotColor(0)) },
  { label: 'Offers', shape: 'ring', color: OFFER },
  { label: 'Hospitals', shape: 'cross', color: HOSPITAL_ICON_COLOR },
  { label: 'Gas stations', shape: 'fuel', color: FUEL_ICON_COLOR },
  { label: 'Your vehicles', shape: 'vehicle', color: VEHICLE_ICON_COLOR },
];

/** The level tint for ground whose top is at `y`: the nearest level's (`levels` sorted by height). */
export function levelTint(y: number, levels: readonly number[]): string {
  let best = 0;
  levels.forEach((ly, i) => {
    if (Math.abs(ly - y) < Math.abs(levels[best]! - y)) best = i;
  });
  return LEVEL_TINTS[Math.min(best, LEVEL_TINTS.length - 1)]!;
}

/** What DeliveryLoop needs from the map screen (tests pass a recorder). */
export interface MapScreenView {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  render(model: HudModel, player: Vec3, heading: number): void;
}

export interface MapScreenOptions {
  /** Keys that close the screen while it is open (Esc and the map key); caught before the game's input sees them. */
  closeCodes: string[];
  /** The screen was closed (a close key or close()). */
  closed(): void;
}

/**
 * The full-screen map (M, Decision 11): the whole map fitted to the window on every open, wheel zoom toward the cursor
 * (1× to ui.map.maxZoom, ui.map.wheelStep per notch), drag to pan, and a legend. The static art is drawn once to an
 * offscreen layer `min(4096, size × 3)` px wide and blitted scaled per frame: on the greybox the ground and
 * buildings; on the city the sea, each level's ground tinted by its height, the districts' areas, the roads and the
 * buildings. The markers are drawn over it in screen space at a fixed pixel size: hospitals (red cross), gas stations
 * (fuel icons), parked owned vehicles, offers' pickups (hollow dots), each active order's route for the current tier
 * (solid, the foot leg dashed, in the order's colour; a straight line when it has no route) and stop, and the player.
 * `colorIndex` gives an order's stable colour (as its 3D waypoint). Without a 2D context (tests) it draws nothing.
 */
export class MapScreen implements MapScreenView {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly proj: MapProjection;
  private layer: HTMLCanvasElement | null | undefined;
  private view_: MapView;
  private viewport = { w: 0, h: 0 };
  private open_ = false;
  private last: { model: HudModel; player: Vec3; heading: number } | null = null;
  /** The pointer's last client position while the left button drags the map. */
  private drag: { x: number; y: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly map: MapData,
    private readonly colorIndex: (id: string) => number = () => 0,
    private readonly opts: MapScreenOptions = { closeCodes: ['Escape'], closed: () => undefined },
  ) {
    this.root = el('div', 'map-screen', host);
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Map');
    this.canvas = el('canvas', 'map-screen-canvas', this.root);
    this.ctx = typeof this.canvas.getContext === 'function' ? this.canvas.getContext('2d') : null;
    this.proj = MapProjection.forMap(map);
    this.view_ = this.makeView();

    const legend = el('div', 'map-legend', this.root);
    for (const row of LEGEND) {
      const item = el('div', 'map-legend-item', legend);
      const sw = el('span', `map-legend-swatch map-legend-${row.shape}`, item);
      sw.style.setProperty('--swatch', row.color);
      el('span', 'map-legend-label', item).textContent = row.label;
    }
    const keys = opts.closeCodes.map((c) => (c === 'Escape' ? 'Esc' : keyLabel(c))).join(' or ');
    el('div', 'map-screen-footer', this.root).textContent = `Wheel to zoom · drag to pan · ${keys} to close`;

    this.canvas.addEventListener('wheel', (e) => {
      const w = e as WheelEvent;
      w.preventDefault();
      if (!w.deltaY) return;
      const step = clientConfig.ui.map.wheelStep;
      this.view_.zoomAt(w.deltaY < 0 ? step : 1 / step, this.point(w));
      this.draw();
    });
    this.canvas.addEventListener('mousedown', (e) => {
      const m = e as MouseEvent;
      if (m.button !== 0) return;
      m.preventDefault?.();
      this.drag = { x: m.clientX, y: m.clientY };
      this.root.classList.add('dragging');
    });
    const doc = host.ownerDocument;
    doc.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      const m = e as MouseEvent;
      this.view_.panBy(m.clientX - this.drag.x, m.clientY - this.drag.y);
      this.drag = { x: m.clientX, y: m.clientY };
      this.draw();
    });
    doc.addEventListener('mouseup', () => this.endDrag());
    // A resized window refits the map to it.
    doc.defaultView?.addEventListener('resize', () => {
      if (!this.open_) return;
      this.view_ = this.makeView();
      this.draw();
    });
    // Capture phase on the document runs before InputManager's window listener (as the phone's close keys), so M
    // closing the map does not also reach the game and open it straight back.
    doc.addEventListener(
      'keydown',
      (e) => {
        const k = e as KeyboardEvent;
        if (!this.open_ || !this.opts.closeCodes.includes(k.code)) return;
        k.preventDefault();
        k.stopPropagation();
        if (!k.repeat) this.close();
      },
      true,
    );
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /** The zoom and pan (tests and the debug API read it). */
  get view(): MapView {
    return this.view_;
  }

  /** Edge of the static layer (px). */
  get layerPx(): number {
    return this.proj.layerPx;
  }

  /** Shows the screen with the whole map fitted to the window. */
  open(): void {
    this.open_ = true;
    this.root.hidden = false;
    this.view_ = this.makeView();
    if (this.last) this.draw();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.root.hidden = true;
    this.endDrag();
    this.last = null;
    this.opts.closed();
  }

  /** Draws the map with `model`'s markers (DeliveryLoop calls this at the HUD rate while open). */
  render(model: HudModel, player: Vec3, heading: number): void {
    this.last = { model, player, heading };
    if (this.open_) this.draw();
  }

  private endDrag(): void {
    this.drag = null;
    this.root.classList.remove('dragging');
  }

  /** A pointer event's position on the canvas (CSS px). */
  private point(e: MouseEvent): { x: number; y: number } {
    const r = typeof this.canvas.getBoundingClientRect === 'function' ? this.canvas.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** A fitted view for the window's size now (the canvas backing store follows it, at the device pixel ratio). */
  private makeView(): MapView {
    const win = this.host.ownerDocument.defaultView as (Window & typeof globalThis) | null | undefined;
    const w = win?.innerWidth || this.host.clientWidth || 1280;
    const h = win?.innerHeight || this.host.clientHeight || 720;
    const dpr = win?.devicePixelRatio ?? 1;
    this.viewport = { w, h };
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    return new MapView(this.map.size, this.viewport, { minZoom: 1, maxZoom: clientConfig.ui.map.maxZoom }, this.proj.min);
  }

  private buildLayer(): HTMLCanvasElement | null {
    const proj = this.proj;
    const map = this.map;
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
  private polyline(ctx: CanvasRenderingContext2D, points: readonly Vec3[]): void {
    if (points.length < 2) return;
    ctx.beginPath();
    points.forEach((w, i) => {
      const p = this.view_.toScreen(w);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx || !this.open_ || !this.last) return;
    const { model, player, heading } = this.last;
    const view = this.view_;
    const { w, h } = this.viewport;
    ctx.setTransform(this.canvas.width / w, 0, 0, this.canvas.height / h, 0, 0);
    ctx.fillStyle = this.map.kind === 'city' ? WATER : GROUND; // beyond the map's edge
    ctx.fillRect(0, 0, w, h);
    if (this.layer === undefined) this.layer = this.buildLayer();
    if (this.layer) {
      const nw = view.toScreen({ x: this.proj.min.x, y: 0, z: this.proj.min.z });
      const side = this.map.size * view.scale;
      ctx.drawImage(this.layer, nw.x, nw.y, side, side);
    }

    ctx.fillStyle = HOSPITAL_ICON_COLOR; // hospitals: red cross
    const arm = PX.crossArm;
    for (const hos of this.map.hospitals) {
      const p = view.toScreen(hos.center);
      ctx.fillRect(p.x - arm, p.y - arm / 3, arm * 2, (arm * 2) / 3);
      ctx.fillRect(p.x - arm / 3, p.y - arm, (arm * 2) / 3, arm * 2);
    }
    for (const g of this.map.gasStations) {
      const p = view.toScreen(g.position);
      drawFuelIcon(ctx, p.x, p.y, PX.fuel);
    }
    for (const v of model.parked) {
      const p = view.toScreen(v.position);
      drawVehicleIcon(ctx, v.tier, p.x, p.y, PX.vehicle);
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = OFFER; // offers' pickups: hollow dots
    for (const o of model.offers) {
      const p = view.toScreen(o.pickup);
      ctx.beginPath();
      ctx.arc(p.x, p.y, PX.offer, 0, Math.PI * 2);
      ctx.stroke();
    }

    const me = view.toScreen(player);
    for (const o of model.orders) {
      const col = hex(slotColor(this.colorIndex(o.id)));
      const t = view.toScreen(o.target);
      ctx.strokeStyle = col;
      ctx.lineWidth = PX.route;
      if (o.route) {
        this.polyline(ctx, o.route.drive);
        if (o.route.footLeg) {
          ctx.lineWidth = PX.footLeg;
          ctx.setLineDash([5, 4]);
          this.polyline(ctx, o.route.footLeg);
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
      ctx.arc(t.x, t.y, PX.target, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player triangle with a light rim; heading is yaw with forward = (-sin, -cos) in (x, z), so north (-z) is up at
    // heading 0.
    const s = PX.player;
    ctx.save();
    ctx.translate(me.x, me.y);
    ctx.rotate(-heading);
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.75, s * 0.75);
    ctx.lineTo(-s * 0.75, s * 0.75);
    ctx.closePath();
    ctx.fillStyle = PLAYER;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }
}
