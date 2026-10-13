import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { movementConfig, ordersConfig, parsePoiTable, worldConfig, type CityMap, type NavLink, type Poi, type Vec3 } from '@dm/shared';
import { stableStringify } from '../../src/city/stableJson';
import { buildCityNavMesh, initNav, NavPaths, pathLength, reaches } from '../../src/nav/navmesh';
import { computePoiTable, validatePoiTable } from '../../src/nav/poiTable';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** The roof block spans x 24..36, z −6..6; its top is `roof` m up. */
const ROOF_X = 30;

/**
 * Two platforms: open ground (top 0) with the HUB at the origin, and a 12 × 12 m block east of it whose roof holds an
 * elevated POI. A street POI stands west of the HUB. The links are the test's.
 */
function fixture(roof: number, links: NavLink[], extraPois: Poi[] = []): CityMap {
  return {
    kind: 'city',
    seed: 1,
    size: 200,
    chunkSize: 100,
    districts: [{ district: 'downtown', rect: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 } }],
    solids: [
      { id: 'ground', kind: 'ground', center: v(0, -0.5, 0), size: v(100, 1, 60) },
      { id: 'block', kind: 'building', center: v(ROOF_X, roof / 2, 0), size: v(12, roof, 12) },
    ],
    zipLines: [],
    jumpPads: [],
    boostOrbs: [],
    rails: [],
    checkpoints: [],
    pois: [
      { id: 'poi-roof', position: v(ROOF_X, roof, 0), district: 'downtown', kind: 'door', elevated: true },
      { id: 'poi-street', position: v(-30, 0, 0), district: 'downtown', kind: 'mailbox' },
      ...extraPois,
    ],
    hub: {
      center: v(0, 0, 0), plazaRadius: 30, dropZoneRadius: 6, zoneHeight: 6,
      kiosk: v(0, 0, -8), kioskRange: 3, spawn: v(0, 0, 5), spawnYaw: 0,
    },
    props: [],
    streets: { nodes: [], edges: [] },
    navLinks: links,
    thiefSpawns: [],
  };
}

const pad = (roof: number): NavLink => ({ id: 'pad-nav', kind: 'pad', from: v(18, 0, 0), to: v(27, roof, 0), bidirectional: false });
const drop = (roof: number): NavLink => ({ id: 'drop', kind: 'drop', from: v(35, roof, 0), to: v(38.5, 0, 0), bidirectional: false });

beforeAll(async () => {
  await initNav();
});

