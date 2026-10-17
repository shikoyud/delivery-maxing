import { economyConfig, shopItem, type EconomyConfig, type ShopItem, type ShopItemId } from '@dm/shared';
import { el, mockBadge, setText } from '../dom';
import { gamePriceText } from '../hudModel';
import type { ShopRow } from './shopApp';

export const PAUSED = 'Prices updating, purchases paused';

/** Where a GAME purchase's GAME goes: "80% burned · 20% to the reward vault" for a line tier, else "100% burned". */
export function splitText(item: ShopItem, econ: EconomyConfig = economyConfig): string {
  if (item.kind !== 'line') return '100% burned';
  const vault = Math.round(econ.split.linePool * 100);
  return `${100 - vault}% burned · ${vault}% to the reward vault`;
}

export const BUTTON: Record<ShopRow['state'], string> = { buy: 'Buy', owned: '✓ Owned', pending: 'Confirming…', locked: 'Locked', paused: 'Paused' };

/** The row button's copy (the lockout skip without a lockout says so). */
export function buttonText(r: ShopRow): string {
  if (r.state === 'locked' && r.itemId === 'lockoutSkip') return 'No lockout';
  return BUTTON[r.state];
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
    setText(max, shownMax === null ? '' : `You pay at most ${gamePriceText(shownMax)} GAME`);
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
