import {
  economyConfig,
  ordersConfig,
  shopCatalog,
  shopItem,
  vehicleOfTier,
  type ChainTx,
  type CosmeticSlot,
  type EconomyConfig,
  type OrdersConfig,
  type Ownership,
  type ShopItem,
  type RideTier,
  type ShopItemId,
} from '@dm/shared';
import type { QuoteView, Wardrobe } from '../../economy/Purchases';
import { el, setText } from '../dom';
import { gameText, type HudModel } from '../hudModel';
import { syncList } from './ordersApp';
import type { PhoneAppView } from './Phone';

export type ShopTab = 'coins' | 'token';
export type ShopSection =
  | 'Vehicle'
  | 'Bag'
  | 'Shoes'
  | 'Dispatcher'
  | 'Premium skins'
  | 'Offer lockout'
  | 'Fuel'
  | 'Outfits'
  | 'Vehicle paint'
  | 'Bags'
  | 'Phone cases';

/** One item in the Shop app (spec §6, §8). */
export interface ShopRow {
  itemId: ShopItemId;
  tab: ShopTab;
  section: ShopSection;
  label: string;
  /** What it gives: "3 slots · 25 kg", "+7% sprint", "4 offers · every 8–15 s × 0.7", "$0.03–0.30 per order". */
  detail: string;
  price: QuoteView;
  /**
   * `buy`: tap to buy. `owned`: ticked. `pending`: sent, waiting for the chain. `locked`: a later tier of a line (or the
   * lockout skip with no lockout), greyed with its price. `paused`: the rate is stale.
   */
  state: 'buy' | 'owned' | 'pending' | 'locked' | 'paused';
  /** A Coin cosmetic's colour, "#rrggbb" (null: the factory paint, each model's own colours). */
  swatch?: string | null;
}

/** What the rows read from the Shop's purchases (Game: Purchases). */
export interface ShopSource {
  quote(itemId: ShopItemId): QuoteView;
  pending(): readonly ChainTx[];
  /** The ride a fuel can would fill now, or null (the can is not for sale). */
  fuelTarget(): RideTier | null;
}

const COSMETIC_SECTION: Record<CosmeticSlot, ShopSection> = { outfit: 'Outfits', vehicle: 'Vehicle paint', bag: 'Bags', phone: 'Phone cases' };
const COSMETIC_DETAIL: Record<CosmeticSlot, string> = {
  outfit: 'Outfit colour',
  vehicle: 'Paint for all your rides',
  bag: 'Box colour',
  phone: 'Phone case colour',
};
const LINE_SECTION = { vehicle: 'Vehicle', bag: 'Bag', shoes: 'Shoes', dispatcher: 'Dispatcher' } as const;
const SECTIONS: Record<ShopTab, readonly ShopSection[]> = {
  coins: ['Fuel', 'Outfits', 'Vehicle paint', 'Bags', 'Phone cases'],
  token: ['Vehicle', 'Bag', 'Shoes', 'Dispatcher', 'Premium skins', 'Offer lockout'],
};
const PAUSED = 'Prices updating, purchases paused';
const NO_FUEL_TARGET = 'Ride or park a motorbike or car first';

/** Dollars to two decimals, three when two would drop a digit ("0.03", "0.005"). */
function dollars(usd: number): string {
  const two = usd.toFixed(2);
  return Math.abs(Number(two) - usd) < 1e-9 ? two : usd.toFixed(3);
}

/** A trimmed number: "7", "17.5". */
const num = (n: number): string => String(Math.round(n * 1000) / 1000);

/** What a tier, skin or item gives, per spec §6.2. */
export function shopDetail(item: ShopItem, econ: EconomyConfig = economyConfig, orders: OrdersConfig = ordersConfig): string {
  switch (item.kind) {
    case 'line': {
      const t = item.tier;
      if (item.line === 'vehicle') {
        const [lo, hi] = econ.payout.ranges[vehicleOfTier(t)];
        return `$${dollars(lo / 1e6)}–${dollars(hi / 1e6)} per order`;
      }
      if (item.line === 'bag') return `${econ.lines.bag.slots[t]} slots · ${econ.lines.bag.kg[t]} kg`;
      if (item.line === 'shoes') return `+${num(t * econ.lines.shoes.sprintPerTier * 100)}% sprint`;
      const d = econ.lines.dispatcher;
      return `${d.maxShown[t]} offers · every ${orders.offers.minIntervalSeconds}–${orders.offers.maxIntervalSeconds} s × ${num(d.intervalScale[t]!)}`;
    }
    case 'skin':
      return item.slot === 'outfit' ? 'Premium outfit finish' : 'Premium paint for all your rides';
    case 'lockoutSkip':
      return 'Ends the offer lockout now';
    case 'cosmetic':
      return item.slot ? COSMETIC_DETAIL[item.slot] : '';
    case 'fuelCan':
      return `+${num(econ.fuelCan.tank * 100)}% of a tank for the motorbike or car you ride`;
  }
}

