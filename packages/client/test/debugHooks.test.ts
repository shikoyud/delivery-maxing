import { afterEach, describe, expect, it } from 'vitest';
import { vec3, type CityMap, type Lot, type Vec3 } from '@dm/shared';
import { installDebugHooks } from '../src/game/debugHooks';
import type { Game } from '../src/game/Game';
import type { Look } from '../src/render/cosmetics';

const lot = { id: 'lot-a', rect: { minX: -5, minZ: -5, maxX: 5, maxZ: 5 }, y: 10, door: vec3(0, 10, -5) } as unknown as Lot;
const map = {
  kind: 'city',
  hospitals: [{ id: 'hospital-bayview-general', name: 'Bayview General', spawn: vec3(100, 2, -30), spawnYaw: 1.5 }],
  gasStations: [],
  layout: { lots: [lot] },
} as unknown as CityMap;

function fakeGame() {
  const teleports: Vec3[] = [];
  const state = { heading: 0 };
  const game = { map, mapKind: map.kind, sim: { state }, teleport: (p: Vec3) => void teleports.push(p) } as unknown as Game;
  return { game, teleports, state };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('debug hooks: map', () => {
  it("teleportTo('bayview-general') places the player at that hospital's spawn", () => {
    (globalThis as { window?: unknown }).window = {};
    const { game, teleports, state } = fakeGame();
    installDebugHooks(game);
    window.__dm!.teleportTo('bayview-general');
    expect(teleports).toEqual([vec3(100, 2, -30)]);
    expect(state.heading).toBe(1.5);
  });

  it('teleportTo takes a lot id and throws on an unknown one', () => {
    (globalThis as { window?: unknown }).window = {};
    const { game, teleports } = fakeGame();
    installDebugHooks(game);
    window.__dm!.teleportTo('lot-a');
    expect(teleports).toEqual([vec3(0, 10, -5)]);
    expect(() => window.__dm!.teleportTo('nowhere')).toThrow(/unknown/);
  });

  it('lotAt returns the lot under a point, else null', () => {
    (globalThis as { window?: unknown }).window = {};
    installDebugHooks(fakeGame().game);
    expect(window.__dm!.lotAt(vec3(1, 0, 1))?.id).toBe('lot-a');
    expect(window.__dm!.lotAt(vec3(50, 0, 1))).toBeNull();
  });
});

describe('debug hooks: economy', () => {
  it('chain(), buy(), shop(), lockGame(), claim() and the map hooks are installed', async () => {
    (globalThis as { window?: unknown }).window = {};
    const log: string[] = [];
    // One shared ownership object, as MockChain returns its snapshot: only a real copy keeps it from the caller.
    const ownership = { lines: { vehicle: 1 } };
    const chain = {
      balance: () => 5,
      accrued: () => 2,
      vault: () => 9,
      ownership: () => ownership,
      lock: () => null,
      history: () => [],
      payouts: () => [],
      dev: { addGame: () => undefined },
    };
    const game = {
      chain,
      time: 3,
      purchases: { buy: async (id: string) => (log.push(`buy ${id}`), { ok: true as const }) },
      delivery: {
        shopRows: (now: number) => (log.push(`shop ${now}`), [{ id: 'x' }]),
        lockGame: (g: number) => void log.push(`lock ${g}`),
        claim: async () => void log.push('claim'),
        mapOpen: false,
        openMap: () => void log.push('openMap'),
        closeMap: () => void log.push('closeMap'),
      },
    } as unknown as Game;
    installDebugHooks(game);
    const dm = window.__dm!;
    expect(dm.chain()).toMatchObject({ balance: 5, accrued: 2, vault: 9, lock: null, history: [], payouts: [] });
    expect(await dm.buy('lockoutSkip')).toEqual({ ok: true });
    const snap = dm.chain();
    (snap.ownership as { lines: Record<string, number> }).lines.vehicle = 99;
    expect(dm.chain().ownership.lines.vehicle).toBe(1);
    expect(ownership.lines.vehicle).toBe(1);
    expect(dm.shop()).toEqual([{ id: 'x' }]);
    expect(dm.devChain).toBe(chain.dev);
    dm.lockGame(7);
    await dm.claim();
    expect(dm.mapOpen()).toBe(false);
    dm.openMap();
    dm.closeMap();
    expect(log).toEqual(['buy lockoutSkip', 'shop 3', 'lock 7', 'claim', 'openMap', 'closeMap']);
  });
});

describe('debug hooks: look', () => {
  it('look() is null before the first draw, then a copy of the look drawn', () => {
    (globalThis as { window?: unknown }).window = {};
    const game = { drawnLook: null } as unknown as Game;
    installDebugHooks(game);
    expect(window.__dm!.look()).toBeNull();
    const drawn: Look = { outfit: { finish: 'gold' }, vehicle: { color: 0xc8323c }, bag: 1, phone: 2 };
    game.drawnLook = drawn;
    const seen = window.__dm!.look()!;
    expect(seen).toEqual(drawn);
    seen.bag = 9;
    expect(drawn.bag).toBe(1);
  });
});
