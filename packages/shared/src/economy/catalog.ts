import { cosmeticsConfig, economyConfig, ridingConfig } from '../config';
import { RIDE_TIERS, type CosmeticsConfig, type EconomyConfig, type RideTier, type RidingConfig, type VehicleTier } from '../config/types';
import { COSMETIC_SLOTS, LINES, type CosmeticSlot, type Finish, type Line, type LineTiers, type ShopItem, type ShopItemId } from './types';

/** Vehicle line tier 0 is on foot; tiers 1–4 are the rides in order (spec §6.2). */
const VEHICLE_BY_TIER: readonly VehicleTier[] = ['walk', 'skateboard', 'bicycle', 'motorbike', 'car'];

export function vehicleOfTier(t: number): VehicleTier {
  const v = VEHICLE_BY_TIER[t];
  if (v === undefined) throw new Error(`no vehicle tier ${t}`);
  return v;
}

export function tierOfVehicle(v: VehicleTier): number {
  return VEHICLE_BY_TIER.indexOf(v);
}

/** The sprint multiplier of an owned Shoes tier: +shoes.sprintPerTier per tier (spec §6.2). */
export function shoesSprintMul(tier: number, econ: EconomyConfig = economyConfig): number {
  return 1 + tier * econ.lines.shoes.sprintPerTier;
}

const LINE_LABEL: Record<Exclude<Line, 'vehicle'>, string> = { bag: 'Bag', shoes: 'Shoes', dispatcher: 'Dispatcher' };
const SLOT_LABEL: Record<CosmeticSlot, string> = { outfit: 'outfit', vehicle: 'paint', bag: 'bag', phone: 'phone case' };
const FINISH_LABEL: Record<Finish, string> = { gold: 'Gold', chrome: 'Chrome', neon: 'Neon' };
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** Every item the Shop sells: the four lines' tiers, premium skins, the lockout skip, Coin cosmetics and the fuel can. */
export function shopCatalog(econ: EconomyConfig = economyConfig, cos: CosmeticsConfig = cosmeticsConfig): ShopItem[] {
  const items: ShopItem[] = [];
  for (const line of LINES) {
    econ.lines[line].usdMicro.forEach((usdMicro, k) => {
      const tier = k + 1;
      const label = line === 'vehicle' ? capital(vehicleOfTier(tier)) : `${LINE_LABEL[line]} ${tier}`;
      items.push({ id: `line.${line}.${tier}`, kind: 'line', line, tier, currency: 'game', usdMicro, label });
    });
  }
  for (const slot of cos.premiumSlots) {
    for (const finish of cos.premiumFinishes) {
      items.push({ id: `skin.${slot}.${finish}`, kind: 'skin', currency: 'game', usdMicro: econ.skinUsdMicro, label: `${FINISH_LABEL[finish]} ${SLOT_LABEL[slot]}`, slot, finish });
    }
  }
  items.push({ id: 'lockoutSkip', kind: 'lockoutSkip', currency: 'game', usdMicro: econ.lockoutSkipUsdMicro, label: 'Offer lockout skip' });
  for (const slot of COSMETIC_SLOTS) {
    for (const c of cos[slot]) {
      items.push({
        id: `cosmetic.${slot}.${slug(c.name)}`,
        kind: 'cosmetic',
        currency: 'coins',
        coins: c.coins,
        label: `${c.name} ${SLOT_LABEL[slot]}`,
        slot,
        ...(c.color === null ? {} : { color: c.color }),
      });
    }
  }
  // The can's price depends on the ride it fills (fuelCanCoins); the item carries the cheapest, the motorbike's.
  const canPrices = RIDE_TIERS.flatMap((t) => fuelCanCoins(t, econ) ?? []);
  items.push({ id: 'fuelCan', kind: 'fuelCan', currency: 'coins', coins: Math.min(...canPrices), label: 'Fuel can' });
  return items;
}

/**
 * Coins for a fuel can filling `ride`: `markup` × the pump price of `tank` of its tank (Decision 5: motorbike 15,
 * car 30), or null for a ride without a tank.
 */
export function fuelCanCoins(ride: RideTier, econ: EconomyConfig = economyConfig, riding: RidingConfig = ridingConfig): number | null {
  const fuel = riding.rides[ride].fuel;
  return fuel ? Math.round(fuel.fullTankCoins * econ.fuelCan.tank * econ.fuelCan.markup) : null;
}

let byId: Map<ShopItemId, ShopItem> | null = null;

/** The shipped catalog's item; throws on an unknown id. */
export function shopItem(id: ShopItemId): ShopItem {
  byId ??= new Map(shopCatalog().map((i) => [i.id, i]));
  const item = byId.get(id);
  if (!item) throw new Error(`unknown shop item ${id}`);
  return item;
}

/** The next tier of `line` after the one owned, or null when the line is maxed. */
export function nextTier(line: Line, owned: LineTiers): ShopItem | null {
  const id = `line.${line}.${owned[line] + 1}`;
  byId ??= new Map(shopCatalog().map((i) => [i.id, i]));
  return byId.get(id) ?? null;
}
