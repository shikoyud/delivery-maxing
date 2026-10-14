import { el, setText } from '../dom';
import type { HudModel } from '../hudModel';

interface WalletView {
  points: HTMLElement;
  coins: HTMLElement;
  deliveries: HTMLElement;
}

const views = new WeakMap<HTMLElement, WalletView>();

function build(root: HTMLElement): WalletView {
  const wrap = el('div', 'phone-wallet', root);
  const row = (label: string, cls: string): HTMLElement => {
    const r = el('div', `phone-wallet-row ${cls}`, wrap);
    el('span', 'phone-wallet-label', r).textContent = label;
    return el('b', 'phone-wallet-value', r);
  };
  const v = { points: row('Delivery Points', 'points'), coins: row('Coins', 'coins'), deliveries: row('Deliveries', 'deliveries') };
  // No GAME amounts until the reward program exists (spec §9 is Pending): nothing invented.
  el('p', 'phone-note', wrap).textContent = 'GAME rewards arrive with the reward program (spec §9)';
  return v;
}

/** The Wallet app (spec §8): what the player has earned so far; GAME and Claim come with the reward program. */
export function renderWalletApp(root: HTMLElement, model: HudModel): void {
  let v = views.get(root);
  if (!v) views.set(root, (v = build(root)));
  setText(v.points, String(model.totals.points));
  setText(v.coins, String(model.totals.coins));
  setText(v.deliveries, String(model.totals.deliveries));
}