/** Where a GAME purchase's GAME goes: "80% burned · 20% to the reward vault" for a line tier, else "100% burned". */
export function splitText(item: ShopItem, econ: EconomyConfig = economyConfig): string {
  if (item.kind !== 'line') return '100% burned';
  const vault = Math.round(econ.split.linePool * 100);
  return `${100 - vault}% burned · ${vault}% to the reward vault`;
}

function sectionOf(item: ShopItem): ShopSection {
  switch (item.kind) {
    case 'line':
      return LINE_SECTION[item.line];
    case 'skin':
      return 'Premium skins';
    case 'lockoutSkip':
      return 'Offer lockout';
    case 'cosmetic':
      return COSMETIC_SECTION[item.slot ?? 'outfit'];
    case 'fuelCan':
      return 'Fuel';
  }
}

/**
 * The Shop's rows, Coins tab then Token tab, each in section order. A line is a ladder: tiers at or below the owned
 * one are `owned`, the next is `buy` (or `pending` while its purchase waits for the chain), later ones `locked`. A
 * stale rate pauses every Token row that could be bought. The lockout skip is for sale only during a lockout.
 */
export function shopRows(src: ShopSource, own: Ownership, wardrobe: Wardrobe, lockout: boolean): ShopRow[] {
  const pending = new Set(src.pending().map((t) => t.itemId));
  const rows: ShopRow[] = [];
  for (const { item, base } of staticRows()) {
    const price = src.quote(item.id);
    let state: ShopRow['state'];
    if (item.kind === 'line') {
      const owned = own.lines[item.line];
      state = item.tier <= owned ? 'owned' : item.tier === owned + 1 ? 'buy' : 'locked';
    } else if (item.kind === 'skin') state = own.skins.includes(item.id) ? 'owned' : 'buy';
    else if (item.kind === 'lockoutSkip') state = lockout ? 'buy' : 'locked';
    else if (item.kind === 'cosmetic') state = wardrobe.owned.includes(item.id) ? 'owned' : 'buy';
    else state = src.fuelTarget() === null ? 'locked' : 'buy';
    if (state === 'buy' && pending.has(item.id)) state = 'pending';
    if (state === 'buy' && price.kind === 'paused') state = 'paused';
    const detail = item.kind === 'fuelCan' && state === 'locked' ? NO_FUEL_TARGET : base.detail;
    rows.push({ ...base, detail, price, state });
  }
  return rows;
}

type StaticRow = Omit<ShopRow, 'price' | 'state'>;
let statics: { item: ShopItem; base: StaticRow }[] | null = null;

/** The catalog's rows minus price and state, in tab and section order, built once (the catalog is config). */
function staticRows(): { item: ShopItem; base: StaticRow }[] {
  if (statics) return statics;
  const order = [...SECTIONS.coins, ...SECTIONS.token];
  const out = shopCatalog().map((item) => ({
    item,
    base: {
      itemId: item.id,
      tab: item.currency === 'coins' ? ('coins' as const) : ('token' as const),
      section: sectionOf(item),
      label: item.label,
      detail: shopDetail(item),
      ...(item.kind === 'cosmetic' ? { swatch: item.color === undefined ? null : `#${item.color.toString(16).padStart(6, '0')}` } : {}),
    },
  }));
  // A stable sort keeps the catalog's tier and cosmetic order inside each section.
  return (statics = out.sort((a, b) => order.indexOf(a.base.section) - order.indexOf(b.base.section)));
}

const BUTTON: Record<ShopRow['state'], string> = { buy: 'Buy', owned: '✓ Owned', pending: 'Confirming…', locked: 'Locked', paused: 'Paused' };

/** The row button's copy (the lockout skip without a lockout says so). */
function buttonText(r: ShopRow): string {
  if (r.state === 'locked' && r.itemId === 'lockoutSkip') return 'No lockout';
  return BUTTON[r.state];
}

