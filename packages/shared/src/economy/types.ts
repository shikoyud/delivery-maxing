/** The four GAME upgrade lines (spec §6.2 rev. 3), each bought tier by tier in order. */
export type Line = 'vehicle' | 'bag' | 'shoes' | 'dispatcher';
export const LINES: readonly Line[] = ['vehicle', 'bag', 'shoes', 'dispatcher'];
/** The tier owned on each line: 0 = nothing bought; vehicle 0–4 (1 = skateboard … 4 = car), the others 0–5. */
export type LineTiers = Record<Line, number>;

export type CosmeticSlot = 'outfit' | 'vehicle' | 'bag' | 'phone';
export const COSMETIC_SLOTS: readonly CosmeticSlot[] = ['outfit', 'vehicle', 'bag', 'phone'];
export type Finish = 'gold' | 'chrome' | 'neon';

/** The id part of a Coin cosmetic's name (`cosmetic.<slot>.<slug>`): lower case, runs of other characters to "-". */
export const cosmeticSlug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** `line.<line>.<tier>`, `skin.<slot>.<finish>`, `lockoutSkip`, `cosmetic.<slot>.<name>`, `fuelCan`. */
export type ShopItemId = string;

export type ShopItem =
  | { id: ShopItemId; kind: 'line'; line: Line; tier: number; currency: 'game'; usdMicro: number; label: string }
  | { id: ShopItemId; kind: 'skin' | 'lockoutSkip'; currency: 'game'; usdMicro: number; label: string; slot?: CosmeticSlot; finish?: Finish }
  /** `color` absent: the item keeps each model's own colours (the free factory paint). */
  | { id: ShopItemId; kind: 'cosmetic' | 'fuelCan'; currency: 'coins'; coins: number; label: string; slot?: CosmeticSlot; color?: number };
