import { describe, expect, it } from 'vitest';
import { economyConfig, type RideTier } from '@dm/shared';
import { MockChain } from '../src/economy/MockChain';
import { Game } from '../src/game/Game';

/**
 * Game.setVehicleTier (the dev panel's tier slider) on a stand-in Game: the real MockChain, the real setOwned, and
 * recorders for the view snap and the save (the rest of Game needs WebGL and physics).
 */
function fakeGame(riding: RideTier | null = null) {
  const chain = new MockChain(null, economyConfig, { now: () => 0 });
  const log: string[] = [];
  const game = {
    chain,
    sim: { state: { riding } },
    vehicles: { snap: () => void log.push('snap') },
    delivery: { save: () => void log.push('save') },
    setOwned: Game.prototype.setOwned,
  } as unknown as Game;
  const setTier = (n: number): boolean => Game.prototype.setVehicleTier.call(game, n);
  return { chain, game, log, setTier };
}

describe('Game.setVehicleTier (dev panel slider)', () => {
  it('moves the chain up to tier n through setOwned (tiers below come along), saved', () => {
    const s = fakeGame();
    expect(s.setTier(3)).toBe(true);
    expect(s.chain.ownership().lines.vehicle).toBe(3);
    expect(s.log).toEqual(['snap', 'save']);
    expect(s.setTier(3)).toBe(true); // already there: nothing to do
    expect(s.log).toEqual(['snap', 'save']);
  });

  it('moves it down to tier n (the tiers above go)', () => {
    const s = fakeGame();
    s.setTier(4);
    expect(s.setTier(1)).toBe(true);
    expect(s.chain.ownership().lines.vehicle).toBe(1);
    expect(s.setTier(0)).toBe(true);
    expect(s.chain.ownership().lines.vehicle).toBe(0);
  });

  it('is refused while riding a tier the move would remove; allowed when the ridden one stays', () => {
    const s = fakeGame();
    s.setTier(4);
    (s.game.sim.state as { riding: RideTier | null }).riding = 'motorbike';
    expect(s.setTier(2)).toBe(false); // would remove the motorbike (tier 3)
    expect(s.chain.ownership().lines.vehicle).toBe(4);
    expect(s.setTier(3)).toBe(true); // only the car goes
    expect(s.chain.ownership().lines.vehicle).toBe(3);
  });
});
