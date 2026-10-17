import type { EconomyConfig } from '../config/types';

/** The keeper's GAME→USD rate: USD per whole GAME, posted at `updatedAt` (ms). */
export interface Rate {
  usdPerGame: number;
  updatedAt: number;
}

export type Quote = { ok: true; game: number; maxGame: number } | { ok: false; reason: 'stale' | 'noRate' };

/**
 * `x` rounded up ('up') or down ('down'), except that a result within 1e-6 base units of a whole number is that
 * number: float noise must not move a whole amount by a base unit ($12 at $0.00024 is exactly 50,000 GAME).
 */
function roundUnits(x: number, dir: 'up' | 'down'): number {
  const r = Math.round(x);
  if (Math.abs(x - r) < 1e-6) return r;
  return dir === 'up' ? Math.ceil(x) : Math.floor(x);
}

/**
 * GAME base units (6 decimals) for `usdMicro` at `rate`: usd ÷ usdPerGame × 1e6 (micro-USD ÷ USD-per-GAME is
 * micro-GAME, which is base units), spec §6.3. A purchase rounds up (the buyer pays at least the price), a payout
 * rounds down (the vault never pays more than the USD rolled).
 */
export function usdToGame(usdMicro: number, rate: Rate, use: 'purchase' | 'payout'): number {
  return roundUnits(usdMicro / rate.usdPerGame, use === 'purchase' ? 'up' : 'down');
}

/** A purchase quote (spec §6.3): refused with no rate or one at least `rate.maxAgeSeconds` old; `maxGame` adds the slippage. */
export function quote(usdMicro: number, rate: Rate | null, nowMs: number, cfg: EconomyConfig): Quote {
  if (rate === null) return { ok: false, reason: 'noRate' };
  if (nowMs - rate.updatedAt >= cfg.rate.maxAgeSeconds * 1000) return { ok: false, reason: 'stale' };
  const game = usdToGame(usdMicro, rate, 'purchase');
  return { ok: true, game, maxGame: roundUnits(game * (1 + cfg.slippage), 'up') };
}

/** Whether a rate update from `prev` to `next` (USD per GAME) stays within `rate.maxMove` (spec §6.3: 20%). */
export function rateUpdateAllowed(prev: number, next: number, cfg: EconomyConfig): boolean {
  if (!(next > 0) || !Number.isFinite(next)) return false;
  return Math.abs(next / prev - 1) <= cfg.rate.maxMove + 1e-9;
}
