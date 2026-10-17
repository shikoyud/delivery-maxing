import { COSMETIC_SLOTS, shopCatalog, type CosmeticSlot, type Finish, type ShopItemId } from '@dm/shared';
import { wornItem, type Wardrobe } from '../../economy/wardrobe';
import { cssHex } from '../../render/palette';
import { el, setText, syncList } from '../dom';
import type { HudModel } from '../hudModel';
import type { PhoneAppView } from './Phone';

export type WardrobeSection = 'Outfits' | 'Vehicle paint' | 'Bags' | 'Phone cases';

const SECTION: Record<CosmeticSlot, WardrobeSection> = { outfit: 'Outfits', vehicle: 'Vehicle paint', bag: 'Bags', phone: 'Phone cases' };
const SECTIONS: readonly WardrobeSection[] = COSMETIC_SLOTS.map((s) => SECTION[s]);

/** One item in the Wardrobe app. */
export interface WardrobeRow {
  itemId: ShopItemId;
  section: WardrobeSection;
  label: string;
  /** A Coin cosmetic's colour, "#rrggbb"; null: the factory paint (each ride's own colours) or a finish. */
  swatch: string | null;
  /** A premium skin's finish. */
  finish?: Finish;
  /** `equipped`: worn now. `equip`: owned, tap to wear. `shop`: not owned, greyed ("In the Shop"). */
  state: 'equipped' | 'equip' | 'shop';
}

/**
 * The Wardrobe's rows, slot by slot: each Coin cosmetic (owned or not), then the premium finishes the chain owns
 * (`skins`). What a slot wears is wornItem: a saved skin the chain no longer owns shows the slot's free item worn.
 */
export function wardrobeRows(w: Wardrobe, skins: readonly ShopItemId[]): WardrobeRow[] {
  const rows: WardrobeRow[] = [];
  const catalog = shopCatalog();
  for (const slot of COSMETIC_SLOTS) {
    const worn = wornItem(w, slot, skins).id;
    const state = (id: ShopItemId, owned: boolean): WardrobeRow['state'] => (id === worn ? 'equipped' : owned ? 'equip' : 'shop');
    for (const item of catalog) {
      if (item.kind !== 'cosmetic' || item.slot !== slot) continue;
      const swatch = item.color === undefined ? null : cssHex(item.color);
      rows.push({ itemId: item.id, section: SECTION[slot], label: item.label, swatch, state: state(item.id, w.owned.includes(item.id)) });
    }
    for (const item of catalog) {
      if (item.kind !== 'skin' || item.slot !== slot || !item.finish || !skins.includes(item.id)) continue;
      rows.push({ itemId: item.id, section: SECTION[slot], label: item.label, swatch: null, finish: item.finish, state: state(item.id, true) });
    }
  }
  return rows;
}

const BUTTON: Record<WardrobeRow['state'], string> = { equipped: 'Equipped', equip: 'Equip', shop: 'In the Shop' };

interface RowView {
  el: HTMLElement;
  swatch: HTMLElement;
  label: HTMLElement;
  button: HTMLButtonElement;
}

/**
 * The Wardrobe app (spec §8, Decision 4): four sections (outfits, vehicle paint, bags, phone cases). Owned items have
 * Equip (or show Equipped); the Coin items not owned are greyed with "In the Shop"; premium finishes show once the
 * chain owns them.
 */
export function createWardrobeApp(cb: { equip(id: ShopItemId): void }): PhoneAppView {
  const root = el('section', 'phone-wardrobe');
  const sections = new Map<WardrobeSection, { list: HTMLElement; rows: Map<string, RowView> }>();
  for (const name of SECTIONS) {
    const wrap = el('div', 'phone-wardrobe-section', root);
    el('h3', 'phone-section', wrap).textContent = name;
    sections.set(name, { list: el('div', 'phone-list', wrap), rows: new Map() });
  }

  const create = (r: WardrobeRow): RowView => {
    const row = el('div', 'phone-card phone-wardrobe-row');
    row.dataset.id = r.itemId;
    const swatch = el('span', 'phone-shop-swatch', row);
    const label = el('div', 'phone-wardrobe-label', row);
    const button = el('button', 'phone-btn phone-wardrobe-equip', row);
    button.type = 'button';
    button.dataset.action = 'equip';
    button.dataset.id = r.itemId;
    button.addEventListener('click', () => {
      if (!button.disabled) cb.equip(r.itemId);
    });
    return { el: row, swatch, label, button };
  };
  const update = (v: RowView, r: WardrobeRow): void => {
    setText(v.label, r.label);
    if (v.el.dataset.state !== r.state) {
      v.el.dataset.state = r.state;
      for (const s of Object.keys(BUTTON)) v.el.classList.toggle(s, s === r.state);
    }
    const look = r.finish ?? r.swatch ?? 'factory';
    if (v.swatch.dataset.color !== look) {
      v.swatch.dataset.color = look;
      v.swatch.style.setProperty('--swatch', r.swatch ?? 'transparent');
      v.swatch.classList.toggle('factory', r.swatch === null && !r.finish);
      for (const f of ['gold', 'chrome', 'neon']) v.swatch.classList.toggle(`finish-${f}`, r.finish === f);
    }
    v.button.disabled = r.state !== 'equip';
    setText(v.button, BUTTON[r.state]);
  };

  return {
    el: root,
    render: (m: HudModel) => {
      for (const [name, s] of sections) {
        syncList(
          s.list,
          s.rows,
          m.wardrobe.filter((r) => r.section === name),
          (r) => r.itemId,
          create,
          update,
        );
      }
    },
  };
}
