import movementJson from '../../../../config/movement.json';
import ordersJson from '../../../../config/orders.json';
import type { MovementConfig, OrdersConfig } from './types';

export type { MovementConfig, OrdersConfig } from './types';

export const movementConfig: MovementConfig = movementJson;
export const ordersConfig: OrdersConfig = ordersJson;
