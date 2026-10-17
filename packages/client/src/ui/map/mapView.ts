import type { Vec3 } from '@dm/shared';

/**
 * The map screen's camera: zoom and pan over a square map `mapSize` metres wide whose north-west corner is `min`
 * (the city's is the origin), shown in a viewport `viewportPx` wide (CSS px). North (-z) is up. At zoom 1 the whole
 * map fits the viewport's shorter side; `zoom` stays in [cfg.minZoom, cfg.maxZoom]. The pan is clamped so the view's
 * centre stays on the map: some of the map is always on screen.
 */
export class MapView {
  zoom = 1;
  center: { x: number; z: number };
  /** Pixels per metre at zoom 1. */
  private readonly baseScale: number;

  constructor(
    private readonly mapSize: number,
    private readonly viewportPx: { w: number; h: number },
    private readonly cfg: { minZoom: 1; maxZoom: number },
    private readonly min: { x: number; z: number } = { x: 0, z: 0 },
  ) {
    this.baseScale = Math.min(viewportPx.w, viewportPx.h) / mapSize;
    this.center = this.middle();
  }

  /** Pixels per metre now. */
  get scale(): number {
    return this.baseScale * this.zoom;
  }

  /** The whole map, centred, at zoom 1. */
  fit(): void {
    this.zoom = 1;
    this.center = this.middle();
  }

  /** Zooms by `factor` (clamped) keeping the world point under `screen` where it is. */
  zoomAt(factor: number, screen: { x: number; y: number }): void {
    const w = this.toWorld(screen);
    this.zoom = Math.min(this.cfg.maxZoom, Math.max(this.cfg.minZoom, this.zoom * factor));
    this.center = {
      x: w.x - (screen.x - this.viewportPx.w / 2) / this.scale,
      z: w.z - (screen.y - this.viewportPx.h / 2) / this.scale,
    };
    this.clamp();
  }

  /** Drags the map by (dx, dy) screen px: the map moves with the pointer. */
  panBy(dxPx: number, dyPx: number): void {
    this.center = { x: this.center.x - dxPx / this.scale, z: this.center.z - dyPx / this.scale };
    this.clamp();
  }

  toScreen(p: Vec3): { x: number; y: number } {
    return {
      x: this.viewportPx.w / 2 + (p.x - this.center.x) * this.scale,
      y: this.viewportPx.h / 2 + (p.z - this.center.z) * this.scale,
    };
  }

  /** The world x, z under a screen point. */
  toWorld(screen: { x: number; y: number }): { x: number; z: number } {
    return {
      x: this.center.x + (screen.x - this.viewportPx.w / 2) / this.scale,
      z: this.center.z + (screen.y - this.viewportPx.h / 2) / this.scale,
    };
  }

  private middle(): { x: number; z: number } {
    return { x: this.min.x + this.mapSize / 2, z: this.min.z + this.mapSize / 2 };
  }

  private clamp(): void {
    const c = (v: number, lo: number): number => Math.min(lo + this.mapSize, Math.max(lo, v));
    this.center = { x: c(this.center.x, this.min.x), z: c(this.center.z, this.min.z) };
  }
}
