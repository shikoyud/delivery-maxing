import type { EconomyConfig } from '../config/types';
import type { ShopItem } from './types';

/**
 * Where a purchase's GAME goes (spec §6.2): a line tier sends `floor(game × split.linePool)` to the reward vault and
 * burns the rest; skins and the lockout skip burn everything. Coin items never reach the chain.
 */
export function splitPurchase(item: ShopItem, game: number, cfg: EconomyConfig): { burned: number; vault: number } {
  if (item.currency !== 'game') throw new Error(`${item.id} is not bought with GAME`);
  const vault = item.kind === 'line' ? Math.floor(game * cfg.split.linePool) : 0;
  return { burned: game - vault, vault };
}
