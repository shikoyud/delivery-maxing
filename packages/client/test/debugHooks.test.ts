import { afterEach, describe, expect, it } from 'vitest';
import { vec3, type CityMap, type Lot, type Vec3 } from '@dm/shared';
import { installDebugHooks } from '../src/game/debugHooks';
import type { Game } from '../src/game/Game';

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
