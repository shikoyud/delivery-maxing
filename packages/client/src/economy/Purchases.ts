import {
  COSMETIC_SLOTS,
  RIDE_TIERS,
  economyConfig,
  fuelCanCoins,
  nearestHospital,
  quote as quoteGame,
  shopCatalog,
  shopItem,
  tierOfVehicle,
  vehicleOfTier,
  type ChainSource,
  type ChainTx,
  type CosmeticSlot,
  type Garage,
  type Line,
  type MapData,
  type OrderSystem,
  type PurchaseError,
  type RideTier,
  type ShopItem,
  type ShopItemId,
  type Vec3,
} from '@dm/shared';
import type { PopupTone } from '../ui/popups';
import { gameText, usdText } from '../ui/hudModel';

/** The Coin cosmetics the player owns and what each slot wears (saved in Progress.cosmetics). */
export interface Wardrobe {
  owned: ShopItemId[];
  /** A Coin cosmetic of that slot, or a premium skin (`skin.<slot>.<finish>`, owned on the chain). */
  equipped: Record<CosmeticSlot, ShopItemId>;
}

/** Each slot's first (free) cosmetic, owned and worn. */
export function defaultWardrobe(): Wardrobe {
  const catalog = shopCatalog();
  const first = (slot: CosmeticSlot): ShopItemId => {
    const item = catalog.find((i) => i.kind === 'cosmetic' && i.slot === slot);
    if (!item) throw new Error(`no cosmetic for ${slot}`);
    return item.id;
  };
  const equipped = Object.fromEntries(COSMETIC_SLOTS.map((s) => [s, first(s)])) as Record<CosmeticSlot, ShopItemId>;
  return { owned: COSMETIC_SLOTS.map((s) => equipped[s]), equipped };
}

export type QuoteView =
  | { kind: 'game'; usd: string; game: number; maxGame: number; text: string }
  | { kind: 'coins'; coins: number; text: string }
  | { kind: 'paused'; text: 'Prices updating, purchases paused' };

export type PurchaseOutcome = { ok: true; tx?: ChainTx } | { ok: false; message: string };

export interface PurchaseDeps {
  garage: Garage;
  /** The player's order state (Game: a getter, DeliveryLoop rebuilds it on a progress reset): Coins and the lockout. */
  orders: OrderSystem;
  map: MapData;
  /** The courier's feet: a bought vehicle parks at the nearest hospital's bay. */
  player(): Vec3;
  wardrobe(): Wardrobe;
  setWardrobe(w: Wardrobe): void;
  ridden(): RideTier | null;
  lastRide(): RideTier | null;
  save(): void;
  popup(title: string, lines?: string[], tone?: PopupTone): void;
  /** Wall-clock ms (the chain's clock); Date.now when absent. */
  now?(): number;
  /** Called before a tier the chain no longer owns leaves the garage (Game: gets off it, forgets it as the last ride). */
  removing?(t: RideTier): void;
  /** The garage changed (Game: the vehicle views snap to the new spots). */
  changed?(): void;
}

const PAUSED = 'Prices updating, purchases paused' as const;
const LINE_LABEL: Record<Line, string> = { vehicle: 'Vehicle', bag: 'Bag', shoes: 'Shoes', dispatcher: 'Dispatcher' };
const RIDE_LABEL: Record<RideTier, string> = { skateboard: 'skateboard', bicycle: 'bicycle', motorbike: 'motorbike', car: 'car' };

/** "$12" for whole dollars, else two decimals (three below $0.10). */
function priceText(usdMicro: number): string {
  return usdMicro % 1_000_000 === 0 ? `$${usdMicro / 1_000_000}` : usdText(usdMicro);
}

const coinsText = (n: number): string => (n === 0 ? 'Free' : `${n} Coins`);

/**
 * The Shop's purchases (spec §6, §11): GAME items go to the chain and are granted only once it confirms them, Coin
 * items are bought at once. Every confirmed or failed transaction is handled exactly once: those already settled when
 * this is built (a reload) are never granted again. The garage follows the chain's vehicle tier on load and on every
 * chain change (Decision 15: tiers 1..lines.vehicle).
 */
