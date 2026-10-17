import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { GAME_UNITS, boostMultiplier, economyConfig, payoutRange, usdToGame } from '@dm/shared';
import { MockChain } from '../src/economy/MockChain';
import { dateText, gameText, usdText, walletModel } from '../src/ui/hudModel';
import { createWalletApp } from '../src/ui/phone/walletApp';
import type { PhoneAppView } from '../src/ui/phone/Phone';
import { installFakeDom, type FakeElement } from './fakeDom';
import { model } from './phoneFixtures';

const DAY = 86_400_000;
const T0 = 1_760_000_000_000;

let dom: ReturnType<typeof installFakeDom>;
beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => dom.restore());

/** A MockChain on a fake wall clock, the Wallet app on the fake DOM, and what its buttons sent. */
function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const chain = new MockChain(null, economyConfig, clock);
  const calls: string[] = [];
  const app: PhoneAppView = createWalletApp({
    claim: () => void calls.push('claim'),
    lockGame: (game) => void calls.push(`lock ${game}`),
    withdrawLock: () => void calls.push('withdraw'),
  });
  dom.host.appendChild(app.el as unknown as FakeElement);
  const totals = { points: 7, coins: 70, deliveries: 3 };
  const render = (): void => app.render(model({ totals, wallet: walletModel(chain, clock.t, true) }), { x: 0, y: 0, z: 0 }, 0);
  const one = (cls: string): FakeElement => {
    const [e] = dom.host.byClass(cls);
    if (!e) throw new Error(`no .${cls}`);
    return e;
  };
  const action = (name: string): FakeElement => {
    const [e] = dom.host.findAll((x) => x.dataset.action === name);
    if (!e) throw new Error(`no [data-action=${name}]`);
    return e;
  };
  const pay = (usdMicro: number, at = clock.t) =>
    chain.accrue({ orderId: `o${at}`, usdMicro, luck: 0.5, quality: 1, usdPerGame: chain.rate()!.usdPerGame, boost: 1, at, detail: { tier: 'car', kind: 'food', inTime: true } });
  return { clock, chain, calls, render, one, action, pay, totals };
}

