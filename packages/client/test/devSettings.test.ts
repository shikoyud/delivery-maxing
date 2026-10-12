import { describe, expect, it } from 'vitest';
import { movementConfig, ordersConfig } from '@dm/shared';
import { DEV_KEY, createDevSettingsStore } from '../src/game/devSettings';

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
});
