import movementJson from '../../../../config/movement.json';
import ordersJson from '../../../../config/orders.json';
import vehiclesJson from '../../../../config/vehicles.json';
import type { MovementConfig, OrdersConfig, VehiclesConfig } from './types';

export type { MovementConfig, OrdersConfig, VehicleSpec, VehicleTier, VehiclesConfig } from './types';

export const movementConfig: MovementConfig = movementJson;
export const ordersConfig: OrdersConfig = ordersJson;
export const vehiclesConfig: VehiclesConfig = vehiclesJson;
