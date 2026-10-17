import { describe, expect, test } from 'vitest';
import { cityConfig, connectorExtent, mulberry32, type BandId } from '@dm/shared';
import { bandConnectors, bandGaps, slopeLots } from '../../src/city/bands';
import { readCatalog } from '../../src/city/files';
import { REPO } from '../../src/nav/files';

const cat = readCatalog(REPO);
const BANDS: BandId[] = ['A', 'B', 'C', 'D'];
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] - 1e-9 && b[0] < a[1] - 1e-9;

describe('bandConnectors', () => {
  test('band B: 3 switchbacks, 3 steep lanes and 10 staircases whose x-extents do not overlap, all inside the city', () => {
    const cs = bandConnectors('B', cityConfig);
    const count = (k: string) => cs.filter((c) => c.kind === k).length;
    expect([count('switchback'), count('steepLane'), count('stairs')]).toEqual([3, 3, 10]);
    const ext = cs.map((c) => connectorExtent(c, cityConfig));
    for (let i = 0; i < ext.length; i++) for (let j = i + 1; j < ext.length; j++) expect(overlaps(ext[i]!, ext[j]!), `${cs[i]!.id} / ${cs[j]!.id}`).toBe(false);
    for (const c of cs) {
      if (c.kind !== 'switchback') {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThanOrEqual(1200);
      }
      expect(c).toMatchObject({ band: 'B', ...cityConfig.bands.B });
    }
    // switchbacks start on cross streets 2, 6, 10; steep lanes 40 m east of cross streets 0, 4, 8
    expect(cs.filter((c) => c.kind === 'switchback').map((c) => c.x)).toEqual([228, 660, 1092]);
    expect(cs.filter((c) => c.kind === 'steepLane').map((c) => c.x)).toEqual([52, 484, 916]);
    expect(cs.filter((c) => c.kind === 'switchback').every((c) => c.legLength === 80)).toBe(true);
  });

  test('the whole city: 11 switchbacks, 10 steep lanes, 31 staircases (design section 4), every extent inside 0-1200', () => {
    let sw = 0;
    let lanes = 0;
    let stairs = 0;
    for (const b of BANDS) {
      const cs = bandConnectors(b, cityConfig);
      sw += cs.filter((c) => c.kind === 'switchback').length;
      lanes += cs.filter((c) => c.kind === 'steepLane').length;
      stairs += cs.filter((c) => c.kind === 'stairs').length;
      const ext = cs.map((c) => connectorExtent(c, cityConfig));
      for (const [a, e] of ext) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(e).toBeLessThanOrEqual(1200);
      }
      for (let i = 0; i < ext.length; i++) for (let j = i + 1; j < ext.length; j++) expect(overlaps(ext[i]!, ext[j]!)).toBe(false);
    }
    expect([sw, lanes, stairs]).toEqual([11, 10, 31]);
  });

  test('a band D switchback leg is long enough to climb half of 10 m at 9 %', () => {
    const sw = bandConnectors('D', cityConfig).filter((c) => c.kind === 'switchback');
    for (const c of sw) expect(c.legLength!).toBeGreaterThanOrEqual(5 / 0.09 - 1e-9);
  });
});

describe('slopeLots', () => {
  test('band B: only House_05, House_06 and OldHouse_07, each with an upper door at y 24, clear of every connector', () => {
    const cs = bandConnectors('B', cityConfig);
    const used = cs.map((c) => connectorExtent(c, cityConfig));
    const lots = slopeLots('B', used, mulberry32(7), cat, cityConfig);
    expect(lots.length).toBeGreaterThan(10);
    for (const l of lots) {
      expect(['mega/House_05', 'mega/House_06', 'mega/OldHouse_07']).toContain(l.asset);
      expect(l.upperDoor).not.toBeNull();
      expect(l.upperDoor!.y).toBe(24);
      expect(l.upperDoor!.position.y).toBe(24);
      expect(l.upperDoor!.position.z).toBe(l.rect.maxZ);
      expect(l.y).toBe(10);
      expect(l.level).toBe('L1');
      expect(l.district).toBe('slope');
      expect(l.facing).toBe('S');
      expect(l.rect.minZ).toBe(560);
      for (const u of used) expect(overlaps([l.rect.minX, l.rect.maxX], [u[0] - 2, u[1] + 2])).toBe(false);
    }
    for (let i = 1; i < lots.length; i++) expect(lots[i]!.rect.minX).toBeGreaterThanOrEqual(lots[i - 1]!.rect.maxX);
  });

  test('bands A and D get no walk-ups', () => {
    for (const b of ['A', 'D'] as const) {
      const used = bandConnectors(b, cityConfig).map((c) => connectorExtent(c, cityConfig));
      expect(slopeLots(b, used, mulberry32(1), cat, cityConfig)).toEqual([]);
    }
  });
});

describe('bandGaps', () => {
  test('a bandGap area at y0 under each switchback and steep lane x-extent, the band deep', () => {
    const cs = bandConnectors('C', cityConfig);
    const gaps = bandGaps('C', cs, cityConfig);
    const open = cs.filter((c) => c.kind !== 'stairs');
    expect(gaps).toHaveLength(open.length);
    for (const [i, c] of open.entries()) {
      const [a, e] = connectorExtent(c, cityConfig);
      expect(gaps[i]).toMatchObject({ kind: 'bandGap', y: 24, district: 'slope', rect: { minX: a, maxX: e, minZ: 820, maxZ: 880 } });
    }
  });
});
