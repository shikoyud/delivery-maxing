import { describe, expect, it } from 'vitest';
import { PROGRESS_KEY, createProgressStore } from '../src/game/progress';

const DEFAULTS = { totals: { points: 0, coins: 0, deliveries: 0 }, capacityTier: 'walk' };

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('createProgressStore (v2)', () => {
  it('uses the v2 key', () => {
    expect(PROGRESS_KEY).toBe('dm.progress.v2');
  });

  it('v2 key: an SP1 record is ignored and defaults load', () => {
    const storage = memoryStorage();
    storage.data.set('dm.progress.v1', JSON.stringify({ points: 7, coins: 70, deliveries: 4 }));
    expect(createProgressStore(storage).load()).toEqual(DEFAULTS);
  });

  it('saves and loads totals and capacityTier', () => {
    const storage = memoryStorage();
    createProgressStore(storage).save({ totals: { points: 7, coins: 70, deliveries: 4 }, capacityTier: 'bicycle' });
    expect(storage.data.has(PROGRESS_KEY)).toBe(true);
    expect(createProgressStore(storage).load()).toEqual({
      totals: { points: 7, coins: 70, deliveries: 4 },
      capacityTier: 'bicycle',
    });
  });

  it('returns defaults when nothing is stored', () => {
    expect(createProgressStore(memoryStorage()).load()).toEqual(DEFAULTS);
  });

  it('returns defaults when getItem throws', () => {
    const storage = {
      getItem: (): string | null => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: (): void => undefined,
    };
    expect(createProgressStore(storage).load()).toEqual(DEFAULTS);
  });

  it('returns defaults for malformed JSON or wrong shapes', () => {
    const storage = memoryStorage();
    for (const bad of ['{not json', 'null', '42', '[]', '"x"']) {
      storage.data.set(PROGRESS_KEY, bad);
      expect(createProgressStore(storage).load()).toEqual(DEFAULTS);
    }
  });

  it('falls back field by field on invalid values', () => {
    const storage = memoryStorage();
    const store = createProgressStore(storage);
    storage.data.set(PROGRESS_KEY, JSON.stringify({ totals: { points: '7', coins: 5, deliveries: -1 }, capacityTier: 'car' }));
    expect(store.load()).toEqual({ totals: { points: 0, coins: 5, deliveries: 0 }, capacityTier: 'car' });
    storage.data.set(PROGRESS_KEY, JSON.stringify({ totals: { points: 1, coins: 2, deliveries: 3 }, capacityTier: 'hoverboard' }));
    expect(store.load()).toEqual({ totals: { points: 1, coins: 2, deliveries: 3 }, capacityTier: 'walk' });
    storage.data.set(PROGRESS_KEY, '{"totals":{"points":1e999,"coins":2,"deliveries":3},"capacityTier":"walk"}');
    expect(store.load().totals.points).toBe(0);
    storage.data.set(PROGRESS_KEY, JSON.stringify({ totals: 5, capacityTier: 'motorbike' }));
    expect(store.load()).toEqual({ ...DEFAULTS, capacityTier: 'motorbike' });
  });

  it('save does not throw when setItem throws', () => {
    const storage = {
      getItem: (): string | null => null,
      setItem: (): void => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    expect(() => createProgressStore(storage).save(DEFAULTS as never)).not.toThrow();
  });

  it('null storage returns defaults', () => {
    const store = createProgressStore(null);
    expect(store.load()).toEqual(DEFAULTS);
    expect(() => store.save(DEFAULTS as never)).not.toThrow();
  });

  it('load returns a fresh object each time', () => {
    const store = createProgressStore(null);
    const a = store.load();
    a.totals.points = 99;
    expect(store.load()).toEqual(DEFAULTS);
  });
});
