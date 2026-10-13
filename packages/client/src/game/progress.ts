import { addEpochPoints, epochIdAt, ordersConfig, type EpochPoints, type Totals } from '@dm/shared';

/** localStorage key for the player's lifetime totals and current-epoch points (SP2 Task 17). */
export const PROGRESS_KEY = 'dm.progress.v2';
/** SP1's key (totals only, spec assumption 10): read once to migrate when no v2 entry exists. */
export const PROGRESS_KEY_V1 = 'dm.progress.v1';

/** Lifetime Points, Coins and deliveries, and the points earned in the current reward epoch (plan assumption 12). */
export interface Progress { totals: Totals; epoch: EpochPoints }

export interface ProgressStore {
  /** The stored progress as of `utcMs` (wall clock): epoch points from an earlier window load as 0 in the current one. */
  load(utcMs: number): Progress;
  save(p: Progress): void;
}

const zeroTotals = (): Totals => ({ points: 0, coins: 0, deliveries: 0 });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asTotals(v: unknown): Totals | null {
  if (!isObj(v) || !isCount(v.points) || !isCount(v.coins) || !isCount(v.deliveries)) return null;
  return { points: v.points, coins: v.coins, deliveries: v.deliveries };
}

function asEpoch(v: unknown): EpochPoints | null {
  if (!isObj(v) || !Number.isSafeInteger(v.id) || !isCount(v.points)) return null;
  return { id: v.id as number, points: v.points };
}

/**
 * The stored progress, or null when nothing valid is stored. A v2 entry wins; without one a v1 entry migrates (its
 * totals kept, no epoch points). Malformed totals give null (zero progress), never a throw; valid totals with a
 * malformed epoch keep the totals and start a fresh epoch (the next save would otherwise overwrite them with zeros).
 */
function parseStored(v2: string | null, v1: string | null): { totals: Totals; epoch: EpochPoints | null } | null {
  if (v2 !== null) {
    const o = parseJson(v2);
    if (!isObj(o)) return null;
    const totals = asTotals(o.totals);
    return totals ? { totals, epoch: asEpoch(o.epoch) } : null;
  }
  if (v1 !== null) {
    const totals = asTotals(parseJson(v1));
    return totals ? { totals, epoch: null } : null;
  }
  return null;
}

/**
 * Local progress. Never throws: blocked storage (private windows, disabled site data), quota errors and malformed totals
 * all give zero progress (SP1 Review Focus 5).
 */
export function createProgressStore(storage: Pick<Storage, 'getItem' | 'setItem'> | null): ProgressStore {
  const seconds = ordersConfig.epoch.seconds;
  return {
    load(utcMs) {
      let stored: ReturnType<typeof parseStored> = null;
      if (storage) {
        try {
          stored = parseStored(storage.getItem(PROGRESS_KEY), storage.getItem(PROGRESS_KEY_V1));
        } catch {
          stored = null;
        }
      }
      const fresh: EpochPoints = { id: epochIdAt(utcMs, seconds), points: 0 };
      return {
        totals: stored?.totals ?? zeroTotals(),
        // Rolls a stored epoch from another window over to the current one with 0 points.
        epoch: stored?.epoch ? addEpochPoints(stored.epoch, utcMs, seconds, 0) : fresh,
      };
    },
    save(p) {
      if (!storage) return;
      const { totals: t, epoch: e } = p;
      const data: Progress = { totals: { points: t.points, coins: t.coins, deliveries: t.deliveries }, epoch: { id: e.id, points: e.points } };
      try {
        storage.setItem(PROGRESS_KEY, JSON.stringify(data));
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
