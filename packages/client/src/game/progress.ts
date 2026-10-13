/** Lifetime points, coins and deliveries (Task 8 moves this to the v2 progress record). */
export interface Totals {
  points: number;
  coins: number;
  deliveries: number;
}

/** localStorage key for the player's points, coins and delivery count (spec assumption 10). */
export const PROGRESS_KEY = 'dm.progress.v1';

export interface ProgressStore {
  load(): Totals;
  save(t: Totals): void;
}

const zero = (): Totals => ({ points: 0, coins: 0, deliveries: 0 });

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function parseTotals(raw: string | null): Totals {
  if (raw === null) return zero();
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return zero();
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return zero();
  const o = v as Record<string, unknown>;
  if (!isCount(o.points) || !isCount(o.coins) || !isCount(o.deliveries)) return zero();
  return { points: o.points, coins: o.coins, deliveries: o.deliveries };
}

/**
 * Local progress (SP1). Never throws: blocked storage (private windows, disabled site data), quota errors
 * and malformed data all give zero progress (Review Focus 5).
 */
export function createProgressStore(storage: Pick<Storage, 'getItem' | 'setItem'> | null): ProgressStore {
  return {
    load() {
      if (!storage) return zero();
      try {
        return parseTotals(storage.getItem(PROGRESS_KEY));
      } catch {
        return zero();
      }
    },
    save(t) {
      if (!storage) return;
      try {
        storage.setItem(PROGRESS_KEY, JSON.stringify({ points: t.points, coins: t.coins, deliveries: t.deliveries }));
      } catch {
        // Storage full or blocked: progress for this session stays in memory only.
      }
    },
  };
}

/** window.localStorage, or null when the browser blocks it (accessing the property can throw). */
export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