export class Purchases {
  private readonly seen = new Set<string>();

  constructor(
    private readonly chain: ChainSource,
    private readonly deps: PurchaseDeps,
  ) {
    for (const tx of chain.history()) if (tx.status !== 'pending') this.seen.add(tx.id);
    chain.subscribe(() => this.sync());
    this.sync();
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** The price as the Shop shows it now. */
  quote(itemId: ShopItemId): QuoteView {
    const item = shopItem(itemId);
    if (item.currency === 'coins') {
      const ride = item.kind === 'fuelCan' ? this.fuelTarget() : null;
      const coins = ride ? this.fuelCoins(ride) : item.coins;
      return { kind: 'coins', coins, text: coinsText(coins) };
    }
    const q = quoteGame(item.usdMicro, this.chain.rate(), this.now(), economyConfig);
    if (!q.ok) return { kind: 'paused', text: PAUSED };
    const usd = priceText(item.usdMicro);
    return { kind: 'game', usd, game: q.game, maxGame: q.maxGame, text: `${usd} ≈ ${gameText(q.game)} GAME` };
  }

  /**
   * Sends a GAME purchase (Coin items are bought at once) paying at most `maxGame` (the confirm sheet's figure; the
   * current quote's when absent): above it the chain refuses it. Granted on confirmation, in update().
   */
  async buy(itemId: ShopItemId, maxGame?: number): Promise<PurchaseOutcome> {
    const item = shopItem(itemId);
    if (item.currency === 'coins') return this.buyWithCoins(itemId);
    const own = this.ownershipError(item);
    if (own) return { ok: false, message: this.message(own, item) };
    const q = this.quote(itemId);
    if (q.kind !== 'game') return { ok: false, message: PAUSED };
    if (q.game > this.chain.balance()) return { ok: false, message: this.message('insufficient', item) };
    const tx = await this.chain.purchase(itemId, maxGame ?? q.maxGame, this.now());
    if (tx.status === 'failed') {
      this.seen.add(tx.id); // answered here, never popped up again
      return { ok: false, message: this.message(tx.error ?? 'rejected', item) };
    }
    return { ok: true, tx };
  }

  /** Buys a Coin cosmetic or a fuel can now. */
  buyWithCoins(itemId: ShopItemId): PurchaseOutcome {
    const item = shopItem(itemId);
    const d = this.deps;
    if (item.kind === 'cosmetic') {
      const w = d.wardrobe();
      if (w.owned.includes(itemId)) return { ok: false, message: 'You already own this' };
      if (!d.orders.spendCoins(item.coins)) return { ok: false, message: 'Not enough Coins' };
      d.setWardrobe({ owned: [...w.owned, itemId], equipped: { ...w.equipped } });
      d.save();
      d.popup(`${item.label} bought`, [`−${item.coins} coins`]);
      return { ok: true };
    }
    if (item.kind === 'fuelCan') {
      const ride = this.fuelTarget();
      if (!ride) return { ok: false, message: 'Ride or park a motorbike or car first' };
      const coins = this.fuelCoins(ride);
      if (!d.orders.spendCoins(coins)) return { ok: false, message: 'Not enough Coins' };
      const state = d.garage.state(ride);
      state.fuel = Math.min(1, state.fuel + economyConfig.fuelCan.tank);
      d.save();
      d.popup(`Fuel can · ${RIDE_LABEL[ride]} tank ${Math.round(state.fuel * 100)} %`, [`−${coins} coins`]);
      return { ok: true };
    }
    return { ok: false, message: `${item.label} is bought with GAME` };
  }

  /** GAME purchases waiting for confirmation, oldest first. */
  pending(): ChainTx[] {
    return this.chain.history().filter((t) => t.status === 'pending');
  }

  /** Per tick: lets the chain settle due transactions, then grants each newly confirmed one and reports each failure. */
  update(nowMs: number): void {
    this.chain.tick(nowMs);
    for (const tx of this.chain.history()) {
      if (tx.status === 'pending' || this.seen.has(tx.id)) continue;
      this.seen.add(tx.id);
      let item: ShopItem;
      try {
        item = shopItem(tx.itemId);
      } catch {
        continue;
      }
      if (tx.status === 'confirmed') this.grant(item);
      else this.deps.popup(this.message(tx.error ?? 'rejected', item), [], 'warn');
    }
  }

  /** What a confirmed purchase gives locally; the Bag, Shoes, Dispatcher and skins are read from the chain. */
  private grant(item: ShopItem): void {
    const d = this.deps;
    if (item.kind === 'line' && item.line === 'vehicle') {
      const h = nearestHospital(d.map, d.player());
      let changed = false;
      for (let t = 1; t <= item.tier; t++) {
        const ride = vehicleOfTier(t) as RideTier;
        if (d.garage.owned().includes(ride)) continue;
        d.garage.setOwned(ride, true, h);
        changed = true;
      }
      if (changed) d.changed?.();
      const ride = vehicleOfTier(item.tier) as RideTier;
      const spot = d.garage.spot(ride);
      d.popup(spot.kind === 'parked' ? `${item.label} bought · parked at ${this.parkedAt(spot.position)}` : `${item.label} bought`);
      d.save();
      return;
    }
    if (item.kind === 'lockoutSkip') {
      d.orders.skipLockout();
      d.popup('Offer lockout skipped', ['New offers are coming']);
      return;
    }
    d.popup(`${item.label} bought`);
  }

  /** The hospital whose bay `p` is nearest (where a bought vehicle parked). */
  private parkedAt(p: Vec3): string {
    return nearestHospital(this.deps.map, p).name;
  }

  /** The garage holds exactly the vehicle tiers the chain owns: lost ones leave, new ones park at the nearest bay. */
  private sync(): void {
    const d = this.deps;
    const tier = this.chain.ownership().lines.vehicle;
    const want = RIDE_TIERS.filter((t) => tierOfVehicle(t) <= tier);
    const h = nearestHospital(d.map, d.player());
    let changed = false;
    for (const t of d.garage.owned()) {
      if (want.includes(t)) continue;
      d.removing?.(t);
      d.garage.setOwned(t, false, h);
      changed = true;
    }
    for (const t of want) {
      if (d.garage.owned().includes(t)) continue;
      d.garage.setOwned(t, true, h);
      changed = true;
    }
    if (!changed) return;
    d.changed?.();
    d.save();
  }

  /** The ridden, else last-ridden, owned ride with a tank a fuel can would fill; null when neither has one. */
  fuelTarget(): RideTier | null {
    const d = this.deps;
    for (const t of [d.ridden(), d.lastRide()]) {
      if (t && d.garage.cfg.rides[t].fuel && d.garage.owned().includes(t)) return t;
    }
    return null;
  }

  private fuelCoins(ride: RideTier): number {
    return fuelCanCoins(ride, economyConfig, this.deps.garage.cfg) ?? 0;
  }

  /** `owned` or `order` when the chain's ownership refuses `item`, else null (the chain checks again). */
  private ownershipError(item: ShopItem): PurchaseError | null {
    const own = this.chain.ownership();
    if (item.kind === 'line') {
      if (item.tier <= own.lines[item.line]) return 'owned';
      if (item.tier > own.lines[item.line] + 1) return 'order';
    }
    if (item.kind === 'skin' && own.skins.includes(item.id)) return 'owned';
    return null;
  }

  private message(error: PurchaseError, item: ShopItem): string {
    switch (error) {
      case 'rejected':
        return 'The wallet rejected the transaction. Nothing was charged.';
      case 'stale':
        return PAUSED;
      case 'slippage':
        return 'The price moved. Nothing was charged; check the new price.';
      case 'insufficient':
        return 'Not enough GAME';
      case 'owned':
        return 'You already own this';
      case 'order': {
        const line = item.kind === 'line' ? item.line : 'vehicle';
        return `Buy ${LINE_LABEL[line]} tier ${this.chain.ownership().lines[line] + 1} first`;
      }
    }
  }
}
