import { movementConfig, ordersConfig, type MovementConfig } from '@dm/shared';

/** localStorage key for the dev tuning panel's overrides. */
export const DEV_KEY = 'dm.dev.v1';

export interface DevSettings {
  backpackSlots: number;
  movement: MovementConfig;
}

export interface DevSettingsStore {
  /** Defaults deep-merged with saved overrides, as a fresh deep clone (never the shared config import). */
  load(): DevSettings;
  save(s: DevSettings): void;
  /** Removes the saved overrides and returns fresh defaults. */
  reset(): DevSettings;
}

/** Movement keys that need a physics body rebuild; the panel cannot edit them live, so saved values are ignored. */
export const FIXED_MOVEMENT_KEYS: readonly string[] = ['capsule', 'controller', 'tickRate', 'maxStepsPerFrame'];

type Tree = { [k: string]: number | Tree };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Copies finite numbers from `saved` onto `target` where `target` already has a number; everything else is dropped. */
function mergeNumbers(target: Tree, saved: Record<string, unknown>, skip: readonly string[] = []): void {
  for (const key of Object.keys(target)) {
    if (skip.includes(key) || !Object.hasOwn(saved, key)) continue;
    const cur = target[key];
    const val = saved[key];
    if (typeof cur === 'number') {
      if (typeof val === 'number' && Number.isFinite(val)) target[key] = val;
    } else if (cur !== undefined && isObj(val)) {
      mergeNumbers(cur, val);
    }
  }
}

/** Overwrites every number in `target` with the matching one from `source`, in place (same object identity). */
export function assignNumbers(target: Tree, source: Tree): void {
  for (const key of Object.keys(source)) {
    const s = source[key];
    const t = target[key];
    if (typeof s === 'number') target[key] = s;
    else if (s !== undefined && typeof t === 'object') assignNumbers(t, s);
  }
}

export function defaultDevSettings(): DevSettings {
  return { backpackSlots: ordersConfig.backpack.baseSlots, movement: structuredClone(movementConfig) };
}

function parse(raw: string | null): DevSettings {
  const out = defaultDevSettings();
  if (raw === null) return out;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!isObj(v)) return out;
  const slots = v.backpackSlots;
  if (typeof slots === 'number' && Number.isFinite(slots)) {
    out.backpackSlots = Math.min(ordersConfig.backpack.maxSlots, Math.max(1, Math.round(slots)));
  }
  if (isObj(v.movement)) mergeNumbers(out.movement as unknown as Tree, v.movement, FIXED_MOVEMENT_KEYS);
  return out;
}

/** Dev tuning overrides (SP1 playtest). Never throws: blocked storage and malformed data give the defaults. */
export function createDevSettingsStore(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
): DevSettingsStore {
  return {
    load() {
      if (!storage) return defaultDevSettings();
      try {
        return parse(storage.getItem(DEV_KEY));
      } catch {
        return defaultDevSettings();
      }
    },
    save(s) {
      if (!storage) return;
      try {
        storage.setItem(DEV_KEY, JSON.stringify({ backpackSlots: s.backpackSlots, movement: s.movement }));
      } catch {
        // Storage full or blocked: tuning stays for this session only.
      }
    },
    reset() {
      try {
        storage?.removeItem(DEV_KEY);
      } catch {
        // Nothing to remove if storage is blocked.
      }
      return defaultDevSettings();
    },
  };
}
