import type { Band } from '../world/distance';

export type OrderType = 'dropoff' | 'pickup' | 'chain';
export type Modifier = 'express' | 'fragile' | 'heavy';
export type Bonus = 'express' | 'fragile' | 'heavy' | 'par';
export type Step = { kind: 'poi'; poiId: string } | { kind: 'hub' };

export interface Order {
  id: string;
  type: OrderType;
  modifier: Modifier | null;
  steps: Step[];
  /** null for chain */
  band: Band | null;
  /** One-way HUB to first POI. */
  hubDistance: number;
  /** Drop-off d; pick-up 2d; chain hub to A + A to B + B to hub. */
  routeDistance: number;
  slots: number;
  /** Seconds; express only. */
  expressLimit: number | null;
  /** Seconds from accept; every order. Delivering within it earns the par bonus. */
  parLimit: number;
}

export interface Unlocks {
  express: boolean;
  chain: boolean;
}
