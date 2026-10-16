import movementJson from '../../../../config/movement.json';
import navJson from '../../../../config/nav.json';
import ordersJson from '../../../../config/orders.json';
import ridingJson from '../../../../config/riding.json';
import vehiclesJson from '../../../../config/vehicles.json';
import worldJson from '../../../../config/world.json';
import type { MovementConfig, NavConfig, OrdersConfig, RidingConfig, VehiclesConfig, WorldConfig } from './types';

export { RIDE_TIERS } from './types';
export type {
  AccessKind,
  MovementConfig,
  NavConfig,
  OrdersConfig,
  RideSpec,
  RideTier,
  RidingConfig,
  VehicleSpec,
  VehicleTier,
  VehiclesConfig,
  WorldConfig,
} from './types';

export const movementConfig: MovementConfig = movementJson;
export const ordersConfig: OrdersConfig = ordersJson;
export const vehiclesConfig: VehiclesConfig = vehiclesJson;
export const ridingConfig: RidingConfig = ridingJson as RidingConfig;
export const navConfig: NavConfig = navJson;
export const worldConfig: WorldConfig = worldJson;