describe('the Wallet app (spec §8, §6.4)', () => {
  test('shows the mock badge, balance, accrued with Claim, the vault in GAME and USD, and the totals', async () => {
    const s = setup();
    s.render();
    expect(s.one('phone-wallet-address').textContent).toContain('DEV-WALLET');
    expect(s.one('phone-wallet-address').byClass('phone-mock-badge')[0]!.textContent).toBe('Mock wallet');
    expect(s.one('phone-wallet-balance').textContent).toBe('600,000 GAME');
    expect(s.one('phone-wallet-accrued').textContent).toBe('0 GAME');
    expect(s.action('claim').disabled).toBe(true); // nothing to claim
    const p = s.pay(210_000);
    s.render();
    expect(s.one('phone-wallet-accrued').textContent).toBe(`${gameText(p.game)} GAME`);
    expect(s.action('claim').disabled).toBe(false);
    s.action('claim').click();
    expect(s.calls).toEqual(['claim']);
    // The mock claim is instant; the claim history lists it.
    s.clock.t += 120_000;
    await s.chain.claim(s.clock.t);
    s.clock.t += 60_000;
    s.render();
    expect(s.one('phone-wallet-accrued').textContent).toBe('0 GAME');
    const claim = s.one('phone-wallet-claims').byClass('phone-wallet-item')[0]!;
    expect(claim.byClass('phone-wallet-line')[0]!.textContent).toBe(`Claimed ${gameText(p.game)} GAME`);
    expect(claim.byClass('phone-wallet-when')[0]!.textContent).toBe('1 min ago');
    const vault = s.chain.vault();
    expect(s.one('phone-wallet-vault').textContent).toBe(`${gameText(vault)} GAME`);
    expect(s.one('phone-wallet-vault-usd').textContent).toBe(usdText(Math.floor(vault * s.chain.rate()!.usdPerGame)));
    expect(s.one('phone-wallet-vault-usd').textContent).toMatch(/^\$49\.\d\d$/); // $50 less one $0.21 payout
    expect(s.one('phone-wallet-vault-empty').hidden).toBe(true);
    const t = s.one('phone-wallet-totals').textContent;
    expect(t).toContain('Delivery Points7');
    expect(t).toContain('Coins70');
    expect(t).toContain('Deliveries3');
    // Top to bottom: address, Earned, Vault, Boost, Payouts, Purchases, the totals.
    expect(dom.host.byClass('phone-section').map((h) => h.textContent)).toEqual(['Earned', 'Vault', 'Boost', 'Payouts', 'Purchases', 'Totals']);
  });

  test('the Lock form previews the boost live; locking disables the form and shows Withdraw only after 7 days', () => {
    const s = setup();
    s.render();
    const amount = s.one('phone-wallet-amount') as FakeElement & { value: string };
    const lock = s.action('lock');
    expect(lock.textContent).toBe(`Lock ${economyConfig.lock.days} days`);
    expect(lock.disabled).toBe(true); // no amount yet
    amount.value = '100000';
    amount.dispatchEvent({ type: 'input' } as never);
    // 100,000 GAME at $0.00024 = $24 locked: 1 + 0.3 × 0.24 = ×1.07.
    expect(boostMultiplier(24_000_000)).toBeCloseTo(1.072, 9);
    expect(s.one('phone-wallet-preview').textContent).toBe('$24.00 locked · ×1.07 boost on every order');
    expect(lock.disabled).toBe(false);
    lock.click();
    expect(s.calls).toEqual([`lock ${100_000 * GAME_UNITS}`]);
    amount.value = '700000'; // more than the balance
    amount.dispatchEvent({ type: 'input' } as never);
    expect(lock.disabled).toBe(true);
    expect(s.one('phone-wallet-preview').textContent).toBe('Not enough GAME');
    amount.value = '100000';
    amount.dispatchEvent({ type: 'input' } as never);

    expect(s.chain.lockGame(100_000 * GAME_UNITS, s.clock.t)).toEqual({ ok: true });
    s.render();
    expect(s.one('phone-wallet-lock-form').hidden).toBe(true);
    expect(lock.disabled).toBe(true);
    const view = s.one('phone-wallet-lock');
    expect(view.hidden).toBe(false);
    expect(view.textContent).toContain('100,000 GAME locked');
    expect(view.textContent).toContain('×1.07 boost');
    expect(view.textContent).toContain(`Unlocks ${dateText(T0 + 7 * DAY)}`);
    expect(s.action('withdraw').hidden).toBe(true);
    s.clock.t = T0 + 7 * DAY - 1;
    s.render();
    expect(s.action('withdraw').hidden).toBe(true);
    // At 7 days the lock renews, and may be withdrawn in the window after the period that ended.
    s.clock.t = T0 + 7 * DAY;
    s.chain.tick(s.clock.t);
    s.render();
    expect(s.one('phone-wallet-lock').textContent).toContain(`Unlocks ${dateText(T0 + 14 * DAY)}`);
    expect(s.action('withdraw').hidden).toBe(false);
    s.action('withdraw').click();
    expect(s.calls.at(-1)).toBe('withdraw');
  });

  test('payouts are newest first, at most 20, with USD, GAME and "vault empty" rows; purchases list burned, vault and status', async () => {
    const s = setup();
    for (let i = 0; i < 24; i++) s.pay(210_000 + i, T0 + i * 1000);
    s.chain.dev.setVaultUsd(0);
    s.pay(250_000, T0 + 30_000);
    s.clock.t = T0 + 31_000;
    const confirmed = await s.chain.purchase('line.bag.1', 10_000 * GAME_UNITS, s.clock.t);
    s.chain.dev.failNext();
    await s.chain.purchase('line.shoes.1', 10_000 * GAME_UNITS, s.clock.t);
    s.clock.t += economyConfig.mockChain.confirmSeconds * 1000;
    s.chain.tick(s.clock.t);
    await s.chain.purchase('line.bag.2', 10_000 * GAME_UNITS, s.clock.t);
    s.render();

    const payouts = s.one('phone-wallet-payouts').byClass('phone-wallet-payout');
    expect(payouts).toHaveLength(20);
    const line = (e: FakeElement): string => e.byClass('phone-wallet-line')[0]!.textContent;
    expect(line(payouts[0]!)).toBe('Car · hot · vault empty');
    expect(payouts[0]!.byClass('phone-wallet-when')[0]!.textContent).toBe('just now');
    expect(payouts[0]!.classList.contains('unpaid')).toBe(true);
    // The newest paid one: $0.210023 ≈ 875 GAME at $0.00024.
    expect(gameText(usdToGame(210_023, { usdPerGame: 0.00024, updatedAt: 0 }))).toBe('875');
    expect(line(payouts[1]!)).toBe('Car · hot · $0.21 ≈ 875 GAME');
    expect(payouts.every((p) => !p.textContent.includes('undefined'))).toBe(true);

    const txs = s.one('phone-wallet-txs').byClass('phone-wallet-tx');
    expect(txs).toHaveLength(3);
    expect(txs[0]!.textContent).toContain('Bag 2');
    expect(txs[0]!.textContent).toContain('Confirming…');
    expect(txs[1]!.textContent).toContain('Shoes 1');
    expect(txs[1]!.textContent).toContain('Failed');
    const tx = s.chain.history().find((t) => t.id === confirmed.id)!;
    expect(tx.status).toBe('confirmed');
    expect(txs[2]!.textContent).toContain('Bag 1');
    expect(txs[2]!.textContent).toContain(`${gameText(tx.game)} GAME · ${gameText(tx.burned)} burned · ${gameText(tx.vault)} to the vault`);
    expect(txs[2]!.textContent).toContain('Confirmed');
  });

  test('"Vault empty · orders pay no GAME" appears when the vault is below the walk minimum (Review Focus 5)', () => {
    const s = setup();
    const walkMin = payoutRange('walk').minMicro / 1e6;
    s.chain.dev.setVaultUsd(walkMin * 0.8);
    s.render();
    const empty = s.one('phone-wallet-vault-empty');
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe('Vault empty · orders pay no GAME');
    s.chain.dev.setVaultUsd(walkMin);
    s.render();
    expect(empty.hidden).toBe(true);
    s.chain.dev.setVaultUsd(0);
    s.render();
    expect(empty.hidden).toBe(false);
  });
});
