import type { Vec3 } from '../math/vec3';

export type SolidKind = 'ground' | 'building' | 'prop' | 'ramp';
export interface Solid {
  id: string;
  kind: SolidKind;
  center: Vec3;
  size: Vec3;
  /** XYZ Euler, degrees */
  rotationDeg?: Vec3;
}
export type District = 'downtown' | 'harbor' | 'hillside' | 'suburbs';
export type PoiRole = 'foodPickup' | 'packagePickup' | 'dropoffFood' | 'dropoffPackage';
export interface Poi {
  id: string;
  /** Ground point of the zone */
  position: Vec3;
  district: District;
  kind: 'door' | 'counter';
  /** Fictional business or address name shown in the phone UI */
  name: string;
  roles: PoiRole[];
  /** On pickups: what the order text draws from. */
  items?: string[];
  /** On package senders: [min, max] parcel weight in kg. */
  weightKg?: [number, number];
}
export interface Hospital {
  id: string;
  name: string;
  center: Vec3;
  /** Horizontal radius of the safe zone around `center` */
  safeRadius: number;
  /** Respawn point and facing */
  spawn: Vec3;
  spawnYaw: number;
}
export interface OrderRules {
  bands: { shortMax: number; mediumMax: number };
  foodDropoff: { min: number; max: number };
  maxPickupDistance: number;
}
export interface MapData {
  size: number;
  solids: Solid[];
  pois: Poi[];
  hospitals: Hospital[];
  orderRules: OrderRules;
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
