import type { EconomyConfig } from '../config/types';

/** The keeper's GAME→USD rate: USD per whole GAME, posted at `updatedAt` (ms). */
export interface Rate {
  usdPerGame: number;
  updatedAt: number;
}

export type Quote = { ok: true; game: number; maxGame: number } | { ok: false; reason: 'stale' | 'noRate' };

/**
 * ceil, except that a result within 1e-6 base units of a whole number is that number: float noise must not charge
 * a base unit more ($12 at $0.00024 is exactly 50,000 GAME).
 */
function ceilUnits(x: number): number {
  const r = Math.round(x);
  return Math.abs(x - r) < 1e-6 ? r : Math.ceil(x);
}

/**
 * GAME base units (6 decimals) for `usdMicro` at `rate`: `ceil(usd ÷ usdPerGame × 1e6)`. micro-USD ÷ USD-per-GAME is
 * micro-GAME, which is base units. Used for purchases and for payouts (spec §6.3).
 */
export function usdToGame(usdMicro: number, rate: Rate): number {
  return ceilUnits(usdMicro / rate.usdPerGame);
}

/** A purchase quote (spec §6.3): refused with no rate or one at least `rate.maxAgeSeconds` old; `maxGame` adds the slippage. */
export function quote(usdMicro: number, rate: Rate | null, nowMs: number, cfg: EconomyConfig): Quote {
  if (rate === null) return { ok: false, reason: 'noRate' };
  if (nowMs - rate.updatedAt >= cfg.rate.maxAgeSeconds * 1000) return { ok: false, reason: 'stale' };
  const game = usdToGame(usdMicro, rate);
  return { ok: true, game, maxGame: ceilUnits(game * (1 + cfg.slippage)) };
}

/** Whether a rate update from `prev` to `next` (USD per GAME) stays within `rate.maxMove` (spec §6.3: 20%). */
export function rateUpdateAllowed(prev: number, next: number, cfg: EconomyConfig): boolean {
  if (!(next > 0) || !Number.isFinite(next)) return false;
  return Math.abs(next / prev - 1) <= cfg.rate.maxMove + 1e-9;
}
