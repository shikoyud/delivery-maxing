import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMap, parseMapKind } from '../src/game/mapLoader';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** A fetch that serves the repo's files for the URLs Vite gives `?url` imports (`/@fs/<abs path>` or `/<repo path>`). */
function fileFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = decodeURIComponent(String(input)).split('?')[0]!;
    const candidates = [url.replace(/^\/@fs/, ''), `${repoRoot}${url.replace(/^\//, '')}`];
    const path = candidates.find((p) => existsSync(p));
    if (!path) return new Response(null, { status: 404 });
    return new Response(readFileSync(path));
  }) as typeof fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('parseMapKind', () => {
  it('defaults to the city; greybox only when asked', () => {
    expect(parseMapKind(null)).toBe('city');
    expect(parseMapKind('greybox')).toBe('greybox');
    expect(parseMapKind('x')).toBe('city');
    expect(parseMapKind('city')).toBe('city');
  });
});

describe('loadMap', () => {
  it('greybox: the SP4 town, its navmeshes and no distance table', async () => {
    vi.stubGlobal('fetch', fileFetch());
    const { map, nav, distances } = await loadMap('greybox');
    expect(map.kind).toBe('greybox');
    expect(map.hospitals.length).toBeGreaterThan(0);
    expect(distances).toBeNull();
    const h = map.hospitals[0]!.spawn;
    expect(nav.distance('walk', h, h)).toBeLessThan(1);
  }, 60_000);

  it('city: the layout fetched and expanded, the city navmeshes and the distance table', async () => {
    vi.stubGlobal('fetch', fileFetch());
    const { map, distances } = await loadMap('city');
    expect(map.kind).toBe('city');
    expect(map.hospitals.map((h) => h.name)).toContain('Bayview General');
    expect(map.solids.some((s) => s.kind === 'building')).toBe(true);
    expect(distances).not.toBeNull();
  }, 120_000);

  it('a failed fetch rejects naming the URL', async () => {
    vi.stubGlobal('fetch', (async () => new Response(null, { status: 404 })) as typeof fetch);
    await expect(loadMap('city')).rejects.toThrow(/HTTP 404/);
  });
});
