import {
  GAME_UNITS,
  LINES,
  quote,
  rateUpdateAllowed,
  shopItem,
  splitPurchase,
  usdToGame,
  type ChainSource,
  type ChainTx,
  type EconomyConfig,
  type Line,
  type Lock,
  type Ownership,
  type Payout,
  type PurchaseError,
  type Rate,
  type ShopItem,
  type ShopItemId,
} from '@dm/shared';

/** localStorage key of the mock chain's state. */
export const MOCK_CHAIN_KEY = 'dm.mockchain.v1';
/** Purchases and payouts kept in the history (pending purchases are never dropped). */
const HISTORY_LIMIT = 200;
const HOUR_MS = 3_600_000;

/** A purchase as stored: the tx plus what settlement needs. */
interface StoredTx extends ChainTx {
  maxGame: number;
  settleAt: number;
}

interface State {
  v: 1;
  balance: number;
  accrued: number;
  vault: number;
  rate: Rate;
  /** true: the mock keeper keeps the rate fresh (its age is always 0); false after makeRateStale until setRate. */
  rateLive: boolean;
  ownership: Ownership;
  lock: Lock | null;
  /** The lock has renewed at least once, so it may be withdrawn for the window after the period that ended. */
  lockRenewed: boolean;
  txs: StoredTx[];
  payouts: Payout[];
  nextId: number;
}

type ChainStorage = Pick<Storage, 'getItem' | 'setItem'>;

const isNat = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const TX_STATUSES = new Set(['pending', 'confirmed', 'failed']);

function validTx(t: unknown): boolean {
  return isObj(t) && typeof t.id === 'string' && typeof t.itemId === 'string' && TX_STATUSES.has(t.status as string)
    && isNat(t.game) && isNat(t.burned) && isNat(t.vault) && isNum(t.createdAt) && isNat(t.maxGame) && isNum(t.settleAt);
}

function validPayout(p: unknown): boolean {
  return isObj(p) && typeof p.id === 'string' && typeof p.orderId === 'string' && isNat(p.usdMicro) && isNat(p.game)
    && isNum(p.luck) && isNum(p.quality) && isNum(p.usdPerGame) && isNum(p.boost) && isNum(p.at) && typeof p.paid === 'boolean';
}

/** The saved state when it is whole and well-formed, else null (a fresh wallet). */
function parseState(raw: string | null, cfg: EconomyConfig): State | null {
  if (raw === null) return null;
  const s: unknown = JSON.parse(raw);
  if (!isObj(s) || s.v !== 1 || !isNat(s.balance) || !isNat(s.accrued) || !isNat(s.vault) || !isNat(s.nextId)) return null;
  const { rate, ownership, lock } = s;
  if (!isObj(rate) || !isNum(rate.usdPerGame) || !(rate.usdPerGame > 0) || !isNum(rate.updatedAt) || typeof s.rateLive !== 'boolean') return null;
  if (!isObj(ownership) || !isObj(ownership.lines) || !Array.isArray(ownership.skins) || !ownership.skins.every((x) => typeof x === 'string')) return null;
  const lines = ownership.lines;
  if (!LINES.every((l) => isNat(lines[l]) && lines[l] <= cfg.lines[l].usdMicro.length)) return null;
  if (lock !== null && !(isObj(lock) && isNat(lock.game) && isNat(lock.usdMicroAtLock) && isNum(lock.lockedAt) && isNum(lock.unlocksAt))) return null;
  if (typeof s.lockRenewed !== 'boolean' || !Array.isArray(s.txs) || !s.txs.every(validTx) || !Array.isArray(s.payouts) || !s.payouts.every(validPayout)) return null;
  return s as unknown as State;
}

function publicTx(t: StoredTx): ChainTx {
  const tx: ChainTx = { id: t.id, itemId: t.itemId, game: t.game, burned: t.burned, vault: t.vault, status: t.status, createdAt: t.createdAt };
  if (t.error !== undefined) tx.error = t.error;
  if (t.settledAt !== undefined) tx.settledAt = t.settledAt;
  return tx;
}

/** Drops the oldest settled entries beyond the limit. */
function trim<T>(list: T[], pending: (x: T) => boolean = () => false): void {
  while (list.length > HISTORY_LIMIT) {
    const i = list.findIndex((x) => !pending(x));
    if (i < 0) return;
    list.splice(i, 1);
  }
}

/**
 * The browser mock of the reward chain (Decision 1): a dev wallet kept in localStorage, purchases that confirm after
 * `mockChain.confirmSeconds`, the 80/20 split into a reward vault, payouts the vault must cover, and 7-day locks.
 * Storage is optional and never throws: blocked, full or corrupt storage gives a fresh wallet held in memory.
 */
