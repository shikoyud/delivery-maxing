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
  /** Stores only the values that differ from the defaults (removes the key when none do). */
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

/** The numbers in `cur` that differ from `def` (same shape, only differing leaves), or null when none differ. */
function diffNumbers(cur: Tree, def: Tree, skip: readonly string[] = []): Tree | null {
  const out: Tree = {};
  for (const key of Object.keys(def)) {
    if (skip.includes(key)) continue;
    const c = cur[key];
    const d = def[key];
    if (typeof d === 'number') {
      if (typeof c === 'number' && c !== d) out[key] = c;
    } else if (d !== undefined && typeof c === 'object') {
      const sub = diffNumbers(c, d);
      if (sub) out[key] = sub;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

const countLeaves = (t: Tree | null): number =>
  t === null ? 0 : Object.values(t).reduce<number>((n, v) => n + (typeof v === 'number' ? 1 : countLeaves(v)), 0);

/** Only the settings that differ from the defaults (R27): what save() stores. */
export function devOverrides(s: DevSettings): { backpackSlots?: number; movement?: Tree } {
  const def = defaultDevSettings();
  const out: { backpackSlots?: number; movement?: Tree } = {};
  if (s.backpackSlots !== def.backpackSlots) out.backpackSlots = s.backpackSlots;
  const movement = diffNumbers(s.movement as unknown as Tree, def.movement as unknown as Tree, FIXED_MOVEMENT_KEYS);
  if (movement) out.movement = movement;
  return out;
}

/** Number of values (movement leaves plus backpack slots) that differ from the defaults. */
export function countOverrides(s: DevSettings): number {
  const o = devOverrides(s);
  return (o.backpackSlots === undefined ? 0 : 1) + countLeaves(o.movement ?? null);
}

/** Dev panel status line for `n` active overrides. */
export function overridesLabel(n: number): string {
  if (n === 0) return 'No overrides active';
  return n === 1 ? '1 override active' : `${n} overrides active`;
}

/** Debounces `save` by `ms`; cancel() drops a pending save (Reset tuning must not be undone by it). */
export function createDebouncedSave(save: () => void, ms: number): { schedule(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    schedule() {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        save();
      }, ms);
    },
    cancel,
  };
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
        // Only values that differ from the defaults are kept, so later config/movement.json changes still apply.
        const overrides = devOverrides(s);
        if (Object.keys(overrides).length === 0) storage.removeItem(DEV_KEY);
        else storage.setItem(DEV_KEY, JSON.stringify(overrides));
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
