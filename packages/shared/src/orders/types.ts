import type { Band } from '../world/distance';

export type OrderKind = 'food' | 'package';
export type WeightClass = 'small' | 'medium' | 'large' | 'bulky';
export type Modifier = 'express' | 'fragile';
export type Bonus = 'hot' | 'par' | 'express' | 'fragile';

export interface Order {
  id: string;
  kind: OrderKind;
  pickupPoiId: string;
  dropoffPoiId: string;
  item: string;
  weightKg: number | null;
  weightClass: WeightClass | null;
  modifier: Modifier | null;
  band: Band;
  /** Path distance pickup to dropoff. */
  distance: number;
  /** Hot limit (food) or par limit (package), seconds from pickup. */
  timeLimit: number;
  /** Seconds from pickup; express packages only. */
  expressLimit: number | null;
}

export interface Offer {
  order: Order;
  offeredAt: number;
  expiresAt: number;
}

export interface ActiveOrder {
  order: Order;
  acceptedAt: number;
  /** Food: when the courier first reached the pickup and the kitchen started preparing. Null for packages. */
  prepStartedAt: number | null;
  pickedUpAt: number | null;
  fragileIntact: boolean;
}

export interface CarrierCapacity {
  slots: number;
  maxPackageKg: number;
}
