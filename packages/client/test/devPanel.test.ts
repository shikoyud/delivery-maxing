import { describe, expect, it } from 'vitest';
import { GAME_UNITS, effectiveCapacity, expandGreybox, type GreyboxSource, type MapData } from '@dm/shared';
import greyboxJson from '../../../map/greybox.json';
import cityJson from '../../../map/city.layout.json';
import type { MockChain } from '../src/economy/MockChain';
import { capacityLabel, economyActions, mapRowItems, ownedBoxStates } from '../src/ui/devPanel';
import { teleportTargets } from '../src/game/mapTargets';

const grey = expandGreybox(greyboxJson as GreyboxSource);
// The city layout's hospitals and gas stations are all the Map row reads.
const city = { kind: 'city', hospitals: cityJson.hospitals, gasStations: cityJson.gasStations } as unknown as MapData;

describe('dev panel Map row', () => {
  it('lists 4 hospitals and 6 gas stations on the city', () => {
    const items = mapRowItems(teleportTargets(city), () => undefined);
    expect(items.filter((i) => i.kind === 'hospital')).toHaveLength(4);
    expect(items.filter((i) => i.kind === 'gas')).toHaveLength(6);
  });

  it('lists 4 hospitals and 2 gas stations on the greybox', () => {
    const items = mapRowItems(teleportTargets(grey), () => undefined);
    expect(items.filter((i) => i.kind === 'hospital')).toHaveLength(4);
    expect(items.filter((i) => i.kind === 'gas')).toHaveLength(2);
  });

  it('clicking an entry calls teleportTo with its id', () => {
    const calls: string[] = [];
    const items = mapRowItems(teleportTargets(city), (id) => void calls.push(id));
    items[0]!.run();
    items[items.length - 1]!.run();
    expect(calls).toEqual(['hospital-bayview-general', 'gas-ridge-fuel']);
    expect(items[0]!.label).toMatch(/^Teleport to /);
  });
});

describe('capacityLabel', () => {
  it('shows the Bag tier, the ride and the capacity they give', () => {
    expect(capacityLabel(2, 'bicycle', effectiveCapacity(2, 'bicycle'))).toBe('Bag 2 × bicycle → 3 slots, 25 kg');
    expect(capacityLabel(0, 'walk', effectiveCapacity(0, 'walk'))).toBe('Bag 0 × walk → 1 slot, 0 kg');
  });
});

describe('dev panel Economy folder', () => {
  const calls: unknown[][] = [];
  const dev = {
    addGame: (n: number) => void calls.push(['addGame', n]),
    setRate: (r: number) => {
      calls.push(['setRate', r]);
      return r <= 0.0003;
    },
    makeRateStale: () => void calls.push(['stale']),
    failNext: () => void calls.push(['failNext']),
    setConfirmSeconds: (s: number) => void calls.push(['confirm', s]),
    setVaultUsd: (u: number) => void calls.push(['vault', u]),
    grantTier: (l: string, t: number) => void calls.push(['grant', l, t]),
    advanceClock: (ms: number) => void calls.push(['clock', ms]),
  } as unknown as MockChain['dev'];

  it('adds GAME, sets the rate, makes it stale, fails the next tx, sets the vault and grants tiers through the hooks', () => {
    calls.length = 0;
    const a = economyActions(dev, GAME_UNITS);
    a.addGame();
    expect(a.setRate(0.00025)).toBeNull();
    expect(a.setRate(0.01)).toBe('Rate move over 20% refused');
    a.makeStale();
    a.failNext();
    a.setConfirmSeconds(5);
    a.setVaultUsd(10);
    a.setTier('bag', 2);
    a.advanceDay();
    expect(calls).toEqual([
      ['addGame', 100_000 * GAME_UNITS],
      ['setRate', 0.00025],
      ['setRate', 0.01],
      ['stale'],
      ['failNext'],
      ['confirm', 5],
      ['vault', 10],
      ['grant', 'bag', 2],
      ['clock', 86_400_000],
    ]);
  });

  it('Owned boxes grant and revoke vehicle tiers on the chain; locked while riding that tier', () => {
    const boxes = ownedBoxStates((t) => t === 'bicycle', 'bicycle');
    expect(boxes.find((b) => b.tier === 'bicycle')).toEqual({ tier: 'bicycle', owned: true, locked: true });
    expect(boxes.filter((b) => b.locked)).toHaveLength(1);
    expect(ownedBoxStates(() => false, null).every((b) => !b.locked && !b.owned)).toBe(true);
  });
});
