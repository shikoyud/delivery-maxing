import cityJson from '../../../../config/city.json';
import cosmeticsJson from '../../../../config/cosmetics.json';
import economyJson from '../../../../config/economy.json';
import movementJson from '../../../../config/movement.json';
import namesJson from '../../../../config/names.json';
import navJson from '../../../../config/nav.json';
import ordersJson from '../../../../config/orders.json';
import ridingJson from '../../../../config/riding.json';
import vehiclesJson from '../../../../config/vehicles.json';
import worldJson from '../../../../config/world.json';
import type { CosmeticSlot, Finish } from '../economy/types';
import type { CityConfig, CosmeticSpec, CosmeticsConfig, EconomyConfig, MovementConfig, NamesConfig, NavConfig, OrdersConfig, RidingConfig, VehiclesConfig, WorldConfig } from './types';

export { RIDE_TIERS } from './types';
export type {
  AccessKind,
  CityConfig,
  CosmeticSpec,
  CosmeticsConfig,
  EconomyConfig,
  MovementConfig,
  ItemsConfig,
  NamesConfig,
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
export const cityConfig: CityConfig = cityJson as CityConfig;
export const namesConfig: NamesConfig = namesJson;

/** USD (decimal) to micro-USD (integer). */
const micro = (usd: number): number => Math.round(usd * 1e6);
const microRange = ([a, b]: number[]): [number, number] => [micro(a!), micro(b!)];

function loadEconomy(j: typeof economyJson): EconomyConfig {
  const { usd: vehicleUsd } = j.lines.vehicle;
  const { usd: bagUsd, ...bag } = j.lines.bag;
  const { usd: shoesUsd, ...shoes } = j.lines.shoes;
  const { usd: dispatcherUsd, ...dispatcher } = j.lines.dispatcher;
  const r = j.payout.ranges;
  return {
    lines: {
      vehicle: { usdMicro: vehicleUsd.map(micro) },
      bag: { usdMicro: bagUsd.map(micro), ...bag },
      shoes: { usdMicro: shoesUsd.map(micro), ...shoes },
      dispatcher: { usdMicro: dispatcherUsd.map(micro), ...dispatcher },
    },
    skinUsdMicro: micro(j.skinUsd),
    lockoutSkipUsdMicro: micro(j.lockoutSkipUsd),
    split: j.split,
    rate: j.rate,
    slippage: j.slippage,
    payout: {
      ranges: { walk: microRange(r.walk), skateboard: microRange(r.skateboard), bicycle: microRange(r.bicycle), motorbike: microRange(r.motorbike), car: microRange(r.car) },
      qualityWeight: j.payout.qualityWeight,
      luckWeight: j.payout.luckWeight,
    },
    lock: { days: j.lock.days, withdrawWindowHours: j.lock.withdrawWindowHours, maxBoost: j.lock.maxBoost, fullBoostUsdMicro: micro(j.lock.fullBoostUsd) },
    fuelCan: j.fuelCan,
    mockChain: {
      wallet: j.mockChain.wallet,
      startGame: j.mockChain.startGame,
      vaultUsdMicro: micro(j.mockChain.vaultUsd),
      usdPerGame: j.mockChain.usdPerGame,
      confirmSeconds: j.mockChain.confirmSeconds,
    },
  };
}

function loadCosmetics(j: typeof cosmeticsJson): CosmeticsConfig {
  const slot = (items: { name: string; color: string | null; coins: number }[]): CosmeticSpec[] =>
    items.map((c) => ({ name: c.name, color: c.color === null ? null : Number.parseInt(c.color.replace('#', ''), 16), coins: c.coins }));
  return {
    outfit: slot(j.outfit),
    vehicle: slot(j.vehicle),
    bag: slot(j.bag),
    phone: slot(j.phone),
    premiumFinishes: j.premiumFinishes as Finish[],
    premiumSlots: j.premiumSlots as CosmeticSlot[],
  };
}

export const economyConfig: EconomyConfig = loadEconomy(economyJson);
export const cosmeticsConfig: CosmeticsConfig = loadCosmetics(cosmeticsJson);
