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
  usdMicro: number;
  game: number;
  luck: number;
  quality: number;
  usdPerGame: number;
  boost: number;
  at: number;
  /** false: the vault could not cover it, so the order paid no GAME (nothing is owed later). */
  paid: boolean;
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
  /** Records an order's payout: pays `game` from the vault into `accrued`, or records it unpaid when the vault cannot cover it. */
  accrue(p: Omit<Payout, 'id' | 'paid' | 'game'>): Payout;
  lockGame(game: number, nowMs: number): { ok: true } | { ok: false; reason: 'insufficient' | 'locked' };
  withdrawLock(nowMs: number): { ok: true } | { ok: false; reason: 'tooEarly' | 'none' };
  claim(nowMs: number): Promise<{ ok: true; game: number } | { ok: false; reason: 'nothing' }>;
  /** Calls `listener` after every change; returns the unsubscriber. */
  subscribe(listener: () => void): () => void;
}
