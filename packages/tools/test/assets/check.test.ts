import { describe, expect, it } from 'vitest';
import { parseCatalog, type AssetCatalog, type CatalogEntry } from '@dm/shared';
import { checkPacks, formatReport } from '../../src/assets/check';
import { FIXTURE_PACKS } from '../helpers/fixtures';

const entry = (id: string, file: string | null, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  file,
  category: 'prop',
  size: { w: 2, h: 3, d: 4 },
  pivot: { x: 0, z: 0, minY: -1.5 },
  tris: 12,
  use: 'placed',
  ...over,
});
const cat = (...entries: CatalogEntry[]): AssetCatalog => parseCatalog({ version: 1, packs: {}, entries });

describe('checkPacks', () => {
  it('reports missing, extra, size change and pivot change', async () => {
    const r = await checkPacks(
      FIXTURE_PACKS,
      cat(
        entry('fixture/box', 'fixture/box.glb'),
        entry('fixture/gone', 'fixture/gone.glb'),
        entry('fixture/wide', 'fixture/box.glb', { size: { w: 1.4, h: 3, d: 4 } }),
        entry('fixture/moved', 'fixture/offset.glb'),
      ),
    );
    expect(r.missing).toEqual(['fixture/gone']);
    expect(r.extra).toEqual([]);
    expect(r.sizeChanged).toEqual([
      { id: 'fixture/wide', was: { w: 1.4, h: 3, d: 4 }, now: { w: 2, h: 3, d: 4 }, reason: 'footprint' },
      { id: 'fixture/moved', was: { w: 2, h: 3, d: 4 }, now: { w: 2, h: 3, d: 4 }, reason: 'pivot' },
    ]);
    expect(formatReport(r)).toMatch(/missing.*fixture\/gone/s);
  });

  it('lists packs files the catalog does not know as extra', async () => {
    const r = await checkPacks(FIXTURE_PACKS, cat(entry('fixture/box', 'fixture/box.glb')));
    expect(r.extra).toEqual(['fixture/offset.glb']);
    expect(r.missing).toEqual([]);
    expect(r.sizeChanged).toEqual([]);
  });

  it('does not report known-missing entries (no file) as missing', async () => {
    const r = await checkPacks(FIXTURE_PACKS, cat(entry('missing/X', null, { status: 'missing' }), entry('fixture/box', 'fixture/box.glb'), entry('fixture/offset', 'fixture/offset.glb', { pivot: { x: 1, z: 0, minY: -1.5 } })));
    expect(r.missing).toEqual([]);
  });
});
