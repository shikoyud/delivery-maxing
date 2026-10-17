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
import { GAME_UNITS } from '../economy/chain';
import { COSMETIC_SLOTS, cosmeticSlug, type CosmeticSlot, type Finish } from '../economy/types';
import { RIDE_TIERS, type CityConfig, type CosmeticSpec, type CosmeticsConfig, type EconomyConfig, type MovementConfig, type NamesConfig, type NavConfig, type OrdersConfig, type RidingConfig, type VehicleTier, type VehiclesConfig, type WorldConfig } from './types';

export { RIDE_TIERS } from './types';

/** Throws `file: what` when a loaded config breaks a rule the code relies on. */
function check(ok: boolean, file: string, what: string): void {
  if (!ok) throw new Error(`config/${file}.json: ${what}`);
}

/** Collider length along the heading (m): 2 × (halfLength + radius); an upright capsule's is its diameter. */
export const colliderLength = (cfg: RidingConfig, t: (typeof RIDE_TIERS)[number]): number =>
  2 * (cfg.rides[t].collider.halfLength + cfg.rides[t].collider.radius);

/** Riding rules: a bay slot fits the longest ride's collider plus `bays.minGap`, so parked neighbours never touch. */
export function assertRiding(cfg: RidingConfig): RidingConfig {
  const longest = Math.max(...RIDE_TIERS.map((t) => colliderLength(cfg, t)));
  check(cfg.bays.minGap >= 0, 'riding', 'bays.minGap must be >= 0');
  check(cfg.bays.spacing >= longest + cfg.bays.minGap - 1e-9, 'riding', `bays.spacing ${cfg.bays.spacing} < longest collider ${longest} + bays.minGap ${cfg.bays.minGap}`);
  return cfg;
}

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
export const ridingConfig: RidingConfig = assertRiding(ridingJson as RidingConfig);
export const navConfig: NavConfig = navJson;
export const worldConfig: WorldConfig = worldJson;
export const cityConfig: CityConfig = cityJson as CityConfig;
export const namesConfig: NamesConfig = namesJson;

/** USD (decimal) to micro-USD (integer). */
const micro = (usd: number): number => Math.round(usd * 1e6);
const microRange = ([a, b]: number[]): [number, number] => [micro(a!), micro(b!)];

const VEHICLE_TIERS: readonly VehicleTier[] = ['walk', ...RIDE_TIERS];

/** Economy rules the code relies on (checked on the loaded, micro-USD config). */
function assertEconomy(e: EconomyConfig): void {
  const l = e.lines;
  // vehicle tiers 1..n are the rides after walking
  check(l.vehicle.usdMicro.length === VEHICLE_TIERS.length - 1, 'economy', `lines.vehicle.usd needs ${VEHICLE_TIERS.length - 1} prices`);
  const tiers0 = (line: string, key: string, table: unknown[], prices: number[]): void =>
    check(table.length === prices.length + 1, 'economy', `lines.${line}.${key} needs ${prices.length + 1} entries (tiers 0..${prices.length})`);
  tiers0('bag', 'slots', l.bag.slots, l.bag.usdMicro);
  tiers0('bag', 'kg', l.bag.kg, l.bag.usdMicro);
  tiers0('dispatcher', 'maxShown', l.dispatcher.maxShown, l.dispatcher.usdMicro);
  tiers0('dispatcher', 'intervalScale', l.dispatcher.intervalScale, l.dispatcher.usdMicro);
  for (const t of VEHICLE_TIERS) {
    const [min, max] = e.payout.ranges[t];
    check(min >= 0 && min <= max, 'economy', `payout.ranges.${t} must be 0 <= min <= max`);
  }
  const { qualityWeight: q, luckWeight: k } = e.payout;
  check(q >= 0 && k >= 0 && Math.abs(q + k - 1) < 1e-9, 'economy', 'payout.qualityWeight + payout.luckWeight must be 1');
  check(e.split.linePool >= 0 && e.split.linePool <= 1, 'economy', 'split.linePool must be in [0, 1]');
  check(e.mockChain.usdPerGame > 0, 'economy', 'mockChain.usdPerGame must be > 0');
  check(e.lock.days > 0, 'economy', 'lock.days must be > 0');
}

/** Cosmetic rules: `#rrggbb` colours (null keeps the model's own), the first of each slot free, unique names (ids). */
function assertCosmetics(j: Record<CosmeticSlot, { name: string; color: string | null; coins: number }[]>): void {
  for (const slot of COSMETIC_SLOTS) {
    const items = j[slot];
    check(items.length > 0 && items[0]!.coins === 0, 'cosmetics', `${slot}: the first item must be free`);
    const seen = new Set<string>();
    for (const c of items) {
      check(c.color === null || /^#[0-9a-f]{6}$/i.test(c.color), 'cosmetics', `${slot} ${c.name}: colour must be "#rrggbb" or null`);
      const id = cosmeticSlug(c.name);
      check(!seen.has(id), 'cosmetics', `${slot}: two items named ${id}`);
      seen.add(id);
    }
  }
}

/** config/economy.json loaded: USD to micro-USD, startGame to base units, then validated. */
export function loadEconomy(j: typeof economyJson): EconomyConfig {
  const { usd: vehicleUsd } = j.lines.vehicle;
  const { usd: bagUsd, ...bag } = j.lines.bag;
  const { usd: shoesUsd, ...shoes } = j.lines.shoes;
  const { usd: dispatcherUsd, ...dispatcher } = j.lines.dispatcher;
  const r = j.payout.ranges;
  const e: EconomyConfig = {
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
      startGameUnits: j.mockChain.startGame * GAME_UNITS,
      vaultUsdMicro: micro(j.mockChain.vaultUsd),
      usdPerGame: j.mockChain.usdPerGame,
      confirmSeconds: j.mockChain.confirmSeconds,
    },
  };
  assertEconomy(e);
  return e;
}

/** config/cosmetics.json loaded (validated, `"#rrggbb"` colours to numbers). */
export function loadCosmetics(j: typeof cosmeticsJson): CosmeticsConfig {
  assertCosmetics(j);
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