export class MockChain implements ChainSource {
  readonly wallet: string;
  readonly mock = true;
  private s: State;
  private failNextTx = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: ChainStorage | null,
    private readonly cfg: EconomyConfig,
    private readonly clock: { now(): number },
  ) {
    this.wallet = cfg.mockChain.wallet;
    let loaded: State | null;
    try {
      loaded = storage ? parseState(storage.getItem(MOCK_CHAIN_KEY), cfg) : null;
    } catch {
      loaded = null;
    }
    this.s = loaded ?? this.fresh();
  }

  private fresh(): State {
    const rate = { usdPerGame: this.cfg.mockChain.usdPerGame, updatedAt: this.clock.now() };
    return {
      v: 1,
      balance: this.cfg.mockChain.startGame * GAME_UNITS,
      accrued: 0,
      vault: usdToGame(this.cfg.mockChain.vaultUsdMicro, rate),
      rate,
      rateLive: true,
      ownership: { lines: { vehicle: 0, bag: 0, shoes: 0, dispatcher: 0 }, skins: [] },
      lock: null,
      lockRenewed: false,
      txs: [],
      payouts: [],
      nextId: 1,
    };
  }

  /** Saves the state and tells the listeners. */
  private changed(): void {
    if (this.storage) {
      try {
        this.storage.setItem(MOCK_CHAIN_KEY, JSON.stringify(this.s));
      } catch {
        // Storage full or blocked: the wallet lives in memory for this session.
      }
    }
    for (const l of [...this.listeners]) l();
  }

  private id(prefix: string): string {
    return `${prefix}-${this.s.nextId++}`;
  }

  /** The rate as of `nowMs`: the mock keeper posts continuously unless the dev panel made it stale. */
  private rateAt(nowMs: number): Rate {
    return this.s.rateLive ? { usdPerGame: this.s.rate.usdPerGame, updatedAt: nowMs } : { ...this.s.rate };
  }

  balance(): number { return this.s.balance; }
  accrued(): number { return this.s.accrued; }
  vault(): number { return this.s.vault; }
  rate(): Rate | null { return this.rateAt(this.clock.now()); }
  ownership(): Ownership { return { lines: { ...this.s.ownership.lines }, skins: [...this.s.ownership.skins] }; }
  lock(): Lock | null { return this.s.lock ? { ...this.s.lock } : null; }
  history(): readonly ChainTx[] { return this.s.txs.map(publicTx); }
  payouts(): readonly Payout[] { return this.s.payouts.map((p) => ({ ...p })); }

  /** `owned` or `order` when the wallet's ownership refuses the item, else null. */
  private ownershipError(item: ShopItem): PurchaseError | null {
    if (item.kind === 'line') {
      const owned = this.s.ownership.lines[item.line];
      if (item.tier <= owned) return 'owned';
      if (item.tier > owned + 1) return 'order';
    }
    if (item.kind === 'skin' && this.s.ownership.skins.includes(item.id)) return 'owned';
    return null;
  }

  /** The reason a purchase of `item` for at most `maxGame` fails at `nowMs`, or its price in GAME. */
  private check(item: ShopItem, maxGame: number, nowMs: number): { error: PurchaseError } | { game: number } {
    if (item.currency !== 'game') return { error: 'rejected' };
    const own = this.ownershipError(item);
    if (own) return { error: own };
    const q = quote(item.usdMicro, this.rateAt(nowMs), nowMs, this.cfg);
    if (!q.ok) return { error: 'stale' };
    if (q.game > maxGame) return { error: 'slippage' };
    if (q.game > this.s.balance) return { error: 'insufficient' };
    return { game: q.game };
  }

  async purchase(itemId: ShopItemId, maxGame: number, nowMs: number): Promise<ChainTx> {
    const tx: StoredTx = {
      id: this.id('tx'), itemId, game: 0, burned: 0, vault: 0, status: 'pending', createdAt: nowMs, maxGame: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(maxGame))) || 0,
      settleAt: nowMs + this.cfg.mockChain.confirmSeconds * 1000,
    };
    let error: PurchaseError | null = null;
    if (this.failNextTx) {
      this.failNextTx = false;
      error = 'rejected';
    } else {
      try {
        const r = this.check(shopItem(itemId), tx.maxGame, nowMs);
        if ('error' in r) error = r.error;
      } catch {
        error = 'rejected'; // not a shop item
      }
    }
    if (error) Object.assign(tx, { status: 'failed', error, settledAt: nowMs });
    this.s.txs.push(tx);
    trim(this.s.txs, (t) => t.status === 'pending');
    this.changed();
    return publicTx(tx);
  }

  /** Settles a due tx: re-quoted at the current rate, then charged, split and granted in one step, or failed charging nothing. */
  private settle(tx: StoredTx, nowMs: number): void {
    tx.settledAt = nowMs;
    let item: ShopItem;
    try {
      item = shopItem(tx.itemId);
    } catch {
      Object.assign(tx, { status: 'failed', error: 'rejected' });
      return;
    }
    const r = this.check(item, tx.maxGame, nowMs);
    if ('error' in r) {
      Object.assign(tx, { status: 'failed', error: r.error });
      return;
    }
    const { burned, vault } = splitPurchase(item, r.game, this.cfg);
    this.s.balance -= r.game;
    this.s.vault += vault;
    if (item.kind === 'line') this.s.ownership.lines[item.line] = item.tier;
    if (item.kind === 'skin') this.s.ownership.skins.push(item.id);
    Object.assign(tx, { status: 'confirmed', game: r.game, burned, vault });
  }

  /** Settles every due pending tx in creation order and renews locks that reached their end. */
  tick(nowMs: number): void {
    let dirty = false;
    for (const tx of this.s.txs) {
      if (tx.status === 'pending' && tx.settleAt <= nowMs) {
        this.settle(tx, nowMs);
        dirty = true;
      }
    }
    const lock = this.s.lock;
    const period = this.cfg.lock.days * 24 * HOUR_MS;
    while (lock && nowMs >= lock.unlocksAt) {
      lock.lockedAt = lock.unlocksAt;
      lock.unlocksAt += period;
      this.s.lockRenewed = true;
      dirty = true;
    }
    if (dirty) this.changed();
  }

  accrue(p: Omit<Payout, 'id' | 'paid' | 'game'>): Payout {
    // usdMicro already includes the boost (rollPayoutUsd applied it); `boost` is only recorded.
    const due = usdToGame(p.usdMicro, { usdPerGame: p.usdPerGame, updatedAt: p.at });
    const paid = due <= this.s.vault;
    const payout: Payout = { ...p, id: this.id('pay'), game: paid ? due : 0, paid };
    if (paid) {
      this.s.vault -= due;
      this.s.accrued += due;
    }
    this.s.payouts.push(payout);
    trim(this.s.payouts);
    this.changed();
    return { ...payout };
  }

  lockGame(game: number, nowMs: number): { ok: true } | { ok: false; reason: 'insufficient' | 'locked' } {
    if (this.s.lock) return { ok: false, reason: 'locked' };
    if (!Number.isSafeInteger(game) || game <= 0 || game > this.s.balance) return { ok: false, reason: 'insufficient' };
    this.s.balance -= game;
    this.s.lock = {
      game,
      usdMicroAtLock: Math.round(game * this.s.rate.usdPerGame), // base units × USD per GAME = micro-USD
      lockedAt: nowMs,
      unlocksAt: nowMs + this.cfg.lock.days * 24 * HOUR_MS,
    };
    this.s.lockRenewed = false;
    this.changed();
    return { ok: true };
  }

  /** Allowed from `unlocksAt` and, once the lock has renewed, for `withdrawWindowHours` after the period that ended. */
  withdrawLock(nowMs: number): { ok: true } | { ok: false; reason: 'tooEarly' | 'none' } {
    const lock = this.s.lock;
    if (!lock) return { ok: false, reason: 'none' };
    const inWindow = this.s.lockRenewed && nowMs < lock.lockedAt + this.cfg.lock.withdrawWindowHours * HOUR_MS;
    if (nowMs < lock.unlocksAt && !inWindow) return { ok: false, reason: 'tooEarly' };
    this.s.balance += lock.game;
    this.s.lock = null;
    this.s.lockRenewed = false;
    this.changed();
    return { ok: true };
  }

  /** The mock claim is instant (Decision 3). */
  async claim(nowMs: number): Promise<{ ok: true; game: number } | { ok: false; reason: 'nothing' }> {
    void nowMs; // a real claim is a transaction sent at nowMs; the mock's settles at once
    const game = this.s.accrued;
    if (game <= 0) return { ok: false, reason: 'nothing' };
    this.s.accrued = 0;
    this.s.balance += game;
    this.changed();
    return { ok: true, game };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Dev panel controls (Decision 1). GAME amounts are base units; USD amounts are dollars. */
  readonly dev = {
    addGame: (n: number): void => {
      this.s.balance = Math.max(0, this.s.balance + Math.round(n));
      this.changed();
    },
    /** A keeper update to `usdPerGame`; refused (false) beyond the 20% move limit. Makes a stale rate live again. */
    setRate: (usdPerGame: number): boolean => {
      if (!rateUpdateAllowed(this.s.rate.usdPerGame, usdPerGame, this.cfg)) return false;
      this.s.rate = { usdPerGame, updatedAt: this.clock.now() };
      this.s.rateLive = true;
      this.changed();
      return true;
    },
    makeRateStale: (): void => {
      this.s.rate = { usdPerGame: this.s.rate.usdPerGame, updatedAt: this.clock.now() - this.cfg.rate.maxAgeSeconds * 1000 };
      this.s.rateLive = false;
      this.changed();
    },
    failNext: (): void => {
      this.failNextTx = true;
    },
    /** Sets the vault to `usd` dollars of GAME at the current rate (0 empties it). */
    setVaultUsd: (usd: number): void => {
      this.s.vault = usdToGame(Math.max(0, Math.round(usd * 1e6)), this.s.rate);
      this.changed();
    },
    /** Sets a line's tier directly (up or down), as if bought or revoked on the chain. */
    grantTier: (line: Line, tier: number): void => {
      this.s.ownership.lines[line] = Math.min(this.cfg.lines[line].usdMicro.length, Math.max(0, Math.round(tier)));
      this.changed();
    },
    /** Moves the lock `ms` closer to its end; the next tick renews it if that end has passed. */
    advanceClock: (ms: number): void => {
      if (!this.s.lock) return;
      this.s.lock.lockedAt -= ms;
      this.s.lock.unlocksAt -= ms;
      this.changed();
    },
  };
}
