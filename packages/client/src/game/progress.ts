import { RIDE_TIERS, type RideTier, type SavedVehicle, type Totals, type VehicleSpot } from '@dm/shared';

/**
 * What persists between visits: lifetime totals, the owned vehicles (where each is parked, its fuel) and the tier
 * last ridden (capacity and offers follow it).
 */
export interface Progress {
  totals: Totals;
  garage: SavedVehicle[];
  lastRide: RideTier | null;
}

/** Which map a save belongs to: a greybox save never places a vehicle in the city. */
export type ProgressKind = 'greybox' | 'city';

/** localStorage key of a map's save. */
export const progressKey = (kind: ProgressKind): string => `dm.progress.${kind}`;
/** SP4's single-map key (written on the greybox): read as the greybox save when that has none yet. */
export const PROGRESS_KEY_V3 = 'dm.progress.v3';
/** The key before it: only its totals carry over (to the greybox). */
export const PROGRESS_KEY_V2 = 'dm.progress.v2';

export interface ProgressStore {
  load(): Progress;
  save(p: Progress): void;
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const rideTier = (v: unknown): RideTier | null => RIDE_TIERS.find((t) => t === v) ?? null;

function parseTotals(v: unknown): Totals {
  const t = isRecord(v) ? v : {};
  return { points: count(t.points), coins: count(t.coins), deliveries: count(t.deliveries) };
}

/** A parked spot; 'riding' with a position (a vehicle saved mid-ride) loads parked where it was. */
function parseSpot(v: unknown): VehicleSpot | null {
  if (!isRecord(v)) return null;
  if (v.kind === 'carried') return { kind: 'carried' };
  if (v.kind !== 'parked' && v.kind !== 'riding') return null;
  const p = v.position;
  if (!isRecord(p) || !finite(p.x) || !finite(p.y) || !finite(p.z) || !finite(v.heading)) return null;
  return { kind: 'parked', position: { x: p.x, y: p.y, z: p.z }, heading: v.heading };
}

/**
 * The saved vehicles. An entry for a known tier with a bad spot or fuel takes that tier's default; an unknown tier
 * or a duplicate is dropped; a tier left out is not owned. Not a list at all: the default garage.
 */
function parseGarage(v: unknown, defaults: SavedVehicle[]): SavedVehicle[] {
  if (!Array.isArray(v)) return defaults;
  const out: SavedVehicle[] = [];
  for (const raw of v) {
    if (!isRecord(raw)) continue;
    const tier = rideTier(raw.tier);
    if (!tier || out.some((o) => o.tier === tier)) continue;
    const spot = parseSpot(raw.spot);
    const fuel = finite(raw.fuel) ? Math.min(1, Math.max(0, raw.fuel)) : null;
    if (spot && fuel !== null) out.push({ tier, spot, fuel });
    else {
      const d = defaults.find((x) => x.tier === tier);
      if (d) out.push(d);
    }
  }
  return RIDE_TIERS.flatMap((t) => out.filter((o) => o.tier === t));
}

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

/** Field by field: a bad value falls back to its default, the rest of the record survives. */
function parseProgress(storage: Pick<Storage, 'getItem'>, defaults: () => SavedVehicle[], kind: ProgressKind): Progress {
  // The map's own record, else (greybox only) SP4's single-map record: it alone counts, a corrupt one gives defaults
  // and never brings back older totals.
  const raw = storage.getItem(progressKey(kind)) ?? (kind === 'greybox' ? storage.getItem(PROGRESS_KEY_V3) : null);
  if (raw !== null) {
    const v3 = parseJson(raw);
    return { totals: parseTotals(v3?.totals), garage: parseGarage(v3?.garage, defaults()), lastRide: rideTier(v3?.lastRide) };
  }
  // No record at all: on the greybox a v2 record keeps its totals; the city starts fresh.
  if (kind !== 'greybox') return { totals: parseTotals(null), garage: defaults(), lastRide: null };
  const v2 = parseJson(storage.getItem(PROGRESS_KEY_V2));
  return { totals: parseTotals(v2?.totals), garage: defaults(), lastRide: null };
}

/**
 * Local progress, one save per map kind. Never throws: blocked storage (private windows, disabled site data), quota errors and
 * malformed data all give default progress (Review Focus 5). `defaults` is the garage a new player starts with
 * (Game: defaultGarage(map)); it is called afresh for each load.
 */
export function createProgressStore(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  kind: ProgressKind,
  defaults: () => SavedVehicle[] = () => [],
): ProgressStore {
  const fresh = (): Progress => ({ totals: { points: 0, coins: 0, deliveries: 0 }, garage: defaults(), lastRide: null });
  return {
    load() {
      if (!storage) return fresh();
      try {
        return parseProgress(storage, defaults, kind);
      } catch {
        return fresh();
      }
    },
    save(p) {
      if (!storage) return;
      try {
        storage.setItem(progressKey(kind), JSON.stringify({
          totals: { points: p.totals.points, coins: p.totals.coins, deliveries: p.totals.deliveries },
          garage: p.garage,
          lastRide: p.lastRide,
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

/**
 * Calls `save` when the page goes away (pagehide) or is hidden (visibilitychange to hidden), so closing the tab
 * mid-ride keeps where the vehicle is and the fuel it burnt. Returns a disposer.
 */
export function saveWhenLeaving(
  win: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  doc: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { readonly visibilityState: DocumentVisibilityState },
  save: () => void,
): () => void {
  const onHide = (): void => save();
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') save();
  };
  win.addEventListener('pagehide', onHide);
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    win.removeEventListener('pagehide', onHide);
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
