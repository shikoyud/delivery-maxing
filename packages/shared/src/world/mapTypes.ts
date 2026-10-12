import type { Vec3 } from '../math/vec3';

export type Surface = 'default' | 'chute';
export type SolidKind =
  | 'ground' | 'building' | 'prop' | 'ramp' | 'chute' | 'hub'
  | 'road' | 'sidewalk' | 'cliff' | 'container' | 'crane' | 'stairs';
export interface Solid {
  id: string;
  kind: SolidKind;
  center: Vec3;
  size: Vec3;
  /** XYZ Euler, degrees */
  rotationDeg?: Vec3;
  surface?: Surface;
  /** A collider whose look comes from a prop (it is not drawn itself) */
  hidden?: boolean;
}
export interface ZipLine { id: string; a: Vec3; b: Vec3 }
export interface JumpPad { id: string; position: Vec3; radius: number; launch: Vec3 }
export interface BoostOrb { id: string; position: Vec3 }
/** Polyline with at least 2 points. */
export interface Rail { id: string; points: Vec3[] }
export interface Checkpoint { id: string; position: Vec3 }
export type District = 'hub' | 'downtown' | 'harbor' | 'hillside' | 'suburbs';
export type PoiKind = 'door' | 'mailbox' | 'counter' | 'balcony';
export interface Poi {
  id: string;
  /** Ground point of the zone */
  position: Vec3;
  district: District;
  kind: PoiKind;
  /** Sits above street level (roof, balcony) */
  elevated?: boolean;
}
export interface Hub {
  center: Vec3;
  plazaRadius: number;
  dropZoneRadius: number;
  zoneHeight: number;
  kiosk: Vec3;
  kioskRange: number;
  spawn: Vec3;
  spawnYaw: number;
}
export interface MapData {
  size: number;
  solids: Solid[];
  zipLines: ZipLine[];
  jumpPads: JumpPad[];
  boostOrbs: BoostOrb[];
  rails: Rail[];
  checkpoints: Checkpoint[];
  pois: Poi[];
  hub: Hub;
}
export interface Rect { minX: number; minZ: number; maxX: number; maxZ: number }
export interface GreyboxDistrict {
  district: District;
  rect: Rect;
  heightMin: number;
  heightMax: number;
  fillChance: number;
}
/** `solids` here are the hand-placed ones. */
export interface GreyboxSource extends MapData {
  seed: number;
  grid: { pitch: number; roadWidth: number; alleyWidth: number };
  districts: GreyboxDistrict[];
  reserved: Rect[];
}
