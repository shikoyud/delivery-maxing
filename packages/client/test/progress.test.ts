import { describe, expect, it } from 'vitest';
import { PROGRESS_KEY, createProgressStore } from '../src/game/progress';

const ZERO = { points: 0, coins: 0, deliveries: 0 };

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('createProgressStore', () => {
  it('round-trips totals', () => {
    const storage = memoryStorage();
    createProgressStore(storage).save({ points: 7, coins: 70, deliveries: 4 });
    expect(storage.data.has(PROGRESS_KEY)).toBe(true);
    expect(PROGRESS_KEY).toBe('dm.progress.v1');
    expect(createProgressStore(storage).load()).toEqual({ points: 7, coins: 70, deliveries: 4 });
  });

  it('returns zeros when nothing is stored', () => {
    expect(createProgressStore(memoryStorage()).load()).toEqual(ZERO);
  });

  it('returns zeros when getItem throws (Review Focus 5)', () => {
    const storage = {
      getItem: (): string | null => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: (): void => undefined,
    };
    expect(createProgressStore(storage).load()).toEqual(ZERO);
  });

  it('returns zeros for malformed JSON', () => {
    const storage = memoryStorage();
    for (const bad of ['{not json', 'null', '42', '[]', '{"points":"7","coins":1,"deliveries":1}', '{"points":-1,"coins":0,"deliveries":0}']) {
      storage.data.set(PROGRESS_KEY, bad);
      expect(createProgressStore(storage).load()).toEqual(ZERO);
    }
  });

  it('save does not throw when setItem throws', () => {
    const storage = {
      getItem: (): string | null => null,
      setItem: (): void => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    expect(() => createProgressStore(storage).save({ points: 1, coins: 10, deliveries: 1 })).not.toThrow();
  });

  it('null storage returns zeros', () => {
    const store = createProgressStore(null);
    expect(store.load()).toEqual(ZERO);
    expect(() => store.save({ points: 1, coins: 10, deliveries: 1 })).not.toThrow();
  });

  it('load returns a fresh object each time', () => {
    const store = createProgressStore(null);
    const a = store.load();
    a.points = 99;
    expect(store.load()).toEqual(ZERO);
  });
});
