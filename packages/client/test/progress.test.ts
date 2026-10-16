import { describe, expect, it } from 'vitest';
import { RIDE_TIERS, defaultGarage, expandGreybox, type GreyboxSource, type SavedVehicle } from '@dm/shared';
import greyboxJson from '../../../map/greybox.json';
import { PROGRESS_KEY_V2, PROGRESS_KEY_V3, createProgressStore, progressKey, saveWhenLeaving } from '../src/game/progress';

const map = expandGreybox(greyboxJson as GreyboxSource);
const garage = (): SavedVehicle[] => defaultGarage(map);
const TOTALS = { points: 7, coins: 70, deliveries: 4 };
const ZERO = { points: 0, coins: 0, deliveries: 0 };

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('createProgressStore (v3)', () => {
  it('keys a save by map kind', () => {
    expect(progressKey('greybox')).toBe('dm.progress.greybox');
    expect(progressKey('city')).toBe('dm.progress.city');
  });

  it('a save written under city is not read under greybox, and the reverse', () => {
    const storage = memoryStorage();
    const g = garage();
    g[3] = { tier: 'car', spot: { kind: 'parked', position: { x: 900, y: 3, z: -40 }, heading: 0.5 }, fuel: 0.1 };
    createProgressStore(storage, 'city', garage).save({ totals: TOTALS, garage: g, lastRide: 'car' });
    expect(storage.data.has('dm.progress.city')).toBe(true);
    expect(storage.data.has('dm.progress.greybox')).toBe(false);
    expect(createProgressStore(storage, 'greybox', garage).load()).toEqual({ totals: ZERO, garage: garage(), lastRide: null });
    expect(createProgressStore(storage, 'city', garage).load()).toEqual({ totals: TOTALS, garage: g, lastRide: 'car' });
  });

  it('with no save for the kind, load gives that map\'s own default garage', () => {
    const cityGarage = garage().map((v) => ({ ...v, fuel: 0.5 }));
    const storage = memoryStorage();
    createProgressStore(storage, 'greybox', garage).save({ totals: TOTALS, garage: garage(), lastRide: 'car' });
    expect(createProgressStore(storage, 'city', () => cityGarage).load()).toEqual({ totals: ZERO, garage: cityGarage, lastRide: null });
  });

  it('a legacy v3 save (SP4, written on the greybox) loads as the greybox save once; the city starts fresh', () => {
    const storage = memoryStorage();
    const g = garage().slice(0, 2);
    storage.data.set(PROGRESS_KEY_V3, JSON.stringify({ totals: TOTALS, garage: g, lastRide: 'bicycle' }));
    expect(createProgressStore(storage, 'city', garage).load()).toEqual({ totals: ZERO, garage: garage(), lastRide: null });
    const grey = createProgressStore(storage, 'greybox', garage);
    expect(grey.load()).toEqual({ totals: TOTALS, garage: g, lastRide: 'bicycle' });
    // Once saved, the per-map key wins over the legacy record.
    grey.save({ totals: ZERO, garage: [], lastRide: null });
    expect(grey.load()).toEqual({ totals: ZERO, garage: [], lastRide: null });
  });

  it('progress v3 round-trips garage, lastRide and totals', () => {
    const storage = memoryStorage();
    const g = garage();
    g[2] = { tier: 'motorbike', spot: { kind: 'parked', position: { x: 12, y: 0.5, z: -3 }, heading: 1.25 }, fuel: 0.4 };
    createProgressStore(storage, 'greybox', garage).save({ totals: TOTALS, garage: g, lastRide: 'motorbike' });
    expect(createProgressStore(storage, 'greybox', garage).load()).toEqual({ totals: TOTALS, garage: g, lastRide: 'motorbike' });
  });

  it('a garage without a tier loads without it (not owned)', () => {
    const storage = memoryStorage();
    const g = garage().filter((v) => v.tier !== 'car');
    createProgressStore(storage, 'greybox', garage).save({ totals: ZERO, garage: g, lastRide: null });
    expect(createProgressStore(storage, 'greybox', garage).load().garage.map((v) => v.tier)).toEqual(['skateboard', 'bicycle', 'motorbike']);
  });

  it('a v2 record keeps its totals and gets the default garage', () => {
    const storage = memoryStorage();
    storage.data.set(PROGRESS_KEY_V2, JSON.stringify({ totals: TOTALS, capacityTier: 'car' }));
    const p = createProgressStore(storage, 'greybox', garage).load();
    expect(p).toEqual({ totals: TOTALS, garage: garage(), lastRide: null });
    expect(p).not.toHaveProperty('capacityTier');
    expect(createProgressStore(storage, 'city', garage).load().totals).toEqual(ZERO);
  });

  it('a corrupt v3 record does not bring back the v2 totals (final review 8)', () => {
    for (const bad of ['{not json', '[1,2]', '"text"', 'null']) {
      const storage = memoryStorage();
      storage.data.set(PROGRESS_KEY_V2, JSON.stringify({ totals: TOTALS, capacityTier: 'car' }));
      storage.data.set(progressKey('greybox'), bad);
      expect(createProgressStore(storage, 'greybox', garage).load(), bad).toEqual({ totals: ZERO, garage: garage(), lastRide: null });
    }
  });

  it('a bad vehicle entry falls back to the default for that tier only', () => {
    const storage = memoryStorage();
    const g = garage();
    const parked = { kind: 'parked', position: { x: 1, y: 0, z: 2 }, heading: 0.5 };
    storage.data.set(
      progressKey('greybox'),
      JSON.stringify({
        totals: TOTALS,
        garage: [
          { tier: 'skateboard', spot: { kind: 'carried' }, fuel: 0.2 },
          { tier: 'bicycle', spot: 'nowhere', fuel: 0.3 },
          { tier: 'motorbike', spot: parked, fuel: 'full' },
          { tier: 'car', spot: parked, fuel: 7 },
          { tier: 'hoverboard', spot: parked, fuel: 1 },
        ],
        lastRide: 'car',
      }),
    );
    const p = createProgressStore(storage, 'greybox', garage).load();
    expect(p.garage).toEqual([
      { tier: 'skateboard', spot: { kind: 'carried' }, fuel: 0.2 },
      g[1],
      g[2],
      { tier: 'car', spot: parked, fuel: 1 },
    ]);
    expect(p.lastRide).toBe('car');
  });

  it('a vehicle saved while riding loads as parked at that spot', () => {
    const storage = memoryStorage();
    storage.data.set(
      progressKey('greybox'),
      JSON.stringify({
        totals: ZERO,
        garage: [{ tier: 'car', spot: { kind: 'riding', position: { x: 5, y: 1, z: 6 }, heading: 2 }, fuel: 0.5 }],
        lastRide: 'car',
      }),
    );
    expect(createProgressStore(storage, 'greybox', garage).load().garage).toEqual([
      { tier: 'car', spot: { kind: 'parked', position: { x: 5, y: 1, z: 6 }, heading: 2 }, fuel: 0.5 },
    ]);
  });

  it('a riding entry without a position takes the default for its tier', () => {
    const storage = memoryStorage();
    storage.data.set(progressKey('greybox'), JSON.stringify({ totals: ZERO, garage: [{ tier: 'car', spot: { kind: 'riding' }, fuel: 0.5 }] }));
    expect(createProgressStore(storage, 'greybox', garage).load().garage).toEqual([garage()[3]]);
  });

  it('returns defaults when nothing is stored or getItem throws', () => {
    const fresh = { totals: ZERO, garage: garage(), lastRide: null };
    expect(createProgressStore(memoryStorage(), 'greybox', garage).load()).toEqual(fresh);
    const blocked = {
      getItem: (): string | null => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: (): void => undefined,
    };
    expect(createProgressStore(blocked, 'greybox', garage).load()).toEqual(fresh);
    expect(createProgressStore(null, 'greybox', garage).load()).toEqual(fresh);
  });

  it('returns defaults for malformed JSON or wrong shapes', () => {
    const storage = memoryStorage();
    for (const bad of ['{not json', 'null', '42', '[]', '"x"']) {
      storage.data.set(progressKey('greybox'), bad);
      expect(createProgressStore(storage, 'greybox', garage).load()).toEqual({ totals: ZERO, garage: garage(), lastRide: null });
    }
  });

  it('falls back field by field on invalid values', () => {
    const storage = memoryStorage();
    const store = createProgressStore(storage, 'greybox', garage);
    storage.data.set(progressKey('greybox'), JSON.stringify({ totals: { points: '7', coins: 5, deliveries: -1 }, garage: 5, lastRide: 'walk' }));
    expect(store.load()).toEqual({ totals: { points: 0, coins: 5, deliveries: 0 }, garage: garage(), lastRide: null });
    storage.data.set(progressKey('greybox'), '{"totals":{"points":1e999,"coins":2,"deliveries":3},"lastRide":"bicycle","garage":[]}');
    expect(store.load()).toEqual({ totals: { points: 0, coins: 2, deliveries: 3 }, garage: [], lastRide: 'bicycle' });
    expect(RIDE_TIERS).toContain('bicycle');
  });

  it('save does not throw when setItem throws', () => {
    const storage = {
      getItem: (): string | null => null,
      setItem: (): void => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    expect(() => createProgressStore(storage, 'greybox', garage).save({ totals: ZERO, garage: [], lastRide: null })).not.toThrow();
    expect(() => createProgressStore(null, 'greybox').save({ totals: ZERO, garage: [], lastRide: null })).not.toThrow();
  });

  it('load returns a fresh object each time', () => {
    const store = createProgressStore(null, 'greybox', garage);
    store.load().totals.points = 99;
    expect(store.load().totals.points).toBe(0);
  });
});

describe('saveWhenLeaving (final review 10)', () => {
  it('saves on pagehide and when the page turns hidden, not when it turns visible; the disposer stops it', () => {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    let saves = 0;
    const off = saveWhenLeaving(win, doc, () => void saves++);
    win.dispatchEvent(new Event('pagehide'));
    expect(saves).toBe(1);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(saves).toBe(1);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(saves).toBe(2);
    off();
    win.dispatchEvent(new Event('pagehide'));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(saves).toBe(2);
  });
});
