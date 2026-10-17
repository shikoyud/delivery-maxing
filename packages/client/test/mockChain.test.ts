import { describe, expect, test } from 'vitest';
import { economyConfig, GAME_UNITS, quote, usdToGame, type ChainTx } from '@dm/shared';
import { MOCK_CHAIN_KEY, MockChain } from '../src/economy/MockChain';

const cfg = economyConfig;
const DAY = 86_400_000;
const T0 = 1_760_000_000_000;
const CONFIRM_MS = cfg.mockChain.confirmSeconds * 1000;
const START = cfg.mockChain.startGame * GAME_UNITS;

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function setup(storage = memoryStorage()) {
  const clock = { t: T0, now() { return this.t; } };
  const chain = new MockChain(storage, cfg, clock);
  return { chain, clock, storage };
}

/** The quote the shop would show now, and its maxGame. */
function shopQuote(chain: MockChain, usdMicro: number, now: number): { game: number; maxGame: number } {
  const q = quote(usdMicro, chain.rate(), now, cfg);
  if (!q.ok) throw new Error(q.reason);
  return q;
}

const usd = (d: number): number => d * 1e6;

describe('MockChain', () => {
  test('a confirmed vehicle tier charges the quote, records 80/20, grows the vault and raises the line after confirmSeconds', async () => {
    const { chain, clock } = setup();
    const vault0 = chain.vault();
    const q = shopQuote(chain, usd(2), clock.t);
    const tx = await chain.purchase('line.vehicle.1', q.maxGame, clock.t);
    expect(tx.status).toBe('pending');
    expect(chain.balance()).toBe(START);
    expect(chain.ownership().lines.vehicle).toBe(0);

    chain.tick(clock.t + CONFIRM_MS - 1);
    expect(chain.history()[0]!.status).toBe('pending');

    clock.t += CONFIRM_MS;
    chain.tick(clock.t);
    const done = chain.history()[0]!;
    expect(done).toMatchObject({ id: tx.id, status: 'confirmed', game: q.game, settledAt: clock.t });
    expect(done.vault).toBe(Math.floor(q.game * 0.2));
    expect(done.burned + done.vault).toBe(q.game);
    expect(chain.balance()).toBe(START - q.game);
    expect(chain.vault()).toBe(vault0 + done.vault);
    expect(chain.ownership().lines.vehicle).toBe(1);
    // $2 at $0.00024 is 8,333.333334 GAME (rounded up to the base unit).
    expect(q.game).toBe(8_333_333_334);
  });

  test('tiers must be bought in order; an owned tier is refused; insufficient GAME is refused; nothing charged', async () => {
    const { chain, clock } = setup();
    const order = await chain.purchase('line.vehicle.3', Number.MAX_SAFE_INTEGER, clock.t);
    expect(order).toMatchObject({ status: 'failed', error: 'order', game: 0 });

    chain.dev.grantTier('vehicle', 2);
    const owned = await chain.purchase('line.vehicle.2', Number.MAX_SAFE_INTEGER, clock.t);
    expect(owned).toMatchObject({ status: 'failed', error: 'owned' });

    chain.dev.addGame(-START + 1);
    const poor = await chain.purchase('line.vehicle.3', Number.MAX_SAFE_INTEGER, clock.t);
    expect(poor).toMatchObject({ status: 'failed', error: 'insufficient' });

    clock.t += CONFIRM_MS;
    chain.tick(clock.t);
    expect(chain.balance()).toBe(1);
    expect(chain.ownership().lines.vehicle).toBe(2);
    expect(chain.history().map((t) => t.status)).toEqual(['failed', 'failed', 'failed']);
  });

  test('the price rising 20% before confirmation fails with slippage and charges nothing (Review Focus 1)', async () => {
    const { chain, clock } = setup();
    const vault0 = chain.vault();
    const q = shopQuote(chain, usd(12), clock.t);
    expect(q.game).toBe(50_000 * GAME_UNITS);
    chain.dev.grantTier('vehicle', 2);
    await chain.purchase('line.vehicle.3', q.maxGame, clock.t);
    // The GAME price of the motorbike rises 20%: GAME falls to 1/1.2 of its USD price (a 16.7% rate move).
    expect(chain.dev.setRate(cfg.mockChain.usdPerGame / 1.2)).toBe(true);
    clock.t += CONFIRM_MS;
    chain.tick(clock.t);
    expect(chain.history()[0]).toMatchObject({ status: 'failed', error: 'slippage', game: 0, burned: 0, vault: 0 });
    expect(chain.balance()).toBe(START);
    expect(chain.vault()).toBe(vault0);
    expect(chain.ownership().lines.vehicle).toBe(2);
    // The shop's new quote is 60,000 GAME.
    expect(shopQuote(chain, usd(12), clock.t).game).toBe(60_000 * GAME_UNITS);
  });

  test('the rate going stale before confirmation fails with stale and charges nothing (Review Focus 1)', async () => {
    const { chain, clock } = setup();
    const q = shopQuote(chain, usd(2), clock.t);
    await chain.purchase('line.vehicle.1', q.maxGame, clock.t);
    chain.dev.makeRateStale();
    expect(quote(usd(2), chain.rate(), clock.t, cfg)).toEqual({ ok: false, reason: 'stale' });
    clock.t += CONFIRM_MS;
    chain.tick(clock.t);
    expect(chain.history()[0]).toMatchObject({ status: 'failed', error: 'stale' });
    expect(chain.balance()).toBe(START);
    expect(chain.ownership().lines.vehicle).toBe(0);
    // A stale rate refuses a new purchase at once; setting a rate makes it live again.
    expect(await chain.purchase('line.vehicle.1', q.maxGame, clock.t)).toMatchObject({ status: 'failed', error: 'stale' });
    expect(chain.dev.setRate(cfg.mockChain.usdPerGame)).toBe(true);
    expect(quote(usd(2), chain.rate(), clock.t, cfg).ok).toBe(true);
  });

  test('failNext fails the next purchase at once as rejected', async () => {
    const { chain, clock } = setup();
    const q = shopQuote(chain, usd(2), clock.t);
    chain.dev.failNext();
    expect(await chain.purchase('line.vehicle.1', q.maxGame, clock.t)).toMatchObject({ status: 'failed', error: 'rejected', game: 0 });
    expect(chain.balance()).toBe(START);
    expect(await chain.purchase('line.vehicle.1', q.maxGame, clock.t)).toMatchObject({ status: 'pending' });
    // Unknown items and Coin items never reach the chain.
    expect(await chain.purchase('nope', q.maxGame, clock.t)).toMatchObject({ status: 'failed', error: 'rejected' });
    expect(await chain.purchase('fuelCan', q.maxGame, clock.t)).toMatchObject({ status: 'failed', error: 'rejected' });
  });

  test('a pending purchase survives a reload and settles exactly once (Review Focus 2)', async () => {
    const storage = memoryStorage();
    const first = setup(storage);
    const q = shopQuote(first.chain, usd(2), T0);
    const tx = await first.chain.purchase('line.vehicle.1', q.maxGame, T0);
    first.chain.tick(T0 + 1000); // the tab closes one second after Confirm

    const reload = setup(storage);
    expect(reload.chain.history()).toEqual([expect.objectContaining({ id: tx.id, status: 'pending' })]);
    reload.chain.tick(T0 + CONFIRM_MS);
    reload.chain.tick(T0 + CONFIRM_MS + 1000);
    const again = setup(storage);
    again.chain.tick(T0 + CONFIRM_MS + 2000);

    for (const c of [reload.chain, again.chain]) {
      expect(c.balance()).toBe(START - q.game);
      expect(c.ownership().lines.vehicle).toBe(1);
      expect(c.history().filter((t: ChainTx) => t.status === 'confirmed')).toHaveLength(1);
    }
  });

  test('accrue pays from the vault into accrued; a payout the vault cannot cover is recorded unpaid and the vault is untouched (Review Focus 5)', () => {
    const { chain, clock } = setup();
    const rate = { usdPerGame: cfg.mockChain.usdPerGame, updatedAt: clock.t };
    const vault0 = chain.vault();
    expect(vault0).toBe(usdToGame(usd(50), rate));
    const base = { orderId: 'o1', luck: 0.5, quality: 0.8, usdPerGame: rate.usdPerGame, at: clock.t };

    const p = chain.accrue({ ...base, usdMicro: 120_000, boost: 1 });
    expect(p).toMatchObject({ paid: true, game: 500 * GAME_UNITS, usdMicro: 120_000, luck: 0.5, quality: 0.8 });
    expect(chain.accrued()).toBe(500 * GAME_UNITS);
    expect(chain.vault()).toBe(vault0 - 500 * GAME_UNITS);

    // usdMicro is the boosted amount ($0.12 × 1.15 = $0.138); accrue converts it as is and only records the boost.
    const boosted = chain.accrue({ ...base, orderId: 'o2', usdMicro: 138_000, boost: 1.15 });
    expect(boosted).toMatchObject({ game: 575 * GAME_UNITS, usdMicro: 138_000, boost: 1.15 });

    chain.dev.setVaultUsd(0.1);
    const vaultShort = chain.vault();
    const accrued = chain.accrued();
    const unpaid = chain.accrue({ ...base, orderId: 'o3', usdMicro: 250_000, boost: 1 });
    expect(unpaid).toMatchObject({ paid: false, game: 0, usdMicro: 250_000 });
    expect(chain.vault()).toBe(vaultShort);
    expect(chain.accrued()).toBe(accrued);

    chain.dev.setVaultUsd(50);
    expect(chain.accrue({ ...base, orderId: 'o4', usdMicro: 250_000, boost: 1 }).paid).toBe(true);
    expect(chain.payouts().map((x) => x.orderId)).toEqual(['o1', 'o2', 'o3', 'o4']);
  });

  test('lockGame moves GAME out of the balance; withdraw is tooEarly before 7 days; the lock renews at 7 days unless withdrawn', () => {
    const { chain, clock } = setup();
    const game = 100_000 * GAME_UNITS;
    expect(chain.lockGame(START + 1, clock.t)).toEqual({ ok: false, reason: 'insufficient' });
    expect(chain.withdrawLock(clock.t)).toEqual({ ok: false, reason: 'none' });
    expect(chain.lockGame(game, clock.t)).toEqual({ ok: true });
    expect(chain.lockGame(1, clock.t)).toEqual({ ok: false, reason: 'locked' });
    expect(chain.balance()).toBe(START - game);
    expect(chain.lock()).toEqual({ game, usdMicroAtLock: 24_000_000, lockedAt: T0, unlocksAt: T0 + 7 * DAY });

    chain.tick(T0 + 7 * DAY - 1);
    expect(chain.withdrawLock(T0 + 7 * DAY - 1)).toEqual({ ok: false, reason: 'tooEarly' });

    // Not withdrawn: at 7 days it renews for another 7, and stays withdrawable through the window after the end.
    chain.tick(T0 + 7 * DAY);
    expect(chain.lock()).toEqual({ game, usdMicroAtLock: 24_000_000, lockedAt: T0 + 7 * DAY, unlocksAt: T0 + 14 * DAY });
    const windowMs = cfg.lock.withdrawWindowHours * 3_600_000;
    chain.tick(T0 + 7 * DAY + windowMs);
    expect(chain.withdrawLock(T0 + 7 * DAY + windowMs)).toEqual({ ok: false, reason: 'tooEarly' });

    // advanceClock brings the lock's end to now; it renews and is withdrawn within the window after that end.
    const now = T0 + 7 * DAY + windowMs;
    chain.dev.advanceClock(7 * DAY - windowMs);
    expect(chain.lock()!.unlocksAt).toBe(now);
    chain.tick(now);
    expect(chain.lock()).toMatchObject({ lockedAt: now, unlocksAt: now + 7 * DAY });
    expect(chain.withdrawLock(now + 1)).toEqual({ ok: true });
    expect(chain.lock()).toBeNull();
    expect(chain.balance()).toBe(START);
  });

  test('claim moves accrued to the balance at once on the mock', async () => {
    const { chain, clock } = setup();
    expect(await chain.claim(clock.t)).toEqual({ ok: false, reason: 'nothing' });
    chain.accrue({ orderId: 'o1', usdMicro: 120_000, luck: 0.5, quality: 0.5, usdPerGame: cfg.mockChain.usdPerGame, boost: 1, at: clock.t });
    let notified = 0;
    const off = chain.subscribe(() => notified++);
    expect(await chain.claim(clock.t)).toEqual({ ok: true, game: 500 * GAME_UNITS });
    off();
    expect(notified).toBe(1);
    expect(chain.accrued()).toBe(0);
    expect(chain.balance()).toBe(START + 500 * GAME_UNITS);
  });

  test('blocked or corrupt storage gives a fresh wallet with startGame and the starting vault, and never throws', async () => {
    const throwing: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    const corrupt = memoryStorage();
    corrupt.data.set(MOCK_CHAIN_KEY, '{"balance":"lots"');
    const wrongShape = memoryStorage();
    wrongShape.data.set(MOCK_CHAIN_KEY, JSON.stringify({ v: 1, balance: -5 }));
    const clock = { now: () => T0 };
    for (const storage of [null, throwing, corrupt, wrongShape]) {
      const chain = new MockChain(storage, cfg, clock);
      expect(chain.wallet).toBe('DEV-WALLET');
      expect(chain.mock).toBe(true);
      expect(chain.balance()).toBe(START);
      expect(chain.accrued()).toBe(0);
      expect(chain.vault()).toBe(usdToGame(usd(50), { usdPerGame: cfg.mockChain.usdPerGame, updatedAt: T0 }));
      expect(chain.ownership()).toEqual({ lines: { vehicle: 0, bag: 0, shoes: 0, dispatcher: 0 }, skins: [] });
      expect(chain.lock()).toBeNull();
      const tx = await chain.purchase('line.bag.1', Number.MAX_SAFE_INTEGER, T0);
      expect(tx.status).toBe('pending');
      expect(() => chain.tick(T0 + CONFIRM_MS)).not.toThrow();
      expect(chain.ownership().lines.bag).toBe(1);
    }
    // A wallet that saved is read back.
    const ok = memoryStorage();
    new MockChain(ok, cfg, clock).dev.addGame(GAME_UNITS);
    expect(new MockChain(ok, cfg, clock).balance()).toBe(START + GAME_UNITS);
  });
});
