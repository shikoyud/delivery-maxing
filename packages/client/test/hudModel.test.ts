import { describe, expect, it } from 'vitest';
import { expandGreybox, type GreyboxSource } from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { hudModel, poiIndex, pointsText } from '../src/ui/hudModel';

const map = expandGreybox(greybox as GreyboxSource);

describe('pointsText', () => {
  it('reads "1 pt" and "N pts"', () => {
    expect(pointsText(1)).toBe('1 pt');
    expect(pointsText(0)).toBe('0 pts');
    expect(pointsText(4)).toBe('4 pts');
  });
});

describe('poiIndex', () => {
  it('finds POIs by id and throws on an unknown one', () => {
    const idx = poiIndex(map);
    const p = map.pois[3]!;
    expect(idx.get(p.id)).toBe(p);
    expect(idx.target(p.id)).toEqual(p.position);
    expect(poiIndex(map)).toBe(idx);
    expect(() => idx.get('nope')).toThrow(/unknown POI/);
  });
});

describe('hudModel', () => {
  it('copies the totals and reports the safe zone', () => {
    const totals = { points: 3, coins: 40, deliveries: 2 };
    const m = hudModel(totals, 'Downtown General');
    expect(m).toEqual({ totals, safeZone: 'Downtown General' });
    expect(m.totals).not.toBe(totals);
  });
});
