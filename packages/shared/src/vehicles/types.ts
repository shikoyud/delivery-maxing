import type { RideTier } from '../config/types';
import type { Vec3 } from '../math/vec3';

/** Dynamic state of one ridden or parked vehicle. */
export interface VehicleState {
  tier: RideTier;
  position: Vec3;
  /** Yaw (0 faces -Z, positive turns left). */
  heading: number;
  velocity: Vec3;
  grounded: boolean;
  groundNormal: Vec3;
  airApexY: number;
  /** 0..1; always 1 without a tank. */
  fuel: number;
  /** Set by stepVehicle: ticks a walking-pace reverser still backs out after its turn was refused (see applyDrive). */
  backOutTicks?: number;
}