export interface ShopCallbacks {
  /** A Coin item's Buy (bought on the first tap). */
  buy(itemId: ShopItemId): void;
  /** Confirm on a GAME item's confirm sheet, with the "at most" GAME it showed (the cap sent to the chain). */
  confirm(itemId: ShopItemId, maxGame: number): void;
  /** Cancel on the confirm sheet. */
  cancel(): void;
}

interface RowView {
  el: HTMLElement;
  swatch: HTMLElement;
  label: HTMLElement;
  detail: HTMLElement;
  price: HTMLElement;
  button: HTMLButtonElement;
}

interface SectionView {
  el: HTMLElement;
  list: HTMLElement;
  rows: Map<string, RowView>;
}

/** The "Mock wallet" badge shown wherever GAME is spent (Decision 1). */
export function mockBadge(parent: HTMLElement): HTMLElement {
  const b = el('span', 'phone-mock-badge', parent);
  b.textContent = 'Mock wallet';
  b.title = 'GAME here is a browser mock of the reward program: no real tokens';
  return b;
}

export interface ConfirmSheet {
  el: HTMLElement;
  /** Shows the sheet for a GAME item (drawn from its row at the next render, or now from the last rows). */
  open(itemId: ShopItemId): void;
  /** Redraws from the HUD model's shop rows; closes when the item's row is gone. */
  render(rows: readonly ShopRow[]): void;
}

/**
 * The GAME confirm sheet (every GAME spend goes through it: the Shop's Buy and the Orders app's Skip): the label and
 * detail, "$12 ≈ 50,000 GAME", "You pay at most 51,000 GAME", where the GAME goes, the Mock wallet badge, Confirm and
 * Cancel. It stays live: a price change or a stale rate shows at once, and Confirm is disabled while the item cannot be
 * bought. Confirm passes the "at most" figure shown, so the cap sent is the one the player saw.
 */
export function createConfirmSheet(
  parent: HTMLElement,
  onConfirm: (itemId: ShopItemId, maxGame: number) => void,
  onCancel: () => void,
): ConfirmSheet {
  const sheet = el('div', 'phone-shop-sheet', parent);
  sheet.hidden = true;
  const card = el('div', 'phone-shop-sheet-card', sheet);
  const label = el('div', 'phone-shop-sheet-label', card);
  const detail = el('div', 'phone-shop-detail', card);
  const price = el('div', 'phone-shop-sheet-price', card);
  const max = el('div', 'phone-shop-sheet-max', card);
  const split = el('div', 'phone-shop-sheet-split', card);
  mockBadge(card);
  const note = el('div', 'phone-shop-sheet-note', card);
  const actions = el('div', 'phone-shop-sheet-actions', card);
  const cancel = el('button', 'phone-btn phone-shop-cancel', actions);
  cancel.type = 'button';
  cancel.dataset.action = 'cancel';
  cancel.textContent = 'Cancel';
  const confirm = el('button', 'phone-btn phone-shop-confirm', actions);
  confirm.type = 'button';
  confirm.dataset.action = 'confirm';
  confirm.textContent = 'Confirm';
  let id: ShopItemId | null = null;
  let shownMax: number | null = null;
  let last: readonly ShopRow[] = [];

  const close = (): void => {
    id = null;
    shownMax = null;
    sheet.hidden = true;
  };
  const draw = (): void => {
    const r = id === null ? undefined : last.find((x) => x.itemId === id);
    if (!r) {
      close();
      return;
    }
    sheet.hidden = false;
    setText(label, r.label);
    setText(detail, r.detail);
    setText(price, r.price.text);
    shownMax = r.price.kind === 'game' ? r.price.maxGame : null;
    setText(max, shownMax === null ? '' : `You pay at most ${gameText(shownMax)} GAME`);
    setText(split, splitText(shopItem(r.itemId)));
    const blocked = r.state !== 'buy' || shownMax === null;
    confirm.disabled = blocked;
    note.hidden = !blocked;
    setText(note, r.state === 'paused' ? PAUSED : blocked ? buttonText(r) : '');
  };
  cancel.addEventListener('click', () => {
    close();
    onCancel();
  });
  confirm.addEventListener('click', () => {
    const at = id;
    const cap = shownMax;
    if (at === null || cap === null || confirm.disabled) return;
    close();
    onConfirm(at, cap);
  });
  return {
    el: sheet,
    open: (itemId) => {
      id = itemId;
      draw();
    },
    render: (rows) => {
      last = rows;
      draw();
    },
  };
}

