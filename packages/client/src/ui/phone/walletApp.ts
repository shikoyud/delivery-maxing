import { GAME_UNITS, boostMultiplier, economyConfig, type PurchaseError } from '@dm/shared';
import { el, mockBadge, setText } from '../dom';
import { boostText, gameText, usdText, type HudModel, type HudTx } from '../hudModel';
import type { PhoneAppView } from './Phone';

export interface WalletCallbacks {
  /** Claim the accrued GAME into the balance (the mock's is instant). */
  claim(): void;
  /** Lock `game` base units for `lock.days` days (lock-to-boost, spec §6.4). */
  lockGame(game: number): void;
  /** Withdraw the lock (allowed once its period has ended). */
  withdrawLock(): void;
}

const STATUS: Record<HudTx['status'], string> = { pending: 'Confirming…', confirmed: 'Confirmed', failed: 'Failed' };
const ERROR: Record<PurchaseError, string> = {
  rejected: 'rejected',
  stale: 'prices updating',
  slippage: 'the price moved',
  insufficient: 'not enough GAME',
  owned: 'already owned',
  order: 'buy the tier before',
};

/** Whole GAME typed in the amount field ("100,000" ok), as base units; null when it is not a positive whole number. */
function parseAmount(raw: string): number | null {
  const t = raw.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(t)) return null;
  const units = Number(t) * GAME_UNITS;
  return units > 0 && Number.isSafeInteger(units) ? units : null;
}

/** Replaces a list's rows when their content changed (the lists are short and change rarely). */
function syncRows<T>(list: HTMLElement, items: readonly T[], draw: (item: T, row: HTMLElement) => void, rowClass: string, empty: string): void {
  const key = JSON.stringify(items);
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.textContent = '';
  if (items.length === 0) {
    el('p', 'phone-empty', list).textContent = empty;
    return;
  }
  for (const item of items) draw(item, el('div', `phone-wallet-item ${rowClass}`, list));
}

/** A list row: its text and, on the right, when. */
function rowText(row: HTMLElement, text: string, when: string): void {
  el('span', 'phone-wallet-line', row).textContent = text;
  el('span', 'phone-wallet-when', row).textContent = when;
}

/**
 * The Wallet app (spec §8, §6.4), top to bottom: the address with the Mock wallet badge and the balance; Earned (the
 * accrued GAME, Claim, the claim history); the reward vault in GAME and USD ("Vault empty" when orders pay no GAME);
 * Boost (the lock, or the Lock form with the boost previewed live); the last payouts and purchases; the totals.
 */
