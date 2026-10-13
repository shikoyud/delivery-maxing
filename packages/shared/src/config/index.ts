import movementJson from '../../../../config/movement.json';
import ordersJson from '../../../../config/orders.json';
import thievesJson from '../../../../config/thieves.json';
import worldJson from '../../../../config/world.json';
import type { MovementConfig, OrdersConfig, ThievesConfig, WorldConfig } from './types';

export type { BandLimits, MovementConfig, NavConfig, OrdersConfig, ThievesConfig, WorldConfig } from './types';

export const movementConfig: MovementConfig = movementJson;
export const ordersConfig: OrdersConfig = ordersJson;
export const worldConfig: WorldConfig = worldJson;
export const thievesConfig: ThievesConfig = thievesJson;
