import type { Vec3 } from '@dm/shared';

/** Top-down projection of the square map (centred on the origin) onto a square canvas: north (-z) up, x east. */
export class MapProjection {
  /** Canvas pixels per metre. */
  readonly scale: number;
  /** Back to front. */
  readonly drawOrder: string[] = ['ground', 'buildings', 'hospitals', 'offers', 'routes', 'targets', 'player'];

  constructor(
    private readonly mapSize: number,
    readonly canvasPx: number,
  ) {
    this.scale = canvasPx / mapSize;
  }

  toCanvas(p: Vec3): { x: number; y: number } {
    return { x: (p.x + this.mapSize / 2) * this.scale, y: (p.z + this.mapSize / 2) * this.scale };
  }
}
