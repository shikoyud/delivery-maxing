import type { MapData, Vec3 } from '@dm/shared';

/** The static layer's edge: `mapSize × 3` px, at most 4096 (canvas limits). */
export const layerPxFor = (mapSize: number): number => Math.min(4096, Math.ceil(mapSize * 3));

/**
 * Top-down projection of the square map onto the map screen's static layer (a square offscreen canvas `layerPx`
 * wide): north (-z) up, x east. The map spans [`minX`, `minX + mapSize`] by [`minZ`, `minZ + mapSize`] (the greybox
 * is centred on the origin, the city starts at 0). The layer is drawn once and blitted scaled by MapView each frame.
 */
export class MapProjection {
  /** Layer pixels per metre. */
  readonly scale: number;
  /** Back to front. */
  readonly drawOrder: string[] = ['ground', 'roads', 'buildings', 'hospitals', 'fuel', 'parked', 'offers', 'routes', 'targets', 'player'];
  /** The map's north-west corner (world x, z). */
  readonly min: { x: number; z: number };

  constructor(
    readonly mapSize: number,
    readonly layerPx: number,
    minX: number = -mapSize / 2,
    minZ: number = -mapSize / 2,
  ) {
    this.scale = layerPx / mapSize;
    this.min = { x: minX, z: minZ };
  }

  /** The layer for `map`: the greybox centred on the origin, the city (x, z in [0, size]); `layerPxFor` px. */
  static forMap(map: MapData, layerPx: number = layerPxFor(map.size)): MapProjection {
    if (map.kind === 'city') return new MapProjection(map.size, layerPx, 0, 0);
    return new MapProjection(map.size, layerPx);
  }

  /** A point on the layer (px). */
  toLayer(p: Vec3): { x: number; y: number } {
    return { x: (p.x - this.min.x) * this.scale, y: (p.z - this.min.z) * this.scale };
  }
}