/**
 * The Shop app (spec §8): a Coins tab (fuel, cosmetics) and a Token tab (the four upgrade ladders, premium skins,
 * the lockout skip) with USD and GAME prices, live from the HUD model. A Coin item buys on the first tap; a GAME
 * item's Buy opens the confirm sheet (createConfirmSheet).
 */
export function createShopApp(cb: ShopCallbacks): PhoneAppView {
  const root = el('section', 'phone-shop');
  const head = el('div', 'phone-shop-head', root);
  const balance = el('span', 'phone-shop-balance', head);
  mockBadge(head);
  const tabs = el('div', 'phone-shop-tabs', root);
  const panels = {} as Record<ShopTab, HTMLElement>;
  const tabButtons = {} as Record<ShopTab, HTMLButtonElement>;
  const paused = el('p', 'phone-shop-paused');
  paused.textContent = PAUSED;
  paused.hidden = true;
  let tab: ShopTab = 'token';
  const showTab = (t: ShopTab): void => {
    tab = t;
    for (const k of ['coins', 'token'] as const) {
      panels[k].hidden = k !== t;
      tabButtons[k].classList.toggle('active', k === t);
      tabButtons[k].setAttribute('aria-pressed', String(k === t));
    }
  };
  for (const [t, title] of [
    ['coins', 'Coins'],
    ['token', 'Token'],
  ] as const) {
    const b = el('button', 'phone-shop-tab', tabs);
    b.type = 'button';
    b.dataset.tab = t;
    b.textContent = title;
    b.addEventListener('click', () => showTab(t));
    tabButtons[t] = b;
    const panel = el('div', 'phone-shop-panel', root);
    panel.dataset.tab = t;
    panels[t] = panel;
  }
  panels.token.appendChild(paused);
  const sections = new Map<ShopSection, SectionView>();
  for (const t of ['coins', 'token'] as const) {
    for (const name of SECTIONS[t]) {
      const wrap = el('div', 'phone-shop-section', panels[t]);
      el('h3', 'phone-section', wrap).textContent = name;
      sections.set(name, { el: wrap, list: el('div', 'phone-list', wrap), rows: new Map() });
    }
  }
  showTab(tab);

  const sheet = createConfirmSheet(root, cb.confirm, cb.cancel);

  const create = (r: ShopRow): RowView => {
    const row = el('div', 'phone-card phone-shop-row');
    row.dataset.id = r.itemId;
    const swatch = el('span', 'phone-shop-swatch', row);
    const text = el('div', 'phone-shop-text', row);
    const label = el('div', 'phone-shop-label', text);
    const detail = el('div', 'phone-shop-detail', text);
    const price = el('div', 'phone-shop-price', text);
    const button = el('button', 'phone-btn phone-shop-buy', row);
    button.type = 'button';
    button.dataset.action = 'buy';
    button.dataset.id = r.itemId;
    button.addEventListener('click', () => {
      if (button.disabled) return;
      const item = shopItem(r.itemId);
      if (item.currency === 'coins') {
        cb.buy(r.itemId);
        return;
      }
      sheet.open(r.itemId);
    });
    return { el: row, swatch, label, detail, price, button };
  };
  const update = (v: RowView, r: ShopRow): void => {
    setText(v.label, r.label);
    setText(v.detail, r.detail);
    setText(v.price, r.price.text);
    if (v.el.dataset.state !== r.state) {
      v.el.dataset.state = r.state;
      for (const s of Object.keys(BUTTON)) v.el.classList.toggle(s, s === r.state);
    }
    v.swatch.hidden = r.swatch === undefined;
    const color = r.swatch ?? '';
    if (r.swatch !== undefined && v.swatch.dataset.color !== color) {
      v.swatch.dataset.color = color;
      v.swatch.style.setProperty('--swatch', color || 'transparent');
      v.swatch.classList.toggle('factory', r.swatch === null);
    }
    v.button.disabled = r.state !== 'buy';
    setText(v.button, buttonText(r));
  };

  return {
    el: root,
    render: (m: HudModel) => {
      setText(balance, `${gameText(m.wallet.balance)} GAME · ${m.totals.coins} Coins`);
      for (const [name, s] of sections) {
        syncList(
          s.list,
          s.rows,
          m.shop.filter((r) => r.section === name),
          (r) => r.itemId,
          create,
          update,
        );
      }
      paused.hidden = !m.shop.some((r) => r.tab === 'token' && r.price.kind === 'paused');
      sheet.render(m.shop);
    },
  };
}
