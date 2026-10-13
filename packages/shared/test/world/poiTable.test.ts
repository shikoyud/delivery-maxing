import { describe, expect, it } from 'vitest';
import { parsePoiTable, type PoiTableFile } from '../../src/world/poiTable';

const table = (): PoiTableFile => ({
  version: 1,
  pois: [
    { id: 'p1', district: 'downtown', elevated: true, fromHub: 120.5, toHub: 98.2, reachable: true },
    { id: 'p2', district: 'harbor', elevated: false, fromHub: -1, toHub: -1, reachable: false },
  ],
  between: [
    [0, -1],
    [-1, 0],
  ],
  unreachable: [{ id: 'p2', reason: 'no path from the HUB' }],
});

describe('parsePoiTable', () => {
  it('accepts a well-formed table and returns it', () => {
    const t = table();
    expect(parsePoiTable(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });

  it('parsePoiTable rejects a between matrix with the wrong size', () => {
    const short = { ...table(), between: [[0, -1]] };
    expect(() => parsePoiTable(short)).toThrow(/between/);
    const narrow = { ...table(), between: [[0], [-1, 0]] };
    expect(() => parsePoiTable(narrow)).toThrow(/between\[0\]/);
  });

  it('rejects a wrong version, an unknown district, a bad distance and an unknown unreachable id', () => {
    expect(() => parsePoiTable({ ...table(), version: 2 })).toThrow(/version/);
    const t1 = table();
    (t1.pois[0] as { district: string }).district = 'moon';
    expect(() => parsePoiTable(t1)).toThrow(/p1.*district/);
    const t2 = table();
    t2.pois[0]!.fromHub = Number.NaN;
    expect(() => parsePoiTable(t2)).toThrow(/p1.*fromHub/);
    const t3 = table();
    t3.between[0]![1] = -2;
    expect(() => parsePoiTable(t3)).toThrow(/between\[0\]\[1\]/);
    const t4 = table();
    t4.unreachable[0]!.id = 'p9';
    expect(() => parsePoiTable(t4)).toThrow(/p9/);
  });
});
