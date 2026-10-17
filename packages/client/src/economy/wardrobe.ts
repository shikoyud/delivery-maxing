import { COSMETIC_SLOTS, shopCatalog, shopItem, type CosmeticSlot, type ShopItem, type ShopItemId } from '@dm/shared';

/** The Coin cosmetics the player owns and what each slot wears (saved in Progress.cosmetics). */
export interface Wardrobe {
  owned: ShopItemId[];
  /** A Coin cosmetic of that slot, or a premium skin (`skin.<slot>.<finish>`, owned on the chain). */
  equipped: Record<CosmeticSlot, ShopItemId>;
}

/** Each slot's first (free) cosmetic. */
function freeItem(slot: CosmeticSlot): ShopItem {
  const item = shopCatalog().find((i) => i.kind === 'cosmetic' && i.slot === slot);
  if (!item) throw new Error(`no cosmetic for ${slot}`);
  return item;
}

/** Each slot's first (free) cosmetic, owned and worn. */
export function defaultWardrobe(): Wardrobe {
  const equipped = Object.fromEntries(COSMETIC_SLOTS.map((s) => [s, freeItem(s).id])) as Record<CosmeticSlot, ShopItemId>;
  return { owned: COSMETIC_SLOTS.map((s) => equipped[s]), equipped };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The saved wardrobe. Not a record with an `owned` list and an `equipped` record: the default. Otherwise unknown items
 * are dropped, the free first item of each slot is always owned, and a slot wearing something it may not (not a
 * cosmetic or premium skin of that slot, or a cosmetic not owned) wears its default. A premium skin is kept without
 * asking the chain: wornItem checks the chain's ownership each time the look is drawn.
 */
export function parseWardrobe(v: unknown): Wardrobe {
  const fallback = defaultWardrobe();
  if (!isRecord(v) || !Array.isArray(v.owned) || !isRecord(v.equipped)) return fallback;
  const items = new Map(shopCatalog().map((i) => [i.id, i]));
  const owned = [...fallback.owned];
  for (const id of v.owned) {
    if (typeof id === 'string' && items.get(id)?.kind === 'cosmetic' && !owned.includes(id)) owned.push(id);
  }
  const equipped = { ...fallback.equipped };
  for (const slot of COSMETIC_SLOTS) {
    const id = v.equipped[slot];
    const item = typeof id === 'string' ? items.get(id) : undefined;
    if (!item || !('slot' in item) || item.slot !== slot) continue;
    if ((item.kind === 'cosmetic' && owned.includes(item.id)) || item.kind === 'skin') equipped[slot] = item.id;
  }
  return { owned, equipped };
}

/**
 * What `slot` shows: its equipped item, unless that is a premium skin the chain does not own (`skins`, the chain's
 * `ownership().skins`), or an item it may not wear; then the slot's free item.
 */
export function wornItem(w: Wardrobe, slot: CosmeticSlot, skins: readonly ShopItemId[]): ShopItem {
  const id = w.equipped[slot];
  let item: ShopItem | undefined;
  try {
    item = shopItem(id);
  } catch {
    item = undefined;
  }
  const ok =
    item !== undefined &&
    'slot' in item &&
    item.slot === slot &&
    ((item.kind === 'cosmetic' && w.owned.includes(id)) || (item.kind === 'skin' && skins.includes(id)));
  return ok ? item! : freeItem(slot);
}

/** `w` wearing `id` (an owned Coin cosmetic, or a premium skin in `skins`), or null when it cannot be worn. */
export function equipItem(w: Wardrobe, id: ShopItemId, skins: readonly ShopItemId[]): Wardrobe | null {
  let item: ShopItem;
  try {
    item = shopItem(id);
  } catch {
    return null;
  }
  if (!('slot' in item) || !item.slot) return null;
  const may = (item.kind === 'cosmetic' && w.owned.includes(id)) || (item.kind === 'skin' && skins.includes(id));
  if (!may) return null;
  return { owned: [...w.owned], equipped: { ...w.equipped, [item.slot]: id } };
}
