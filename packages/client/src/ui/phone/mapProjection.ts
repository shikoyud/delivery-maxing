import type { MapData, Vec3 } from '@dm/shared';
import { clientConfig } from '../../clientConfig';

/**
 * Top-down projection of the square map onto a square canvas: north (-z) up, x east. The map spans
 * [`minX`, `minX + mapSize`] by [`minZ`, `minZ + mapSize`] (the greybox is centred on the origin, the city starts at
 * 0). The canvas shows a `window` metres wide: the whole map (the greybox), or a cut of it that `pan` centres on the
 * player (the city). The map's static art is drawn once onto a whole-map layer at the same scale (`toLayer`, `layerPx`)
 * and blitted at `-layerOffset`.
 */
export class MapProjection {
  /** Canvas pixels per metre. */
  readonly scale: number;
  /** Back to front. */
  readonly drawOrder: string[] = ['ground', 'roads', 'buildings', 'hospitals', 'fuel', 'parked', 'offers', 'routes', 'targets', 'player'];
  /** Whether `pan` moves the view (the window is smaller than the map). */
  readonly panned: boolean;
  /** Edge of the whole-map layer (px). */
  readonly layerPx: number;
  /** World x, z of the canvas's top-left corner. */
  private viewX: number;
  private viewZ: number;

  constructor(
    private readonly mapSize: number,
    readonly canvasPx: number,
    private readonly minX: number = -mapSize / 2,
    private readonly minZ: number = -mapSize / 2,
    readonly window: number = mapSize,
  ) {
    this.scale = canvasPx / window;
    this.panned = window < mapSize;
    this.layerPx = Math.ceil(mapSize * this.scale);
    this.viewX = minX;
    this.viewZ = minZ;
  }

  /**
   * The Map app's projection for `map`: the greybox (centred on the origin) whole; the city (x, z in [0, size]) as a
   * `ui.mapWindowMeters` window centred on the player by `pan`.
   */
  static forMap(map: MapData, canvasPx: number, windowMeters: number = clientConfig.ui.mapWindowMeters): MapProjection {
    if (map.kind === 'city') return new MapProjection(map.size, canvasPx, 0, 0, Math.min(windowMeters, map.size));
    return new MapProjection(map.size, canvasPx);
  }

  /** Centres the window on `player` (a no-op when the whole map is shown). */
  pan(player: Vec3): void {
    if (!this.panned) return;
    this.viewX = player.x - this.window / 2;
    this.viewZ = player.z - this.window / 2;
  }

  toCanvas(p: Vec3): { x: number; y: number } {
    return { x: (p.x - this.viewX) * this.scale, y: (p.z - this.viewZ) * this.scale };
  }

  /** A point on the whole-map layer. */
  toLayer(p: Vec3): { x: number; y: number } {
    return { x: (p.x - this.minX) * this.scale, y: (p.z - this.minZ) * this.scale };
  }

  /** Where the canvas's top-left corner lies on the layer (px): the layer is drawn at minus this. */
  get layerOffset(): { x: number; y: number } {
    return { x: (this.viewX - this.minX) * this.scale, y: (this.viewZ - this.minZ) * this.scale };
  }
}