export function createWalletApp(cb: WalletCallbacks, cfg = economyConfig): PhoneAppView {
  const root = el('section', 'phone-wallet');
  const head = el('div', 'phone-wallet-address', root);
  const address = el('span', 'phone-wallet-address-text', head);
  const badge = mockBadge(head);
  const balanceRow = el('div', 'phone-wallet-row balance', root);
  el('span', 'phone-wallet-label', balanceRow).textContent = 'Balance';
  const balance = el('b', 'phone-wallet-value phone-wallet-balance', balanceRow);

  const section = (title: string): HTMLElement => {
    el('h3', 'phone-section', root).textContent = title;
    return el('div', 'phone-card phone-wallet-card', root);
  };

  const earned = section('Earned');
  const earnedRow = el('div', 'phone-wallet-figure', earned);
  const accrued = el('b', 'phone-wallet-value phone-wallet-accrued', earnedRow);
  const claim = el('button', 'phone-btn phone-wallet-claim', earnedRow);
  claim.type = 'button';
  claim.dataset.action = 'claim';
  claim.textContent = 'Claim';
  claim.addEventListener('click', () => {
    if (!claim.disabled) cb.claim();
  });
  const claimNote = el('p', 'phone-note', earned);
  const claims = el('div', 'phone-wallet-list phone-wallet-claims', earned);

  const vaultCard = section('Vault');
  const vaultRow = el('div', 'phone-wallet-figure', vaultCard);
  const vault = el('b', 'phone-wallet-value phone-wallet-vault', vaultRow);
  const vaultUsd = el('span', 'phone-wallet-vault-usd', vaultRow);
  const vaultEmpty = el('p', 'phone-wallet-vault-empty', vaultCard);
  vaultEmpty.textContent = 'Vault empty · orders pay no GAME';
  el('p', 'phone-note', vaultCard).textContent = `Pays every order’s GAME; ${Math.round(cfg.split.linePool * 100)}% of every upgrade refills it`;

  const boost = section('Boost');
  const lockView = el('div', 'phone-wallet-lock', boost);
  const lockAmount = el('b', 'phone-wallet-lock-amount', lockView);
  const lockBoost = el('div', 'phone-wallet-lock-boost', lockView);
  const lockUnlock = el('div', 'phone-wallet-lock-unlock', lockView);
  const lockNote = el('p', 'phone-note', lockView);
  const withdraw = el('button', 'phone-btn phone-wallet-withdraw', lockView);
  withdraw.type = 'button';
  withdraw.dataset.action = 'withdraw';
  withdraw.textContent = 'Withdraw';
  withdraw.addEventListener('click', () => {
    if (!withdraw.hidden) cb.withdrawLock();
  });
  const form = el('div', 'phone-wallet-lock-form', boost);
  const formRow = el('div', 'phone-wallet-figure', form);
  const amount = el('input', 'phone-wallet-amount', formRow);
  amount.type = 'text';
  amount.inputMode = 'numeric';
  amount.placeholder = 'GAME to lock';
  amount.setAttribute('aria-label', 'GAME to lock');
  amount.value = '';
  const lock = el('button', 'phone-btn phone-wallet-lock-btn', formRow);
  lock.type = 'button';
  lock.dataset.action = 'lock';
  lock.textContent = `Lock ${cfg.lock.days} days`;
  const preview = el('div', 'phone-wallet-preview', form);
  el('p', 'phone-note', boost).textContent =
    `Locked GAME boosts every payout: up to ${boostText(1 + cfg.lock.maxBoost)} at ${usdText(cfg.lock.fullBoostUsdMicro)} locked`;

  const payouts = el('div', 'phone-wallet-list phone-wallet-payouts', section('Payouts'));
  const txs = el('div', 'phone-wallet-list phone-wallet-txs', section('Purchases'));

  const totals = section('Totals');
  totals.classList.add('phone-wallet-totals');
  const stat = (label: string, cls: string): HTMLElement => {
    const r = el('div', `phone-wallet-row ${cls}`, totals);
    el('span', 'phone-wallet-label', r).textContent = label;
    return el('b', 'phone-wallet-value', r);
  };
  const points = stat('Delivery Points', 'points');
  const coins = stat('Coins', 'coins');
  const deliveries = stat('Deliveries', 'deliveries');

  let last: HudModel | null = null;
  /** The Lock form's preview and button from the typed amount and the last model. */
  const drawForm = (): void => {
    const w = last?.wallet;
    const units = parseAmount(amount.value);
    let text: string;
    let ok = false;
    if (!w || w.lock) text = '';
    else if (amount.value.trim() === '') text = 'Type the GAME to lock';
    else if (units === null) text = 'Whole GAME only';
    else if (units > w.balance) text = 'Not enough GAME';
    else if (w.usdPerGame === null) text = 'Prices updating'; // the lock is valued at the rate: none, no lock
    else {
      const usdMicro = Math.round(units * w.usdPerGame); // base units × USD per GAME = micro-USD, as the lock values it
      text = `${usdText(usdMicro)} locked · ${boostText(boostMultiplier(usdMicro, cfg))} boost on every order`;
      ok = true;
    }
    setText(preview, text);
    lock.disabled = !ok;
  };
  amount.addEventListener('input', drawForm);
  lock.addEventListener('click', () => {
    const units = parseAmount(amount.value);
    if (lock.disabled || units === null) return;
    cb.lockGame(units);
    amount.value = ''; // the form starts empty for the next lock (a refusal pops up with the reason)
    drawForm();
  });

  return {
    el: root,
    render: (m: HudModel) => {
      last = m;
      const w = m.wallet;
      setText(address, w.address);
      badge.hidden = !w.mock;
      setText(balance, `${gameText(w.balance)} GAME`);

      setText(accrued, `${gameText(w.accrued)} GAME`);
      claim.disabled = w.accrued <= 0;
      setText(claimNote, w.mock ? 'Mock wallet: a claim lands in the balance at once' : 'You sign the claim and pay the fee');
      syncRows(claims, w.claims, (c, row) => rowText(row, `Claimed ${gameText(c.game)} GAME`, c.when), 'phone-wallet-claim-row', 'No claims yet');

      setText(vault, `${gameText(w.vault)} GAME`);
      setText(vaultUsd, w.vaultUsd);
      vaultEmpty.hidden = !w.vaultEmpty;

      lockView.hidden = w.lock === null;
      form.hidden = w.lock !== null;
      if (w.lock) {
        setText(lockAmount, `${gameText(w.lock.game)} GAME locked`);
        setText(lockBoost, `${w.lock.boostText} boost on every order`);
        setText(lockUnlock, `Unlocks ${w.lock.unlocksAt}`);
        setText(lockNote, w.lock.canWithdraw ? 'The period ended: withdraw now, or it renews' : `Renews for ${cfg.lock.days} days unless withdrawn after it ends`);
        withdraw.hidden = !w.lock.canWithdraw;
      }
      drawForm();

      syncRows(
        payouts,
        w.payouts,
        (p, row) => {
          row.classList.toggle('unpaid', !p.paid);
          const boost = p.boost ? ` · ${p.boost}` : '';
          rowText(row, p.paid ? `${p.label} · ${p.usd} ≈ ${gameText(p.game)} GAME${boost}` : `${p.label} · vault empty`, p.when);
        },
        'phone-wallet-payout',
        'No payouts yet: deliver an order',
      );
      syncRows(
        txs,
        w.history,
        (t, row) => {
          row.dataset.status = t.status;
          const status = t.status === 'failed' && t.error ? `${STATUS.failed} · ${ERROR[t.error as PurchaseError] ?? t.error}` : STATUS[t.status];
          rowText(row, `${t.label} · ${status}`, t.when);
          const detail = el('span', 'phone-wallet-tx-detail', row);
          detail.textContent =
            t.status === 'confirmed'
              ? `${gameText(t.game)} GAME · ${gameText(t.burned)} burned · ${gameText(t.vault)} to the vault`
              : t.status === 'failed'
                ? 'Nothing charged'
                : 'Charged once it confirms';
        },
        'phone-wallet-tx',
        'No purchases yet',
      );

      setText(points, String(m.totals.points));
      setText(coins, String(m.totals.coins));
      setText(deliveries, String(m.totals.deliveries));
    },
  };
}