describe('navmesh POI table', () => {
  it('with only a pad link the POI is unreachable (way back fails); reaches() catches the partial path recast reports as success', () => {
    const city = fixture(6, [pad(6)]);
    const nav = buildCityNavMesh(city, movementConfig);
    const paths = new NavPaths(nav);
    const roofPoi = city.pois[0]!.position;

    // Up the pad works…
    const up = paths.compute(city.hub.center, roofPoi);
    expect(up.success).toBe(true);
    expect(reaches(up.path, roofPoi, 1)).toBe(true);
    // …but the way back is a partial path that recast still calls a success (Review Focus 2)
    const back = paths.compute(roofPoi, city.hub.center);
    expect(back.success).toBe(true);
    expect(back.path.length).toBeGreaterThan(0);
    expect(reaches(back.path, city.hub.center, 1)).toBe(false);

    const table = computePoiTable(city, nav);
    expect(table.pois[0]).toMatchObject({ id: 'poi-roof', elevated: true, reachable: false, toHub: -1 });
    expect(table.pois[0]!.fromHub).toBeGreaterThan(0);
    expect(table.unreachable).toEqual([{ id: 'poi-roof', reason: 'no path back to the HUB' }]);
    expect(table.pois[1]).toMatchObject({ id: 'poi-street', reachable: true });
    expect(validatePoiTable(table, city, ordersConfig).some((e) => e.includes('poi-roof'))).toBe(true);
  });

  it('a POI on a pillar too narrow for the navmesh does not snap to the street beside it', () => {
    // A 0.6 m pillar erodes away entirely; a tall vertical query box would put the POI on the street 0.7 m off
    const pillar: Poi = { id: 'poi-pillar', position: v(-10, 6, 20), district: 'downtown', kind: 'door', elevated: true };
    const city = fixture(6, [
      { id: 'pillar-pad', kind: 'pad', from: v(-10, 0, 14), to: v(-10, 6, 20), bidirectional: false },
      { id: 'pillar-drop', kind: 'drop', from: v(-10, 6, 20), to: v(-10, 0, 21.5), bidirectional: false },
    ], [pillar]);
    city.solids.push({ id: 'pillar', kind: 'building', center: v(-10, 3, 20), size: v(0.6, 6, 0.6) });
    const table = computePoiTable(city, buildCityNavMesh(city, movementConfig));
    expect(table.pois.find((p) => p.id === 'poi-pillar')).toMatchObject({ reachable: false, fromHub: -1, toHub: -1 });
    expect(table.unreachable).toContainEqual({ id: 'poi-pillar', reason: 'no path from the HUB; no path back to the HUB' });
  });

  it('adding a 6 m drop link makes it reachable; fromHub ≈ path length', () => {
    const city = fixture(6, [pad(6), drop(6)]);
    const nav = buildCityNavMesh(city, movementConfig);
    const table = computePoiTable(city, nav);
    const row = table.pois[0]!;
    expect(row.reachable).toBe(true);
    expect(table.unreachable).toEqual([]);

    const paths = new NavPaths(nav);
    const up = paths.compute(city.hub.center, city.pois[0]!.position).path;
    expect(row.fromHub).toBe(Math.round(pathLength(up) * 10) / 10);
    // HUB → pad 18 m, the pad flight ≈ 10.8 m, landing → POI 3 m
    expect(row.fromHub).toBeGreaterThan(31);
    expect(row.fromHub).toBeLessThan(34);
    // POI → drop 5 m, the drop ≈ 7 m, then round the block's corners to the HUB ≈ 43.6 m
    expect(row.toHub).toBeGreaterThan(54);
    expect(row.toHub).toBeLessThan(58);
    // between: N × N in pois order, 0 on the diagonal, roof ↔ street both ways
    expect(table.between).toHaveLength(2);
    expect(table.between[0]![0]).toBe(0);
    expect(table.between[0]![1]).toBeGreaterThan(row.toHub);
    expect(table.between[1]![0]).toBeGreaterThan(row.fromHub);
    expect(validatePoiTable(table, city, ordersConfig).filter((e) => /drop|unreachable/.test(e))).toEqual([]);
  });

  it('a zip line is a way back: its cable ends (above the surfaces) stand on what is below them', () => {
    const hang = 3.2;
    const zip: NavLink = { id: 'zip-nav', kind: 'zip', from: v(34, 6 + hang, 4), to: v(50, hang, 4), bidirectional: true };
    const city = fixture(6, [pad(6), zip]);
    const table = computePoiTable(city, buildCityNavMesh(city, movementConfig));
    expect(table.pois[0]!.reachable).toBe(true);
  });

  it('a 9 m drop link fails validation', () => {
    const city = fixture(9, [pad(9), drop(9)]);
    const table = computePoiTable(city, buildCityNavMesh(city, movementConfig));
    expect(table.pois[0]!.reachable).toBe(true);
    const errors = validatePoiTable(table, city, ordersConfig);
    expect(errors.filter((e) => e.includes('drop'))).toEqual([`drop link drop falls 9 m (the Fragile limit is ${ordersConfig.fragile.maxFallMeters} m)`]);
  });

  it('a link longer than a tile is refused (Detour would drop it silently)', () => {
    const city = fixture(6, [pad(6)]);
    // 20 voxels × 0.4 m = 8 m tiles; the pad flies 10.8 m (9 m across)
    expect(() => buildCityNavMesh(city, movementConfig, { ...worldConfig.nav, cellSize: 0.4, tileSize: 20 })).toThrow(/pad-nav spans 9\.0 m, more than a 8 m tile/);
  });

  it('computePoiTable is deterministic (two runs, identical JSON)', () => {
    const city = fixture(6, [pad(6), drop(6)]);
    const a = stableStringify(computePoiTable(city, buildCityNavMesh(city, movementConfig)));
    const b = stableStringify(computePoiTable(city, buildCityNavMesh(city, movementConfig)));
    expect(a).toBe(b);
  });

  it('validatePoiTable reports the elevated share, thin bands and too few reachable POIs', () => {
    const city = fixture(6, [pad(6), drop(6)]);
    const table = computePoiTable(city, buildCityNavMesh(city, movementConfig));
    const rules = ordersConfig.poiChecks;
    const errors = validatePoiTable(table, city, ordersConfig);
    // 1 of 2 reachable is elevated (50%), so no share error; every band is short of its minimum; 2 < 140 reachable
    expect(errors.some((e) => e.startsWith('elevated share'))).toBe(false);
    for (const band of ['short', 'medium', 'long']) expect(errors).toContain(`only ${band === 'short' ? 2 : 0} POIs in the ${band} band (need ${rules.minPerBand})`);
    expect(errors).toContain(`only 2 reachable POIs (need ${rules.minReachable})`);

    const flat = { ...table, pois: table.pois.map((p) => ({ ...p, elevated: false })) };
    expect(validatePoiTable(flat, city, ordersConfig)).toContain(`elevated share 0.00 of reachable POIs is below ${rules.minElevatedShare}`);
  });

  it('validatePoiTable rejects a reachable POI pair with no path between them (the board would throw pricing a Chain)', () => {
    const city = fixture(6, [pad(6), drop(6)]);
    const table = computePoiTable(city, buildCityNavMesh(city, movementConfig));
    expect(validatePoiTable(table, city, ordersConfig).filter((e) => e.startsWith('no path'))).toEqual([]);
    const cut = { ...table, between: table.between.map((row) => [...row]) };
    cut.between[0]![1] = -1; // roof → street missing; street → roof still measured
    expect(validatePoiTable(cut, city, ordersConfig).filter((e) => e.startsWith('no path'))).toEqual(['no path from poi-roof to poi-street']);
  });

  it('validatePoiTable skips pairs with an unreachable POI and caps the no-path messages', () => {
    const n = 14;
    const ids = Array.from({ length: n }, (_, i) => `poi-${i}`);
    const city = { ...fixture(6, []), pois: ids.map((id, i): Poi => ({ id, position: v(i, 0, 0), district: 'downtown', kind: 'door' })) };
    const table = {
      version: 1 as const,
      // poi-13 is unreachable: its own row says so (and the unreachable list), so its −1 pairs are not reported again
      pois: ids.map((id, i) => ({ id, district: 'downtown' as const, elevated: false, fromHub: 10, toHub: 10, reachable: i < n - 1 })),
      // every pair missing in both directions
      between: ids.map((_, i) => ids.map((__, j) => (i === j ? 0 : -1))),
      unreachable: [{ id: 'poi-13', reason: 'no path from the HUB' }],
    };
    const noPath = validatePoiTable(table, city, ordersConfig).filter((e) => e.startsWith('no path') || e.startsWith('…'));
    const pairs = (n - 1) * (n - 2); // 13 reachable POIs, both directions
    expect(noPath).toHaveLength(11);
    expect(noPath.slice(0, 3)).toEqual(['no path from poi-0 to poi-1', 'no path from poi-0 to poi-2', 'no path from poi-0 to poi-3']);
    expect(noPath.some((e) => e.includes('poi-13'))).toBe(false);
    expect(noPath[10]).toBe(`… and ${pairs - 10} more reachable POI pairs with no path`);
  });
});

describe('the committed POI table (map/city.poi.json)', () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const readJson = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), 'utf8'));

  it('lists the committed city POIs, passes validation and has a path between every pair', () => {
    // map:check regenerates and byte-compares it; this catches a stale table without building the navmesh
    const city = readJson('map/city.json') as CityMap;
    const table = parsePoiTable(readJson('map/city.poi.json'));
    expect(validatePoiTable(table, city, ordersConfig)).toEqual([]);
    expect(table.between.flat().filter((d) => d < 0)).toEqual([]);
  });
});
