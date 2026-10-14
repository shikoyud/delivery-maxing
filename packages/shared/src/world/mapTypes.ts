import type { AccessKind } from '../config';
import type { Vec3 } from '../math/vec3';

/** `hospital`: the solid block at a hospital's centre (generated from `GreyboxSource.hospitalBlock`). */
export type SolidKind = 'ground' | 'building' | 'prop' | 'ramp' | 'hospital';
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
  /** First vehicle parking slot; slot i is `bay + i * bays.spacing` along the bay's right vector. */
  bay: Vec3;
  /** Facing of parked vehicles (radians, same convention as `spawnYaw`). */
  bayYaw: number;
}
export interface Rect { minX: number; minZ: number; maxX: number; maxZ: number }
/** A ground-plane region that only some vehicle tiers may enter. */
export interface AccessZone {
  id: string;
  kind: AccessKind;
  rect: Rect;
  minY: number;
  maxY: number;
}
export interface GasStation {
  id: string;
  name: string;
  position: Vec3;
  /** Ground points where a stopped vehicle refuels. */
  pumps: Vec3[];
}
export interface OrderRules {
  bands: { shortMax: number; mediumMax: number };
  foodDropoff: { min: number; max: number };
  packageDropoff: { min: number; max: number };
  maxPickupDistance: number;
}
export interface MapData {
  size: number;
  solids: Solid[];
  pois: Poi[];
  hospitals: Hospital[];
  accessZones: AccessZone[];
  gasStations: GasStation[];
  orderRules: OrderRules;
}
export interface GreyboxDistrict {
  district: District;
  rect: Rect;
  heightMin: number;
  heightMax: number;
  fillChance: number;
}
/** `solids` and `accessZones` here are the hand-placed ones. */
export interface GreyboxSource extends MapData {
  seed: number;
  grid: { pitch: number; roadWidth: number; alleyWidth: number };
  districts: GreyboxDistrict[];
  reserved: Rect[];
  /** Size of the solid block placed on every hospital's centre (the client draws its art to this size). */
  hospitalBlock: Vec3;
}
