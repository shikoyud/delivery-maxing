import { economyConfig, vehiclesConfig } from '../config';
import type { EconomyConfig, VehiclesConfig, VehicleTier } from '../config/types';
import type { CarrierCapacity } from '../orders/types';

/** The vehicle's cap alone (spec §3.3), as a capacity. */
export function vehicleCapacity(vehicle: VehicleTier, vehicles: VehiclesConfig = vehiclesConfig): CarrierCapacity {
  const cap = vehicles[vehicle];
  return { slots: cap.slotCap, maxPackageKg: cap.kgCap };
}

/** The player's capacity (spec §3.3 rev. 3): the Bag tier's slots and kg, each capped by the vehicle. */
export function effectiveCapacity(
  bagTier: number,
  vehicle: VehicleTier,
  econ: EconomyConfig = economyConfig,
  vehicles: VehiclesConfig = vehiclesConfig,
): CarrierCapacity {
  const bag = econ.lines.bag;
  const slots = bag.slots[bagTier];
  const kg = bag.kg[bagTier];
  if (slots === undefined || kg === undefined) throw new Error(`no bag tier ${bagTier}`);
  const cap = vehicleCapacity(vehicle, vehicles);
  return { slots: Math.min(slots, cap.slots), maxPackageKg: Math.min(kg, cap.maxPackageKg) };
}
