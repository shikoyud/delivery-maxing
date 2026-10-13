import { describe, expect, it } from 'vitest';
import { epochIdAt, ordersConfig } from '@dm/shared';
import { PROGRESS_KEY, PROGRESS_KEY_V1, createProgressStore, type Progress } from '../src/game/progress';

const S = ordersConfig.epoch.seconds;
/** 2026-10-13 12:05:00 UTC: mid-window. */
const NOW = Date.UTC(2026, 9, 13, 12, 5, 0);
const EPOCH = epochIdAt(NOW, S);
const ZERO: Progress = { totals: { points: 0, coins: 0, deliveries: 0 }, epoch: { id: EPOCH, points: 0 } };

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('createProgressStore', () => {
  it('round-trips totals and epoch points under the v2 key', () => {
    const storage = memoryStorage();
    const p: Progress = { totals: { points: 7, coins: 70, deliveries: 4 }, epoch: { id: EPOCH, points: 3 } };
    createProgressStore(storage).save(p);
    expect(PROGRESS_KEY).toBe('dm.progress.v2');
    expect(JSON.parse(storage.data.get(PROGRESS_KEY)!)).toEqual(p);
    expect(createProgressStore(storage).load(NOW)).toEqual(p);
  });

  it('v1 data migrates to v2 with epoch {id: current, points: 0}', () => {
    const storage = memoryStorage();
    storage.data.set(PROGRESS_KEY_V1, JSON.stringify({ points: 7, coins: 70, deliveries: 4 }));
    expect(PROGRESS_KEY_V1).toBe('dm.progress.v1');
    const store = createProgressStore(storage);
    expect(store.load(NOW)).toEqual({ totals: { points: 7, coins: 70, deliveries: 4 }, epoch: { id: EPOCH, points: 0 } });
    // The next save writes v2; from then on v2 wins over the old v1 entry.
    store.save({ totals: { points: 9, coins: 90, deliveries: 5 }, epoch: { id: EPOCH, points: 2 } });
    expect(store.load(NOW)).toEqual({ totals: { points: 9, coins: 90, deliveries: 5 }, epoch: { id: EPOCH, points: 2 } });
  });

  it('a stored epoch from an earlier window loads as 0 points', () => {
    const storage = memoryStorage();
    const totals = { points: 7, coins: 70, deliveries: 4 };
    storage.data.set(PROGRESS_KEY, JSON.stringify({ totals, epoch: { id: EPOCH - 1, points: 5 } }));
    expect(createProgressStore(storage).load(NOW)).toEqual({ totals, epoch: { id: EPOCH, points: 0 } });
    // The window boundary itself: 12:09:59.999 is still this epoch, 12:10:00 is the next.
    storage.data.set(PROGRESS_KEY, JSON.stringify({ totals, epoch: { id: EPOCH, points: 5 } }));
    const boundary = (EPOCH + 1) * S * 1000;
    expect(createProgressStore(storage).load(boundary - 1).epoch).toEqual({ id: EPOCH, points: 5 });
    expect(createProgressStore(storage).load(boundary).epoch).toEqual({ id: EPOCH + 1, points: 0 });
  });

  it('returns zero progress in the current epoch when nothing is stored', () => {
    expect(createProgressStore(memoryStorage()).load(NOW)).toEqual(ZERO);
  });

  it('returns zero progress when getItem throws (Review Focus 5)', () => {
    const storage = {
      getItem: (): string | null => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: (): void => undefined,
    };
    expect(createProgressStore(storage).load(NOW)).toEqual(ZERO);
  });

  it('returns zero progress for malformed v2 data', () => {
    const storage = memoryStorage();
    for (const bad of [
      '{not json',
      'null',
      '42',
      '[]',
      '{}',
      JSON.stringify({ totals: { points: '7', coins: 1, deliveries: 1 }, epoch: { id: EPOCH, points: 0 } }),
      JSON.stringify({ totals: { points: -1, coins: 0, deliveries: 0 }, epoch: { id: EPOCH, points: 0 } }),
      JSON.stringify({ totals: null, epoch: { id: EPOCH, points: 3 } }),
    ]) {
      storage.data.set(PROGRESS_KEY, bad);
      expect(createProgressStore(storage).load(NOW), bad).toEqual(ZERO);
    }
  });

  it('a v2 entry with valid totals but a malformed epoch keeps the totals and starts a fresh epoch', () => {
    const storage = memoryStorage();
    const totals = { points: 7, coins: 70, deliveries: 4 };
    for (const bad of [
      JSON.stringify({ totals, epoch: { id: EPOCH, points: -1 } }),
      JSON.stringify({ totals, epoch: { id: 1.5, points: 0 } }),
      JSON.stringify({ totals, epoch: null }),
      JSON.stringify({ totals }),
    ]) {
      storage.data.set(PROGRESS_KEY, bad);
      expect(createProgressStore(storage).load(NOW), bad).toEqual({ totals, epoch: { id: EPOCH, points: 0 } });
    }
  });

  it('returns zero progress for malformed v1 data', () => {
    const storage = memoryStorage();
    for (const bad of ['{not json', 'null', '[]', '{"points":"7","coins":1,"deliveries":1}', '{"points":-1,"coins":0,"deliveries":0}']) {
      storage.data.set(PROGRESS_KEY_V1, bad);
      expect(createProgressStore(storage).load(NOW), bad).toEqual(ZERO);
    }
  });

  it('save does not throw when setItem throws', () => {
    const storage = {
      getItem: (): string | null => null,
      setItem: (): void => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    expect(() => createProgressStore(storage).save(ZERO)).not.toThrow();
  });

  it('null storage returns zero progress', () => {
    const store = createProgressStore(null);
    expect(store.load(NOW)).toEqual(ZERO);
    expect(() => store.save(ZERO)).not.toThrow();
  });

  it('load returns a fresh object each time', () => {
    const store = createProgressStore(null);
    const a = store.load(NOW);
    a.totals.points = 99;
    a.epoch.points = 99;
    expect(store.load(NOW)).toEqual(ZERO);
  });
});
