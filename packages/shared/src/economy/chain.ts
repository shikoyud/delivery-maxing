import type { VehicleTier } from '../config/types';
import type { OrderKind } from '../orders/types';
import type { Rate } from './pricing';
import type { LineTiers, ShopItemId } from './types';

/** Base units per whole GAME (6 decimals). Every GAME amount below is an integer of base units. */
export const GAME_UNITS = 1_000_000;

/** What the wallet owns on-chain: the tier of each line and the premium skins. */
export interface Ownership {
  lines: LineTiers;
  skins: ShopItemId[];
}

export type TxStatus = 'pending' | 'confirmed' | 'failed';
/** `order`: not the next tier of its line. `rejected`: the wallet refused or failed it, or the item is not sold for GAME. */
export type PurchaseError = 'rejected' | 'stale' | 'slippage' | 'insufficient' | 'owned' | 'order';

/** A GAME purchase. `game`, `burned` and `vault` are 0 until it confirms (a failed tx charges nothing). */
export interface ChainTx {
  id: string;
  itemId: ShopItemId;
  game: number;
  burned: number;
  vault: number;
  status: TxStatus;
  error?: PurchaseError;
  createdAt: number;
  settledAt?: number;
}

/** One order's payout (spec §9): the roll (`usdMicro`, `luck`, `quality`), the rate and boost, and the GAME paid (0 when unpaid). */
export interface Payout {
  id: string;
  orderId: string;
  /** The amount paid in integer micro-USD: `rollPayoutUsd` with the boost already applied. accrue converts it as is. */
  usdMicro: number;
  game: number;
  luck: number;
  quality: number;
  usdPerGame: number;
  /** The lock-to-boost multiplier `usdMicro` was rolled with; informational (accrue never multiplies by it again). */
  boost: number;
  at: number;
  /** false: the vault could not cover it, so the order paid no GAME (nothing is owed later). */
  paid: boolean;
  /** The order it paid for (the Wallet's "Car · hot"); absent on payouts saved before it was recorded. */
  detail?: { tier: VehicleTier; kind: OrderKind; inTime: boolean };
}

/** A claim of accrued GAME into the balance (the mock's is instant; SP8 makes it a transaction). */
export interface Claim {
  game: number;
  at: number;
}

/** Locked GAME (spec §6.4), valued at the rate when locked. */
export interface Lock {
  game: number;
  usdMicroAtLock: number;
  lockedAt: number;
  unlocksAt: number;
}

/** The game's view of the reward chain. SP6 has only the browser mock (`mock: true`); SP8 adds the real program. */
export interface ChainSource {
  readonly wallet: string;
  readonly mock: boolean;
  /** Spendable GAME. */
  balance(): number;
  /** Paid out, not yet claimed. */
  accrued(): number;
  /** GAME the reward vault holds. */
  vault(): number;
  rate(): Rate | null;
  ownership(): Ownership;
  lock(): Lock | null;
  /** Purchases, oldest first (the last 200). */
  history(): readonly ChainTx[];
  /** Payouts, oldest first (the last 200). */
  payouts(): readonly Payout[];
  /** Sends a purchase paying at most `maxGame`. Never throws: refusals come back as a failed tx. */
  purchase(itemId: ShopItemId, maxGame: number, nowMs: number): Promise<ChainTx>;
  /** Records an order's payout: converts `usdMicro` (boost included) at `usdPerGame` and pays that GAME from the vault into `accrued`, or records it unpaid when the vault cannot cover it. */
  accrue(p: Omit<Payout, 'id' | 'paid' | 'game'>): Payout;
  lockGame(game: number, nowMs: number): { ok: true } | { ok: false; reason: 'insufficient' | 'locked' };
  /** Whether withdrawLock would succeed at `nowMs`. */
  withdrawable(nowMs: number): boolean;
  withdrawLock(nowMs: number): { ok: true } | { ok: false; reason: 'tooEarly' | 'none' };
  /** Claims, oldest first (the last 200). */
  claims(): readonly Claim[];
  claim(nowMs: number): Promise<{ ok: true; game: number } | { ok: false; reason: 'nothing' }>;
  /** Brings the chain up to `nowMs`: settles due transactions (the mock confirms them; a real chain would poll). */
  tick(nowMs: number): void;
  /** Calls `listener` after every change; returns the unsubscriber. */
  subscribe(listener: () => void): () => void;
}
