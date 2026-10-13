import type { Totals, VehicleTier } from '@dm/shared';

/** What persists between visits: lifetime totals and the capacity tier the player has bought. */
export interface Progress {
  totals: Totals;
  capacityTier: VehicleTier;
}

/** localStorage key. Bumped to v2 so SP1 records (no capacity tier) are never loaded. */
export const PROGRESS_KEY = 'dm.progress.v2';

export interface ProgressStore {
  load(): Progress;
  save(p: Progress): void;
}

const TIERS: readonly VehicleTier[] = ['walk', 'skateboard', 'bicycle', 'motorbike', 'car'];

const defaults = (): Progress => ({ totals: { points: 0, coins: 0, deliveries: 0 }, capacityTier: 'walk' });

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Field by field: a bad value falls back to its default, the rest of the record survives. */
function parseProgress(raw: string | null): Progress {
  const out = defaults();
  if (raw === null) return out;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!isRecord(v)) return out;
  if (isRecord(v.totals)) {
    out.totals = { points: count(v.totals.points), coins: count(v.totals.coins), deliveries: count(v.totals.deliveries) };
  }
  const tier = TIERS.find((t) => t === v.capacityTier);
  if (tier) out.capacityTier = tier;
  return out;
}

/**
 * Local progress (v2). Never throws: blocked storage (private windows, disabled site data), quota errors
 * and malformed data all give default progress (Review Focus 5).
 */
export function createProgressStore(storage: Pick<Storage, 'getItem' | 'setItem'> | null): ProgressStore {
  return {
    load() {
      if (!storage) return defaults();
      try {
        return parseProgress(storage.getItem(PROGRESS_KEY));
      } catch {
        return defaults();
      }
    },
    save(p) {
      if (!storage) return;
      try {
        storage.setItem(PROGRESS_KEY, JSON.stringify({
          totals: { points: p.totals.points, coins: p.totals.coins, deliveries: p.totals.deliveries },
          capacityTier: p.capacityTier,
        }));
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
