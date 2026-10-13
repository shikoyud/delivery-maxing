import { describe, expect, it, vi } from 'vitest';
import { movementConfig, ordersConfig } from '@dm/shared';
import { DEV_KEY, countOverrides, createDebouncedSave, createDevSettingsStore, overridesLabel } from '../src/game/devSettings';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('createDevSettingsStore', () => {
  it('defaults equal config/movement.json and backpackSlots = baseSlots', () => {
    const s = createDevSettingsStore(memoryStorage()).load();
    expect(s.movement).toEqual(movementConfig);
    expect(s.backpackSlots).toBe(ordersConfig.backpack.baseSlots);
    expect(DEV_KEY).toBe('dm.dev.v1');
  });

  it('saved overrides merge over defaults; unknown keys and non-numbers are dropped', () => {
    const storage = memoryStorage();
    storage.data.set(
      DEV_KEY,
      JSON.stringify({
        backpackSlots: 3,
        movement: { run: { sprintSpeed: 9.5, runSpeed: 'fast', bogus: 1 }, nope: { a: 1 }, gravity: 25, jump: 'x' },
      }),
    );
    const s = createDevSettingsStore(storage).load();
    expect(s.backpackSlots).toBe(3);
    expect(s.movement.run.sprintSpeed).toBe(9.5);
    expect(s.movement.run.runSpeed).toBe(movementConfig.run.runSpeed);
    expect(s.movement.gravity).toBe(25);
    expect(s.movement.jump).toEqual(movementConfig.jump);
    expect('bogus' in s.movement.run).toBe(false);
    expect('nope' in s.movement).toBe(false);
  });

  it('storage that throws falls back to defaults', () => {
    const boom = (): never => {
      throw new Error('blocked');
    };
    const store = createDevSettingsStore({ getItem: boom, setItem: boom, removeItem: boom });
    expect(store.load().movement).toEqual(movementConfig);
    expect(() => store.save(store.load())).not.toThrow();
    expect(store.reset().movement).toEqual(movementConfig);
    expect(createDevSettingsStore(null).load().backpackSlots).toBe(ordersConfig.backpack.baseSlots);
  });

  it('malformed JSON falls back to defaults', () => {
    const storage = memoryStorage();
    storage.data.set(DEV_KEY, '{nope');
    expect(createDevSettingsStore(storage).load().movement).toEqual(movementConfig);
  });

  it('reset removes the saved overrides', () => {
    const storage = memoryStorage();
    const store = createDevSettingsStore(storage);
    const s = store.load();
    s.movement.run.sprintSpeed = 12;
    store.save(s);
    expect(storage.data.has(DEV_KEY)).toBe(true);
    const fresh = store.reset();
    expect(storage.data.has(DEV_KEY)).toBe(false);
    expect(fresh.movement.run.sprintSpeed).toBe(movementConfig.run.sprintSpeed);
  });

  it('save then load round-trips', () => {
    const store = createDevSettingsStore(memoryStorage());
    const s = store.load();
    s.movement.jump.height = 2;
    s.backpackSlots = 4;
    store.save(s);
    const back = store.load();
    expect(back.movement.jump.height).toBe(2);
    expect(back.backpackSlots).toBe(4);
  });

  it('load returns a deep clone: editing it never mutates the shared movementConfig import', () => {
    const before = structuredClone(movementConfig);
    const s = createDevSettingsStore(memoryStorage()).load();
    expect(s.movement).not.toBe(movementConfig);
    s.movement.run.sprintSpeed = 99;
    s.movement.gravity = 1;
    expect(movementConfig).toEqual(before);
    expect(createDevSettingsStore(memoryStorage()).load().movement.run.sprintSpeed).toBe(before.run.sprintSpeed);
  });

  it('R27: saving after one edit stores only that key (later config changes still reach playtesters)', () => {
    const storage = memoryStorage();
    const store = createDevSettingsStore(storage);
    const s = store.load();
    s.movement.run.sprintSpeed = 9.5;
    store.save(s);
    expect(JSON.parse(storage.data.get(DEV_KEY)!)).toEqual({ movement: { run: { sprintSpeed: 9.5 } } });
    s.backpackSlots = ordersConfig.backpack.baseSlots + 1;
    store.save(s);
    expect(JSON.parse(storage.data.get(DEV_KEY)!)).toEqual({
      backpackSlots: ordersConfig.backpack.baseSlots + 1,
      movement: { run: { sprintSpeed: 9.5 } },
    });
    // Load still merges the diff over the current defaults.
    const back = store.load();
    expect(back.movement.run.sprintSpeed).toBe(9.5);
    expect(back.movement.run.runSpeed).toBe(movementConfig.run.runSpeed);
    expect(back.movement.slide).toEqual(movementConfig.slide);
  });

  it('R27: saving settings equal to the defaults leaves no saved key', () => {
    const storage = memoryStorage();
    const store = createDevSettingsStore(storage);
    const s = store.load();
    s.movement.gravity = 30;
    store.save(s);
    expect(storage.data.has(DEV_KEY)).toBe(true);
    s.movement.gravity = movementConfig.gravity;
    store.save(s);
    expect(storage.data.has(DEV_KEY)).toBe(false);
  });

  it('R27: countOverrides counts the values that differ from the defaults', () => {
    const s = createDevSettingsStore(null).load();
    expect(countOverrides(s)).toBe(0);
    s.movement.jump.height = 2;
    s.movement.gravity = 25;
    s.backpackSlots = ordersConfig.backpack.baseSlots + 1;
    expect(countOverrides(s)).toBe(3);
  });

  it('R27: Reset tuning cancels a pending debounced save, so no saved key comes back', () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const store = createDevSettingsStore(storage);
      const s = store.load();
      const saver = createDebouncedSave(() => store.save(s), 300);
      s.movement.run.sprintSpeed = 12;
      saver.schedule();
      saver.cancel();
      store.reset();
      vi.advanceTimersByTime(1000);
      expect(storage.data.has(DEV_KEY)).toBe(false);
      saver.schedule();
      vi.advanceTimersByTime(299);
      expect(storage.data.has(DEV_KEY)).toBe(false);
      vi.advanceTimersByTime(1);
      expect(storage.data.has(DEV_KEY)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('R27: overridesLabel reads "N overrides active" with a proper singular', () => {
    expect(overridesLabel(0)).toBe('No overrides active');
    expect(overridesLabel(1)).toBe('1 override active');
    expect(overridesLabel(3)).toBe('3 overrides active');
  });
});
