import movementJson from '../../../../config/movement.json';
import ordersJson from '../../../../config/orders.json';
import worldJson from '../../../../config/world.json';
import type { MovementConfig, OrdersConfig, WorldConfig } from './types';

export type { BandLimits, MovementConfig, NavConfig, OrdersConfig, WorldConfig } from './types';

export const movementConfig: MovementConfig = movementJson;
export const ordersConfig: OrdersConfig = ordersJson;
export const worldConfig: WorldConfig = worldJson;
