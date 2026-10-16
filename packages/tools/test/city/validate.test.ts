import { afterAll, beforeAll, expect, test } from 'vitest';
import { cityConfig, initNav, NAV_TIERS, switchbackGeometry, navConfig, NavRouter, vec3, type CityMap, type Lot, type NavConfig, type VehicleTier } from '@dm/shared';
import { exportNavMesh } from 'recast-navigation';
import { readCatalog, readLayout } from '../../src/city/files';
import { areaSampleRects, validateCityNav, validateLayout } from '../../src/city/validate';
import { buildTierNavMesh, readCityMap } from '../../src/nav/build';
import { REPO } from '../../src/nav/files';

const cat = readCatalog(REPO);
const layout = readLayout(REPO);
const routers: NavRouter[] = [];

beforeAll(initNav);
afterAll(() => routers.forEach((r) => r.destroy()));

const shifted = (lot: Lot, id: string, dx: number): Lot => ({
  ...lot,
  id,
  rect: { ...lot.rect, minX: lot.rect.minX + dx, maxX: lot.rect.maxX + dx },
  door: null,
  upperDoor: null,
});

test('the committed layout has no problems', () => {
  expect(validateLayout(layout, cat)).toEqual([]);
});

test('two overlapping lots are reported with both ids', () => {
  const a = layout.lots.find((l) => !l.open && !l.prop)!;
  const messages = validateLayout({ ...layout, lots: [...layout.lots, shifted(a, 'test-overlap', 1)] }, cat);
  expect(messages.some((m) => m.includes(a.id) && m.includes('test-overlap'))).toBe(true);
});

test('a lot on a road, a lot off its level, a door off the sidewalk, an unknown asset and a duplicate id are reported', () => {
  const road = layout.roads.find((r) => r.kind === 'avenue')!;
  const base = layout.lots.find((l) => !l.open && !l.prop && l.door && !l.upperDoor)!;
  const onRoad: Lot = { ...base, id: 'test-on-road', rect: { minX: road.rect.minX + 1, maxX: road.rect.minX + 5, minZ: road.rect.minZ + 1, maxZ: road.rect.minZ + 5 }, y: road.y, door: null };
  const offLevel: Lot = { ...shifted(base, 'test-off-level', 0), y: base.y + 7 };
  const lostDoor: Lot = { ...base, door: vec3(base.door!.x + 30, base.door!.y, base.door!.z) };
  const unknown: Lot = { ...base, id: 'test-unknown', asset: 'mega/No_Such_Model_99', rect: { minX: -50, maxX: -45, minZ: -50, maxZ: -45 }, door: null };
  const others = layout.lots.filter((l) => l.id !== base.id);
  const messages = validateLayout(
    { ...layout, lots: [...others, lostDoor, onRoad, unknown], areas: [...layout.areas, { ...layout.areas[0]! }] },
    cat,
  );
  const has = (...parts: string[]) => messages.some((m) => parts.every((p) => m.includes(p)));
  expect(has('test-on-road', road.id), 'on road').toBe(true);
  expect(has(base.id, 'door'), 'door').toBe(true);
  expect(has('test-unknown', 'mega/No_Such_Model_99'), 'asset').toBe(true);
  expect(has(layout.areas[0]!.id, 'duplicate'), 'duplicate').toBe(true);
  const off = validateLayout({ ...layout, lots: [...others, offLevel] }, cat);
  expect(off.some((m) => m.includes('test-off-level') && m.includes('level')), off.join('\n')).toBe(true);
});

/** A 100 m square of ground with a 6 × 20 m stairs zone in the middle and nothing else. */
function stairsFixture(): CityMap {
  return {
    kind: 'city',
    layout: { ...layout, blocks: [], lots: [], roads: [], curvedRoads: [], connectors: [], areas: [], hospitals: [], gasStations: [] },
    chunkSize: 100,
    size: 100,
    solids: [{ id: 'ground', kind: 'ground', center: vec3(0, -0.5, 0), size: vec3(100, 1, 100) }],
    pois: [],
    hospitals: [],
    accessZones: [{ id: 'zone-test-stairs', kind: 'stairs', rect: { minX: -3, maxX: 3, minZ: -10, maxZ: 10 }, minY: 0, maxY: 0 }],
    gasStations: [],
    orderRules: layout.orderRules,
  };
}

function routerFor(map: CityMap, nav: NavConfig = navConfig): NavRouter {
  const bins = {} as Record<VehicleTier, Uint8Array>;
  for (const t of NAV_TIERS) {
    const mesh = buildTierNavMesh(map, t, nav);
    bins[t] = exportNavMesh(mesh);
    mesh.destroy();
  }
  const r = NavRouter.fromBinaries(bins);
  routers.push(r);
  return r;
}

test('validateCityNav reports a car polygon under a stairs zone, and not when the zone is blocked', () => {
  const map = stairsFixture();
  const leaky = routerFor({ ...map, accessZones: [] }); // built as if the stairs were a road
  const messages = validateCityNav(map, leaky);
  expect(messages.some((m) => m.includes('zone-test-stairs') && m.includes('car')), messages.join('\n')).toBe(true);
  // walk may use the stairs; no other tier is reported for them
  expect(messages.some((m) => m.includes('zone-test-stairs') && m.includes('walk'))).toBe(false);
  const sound = validateCityNav(map, routerFor(map));
  expect(sound.filter((m) => m.includes('zone-test-stairs'))).toEqual([]);
}, 60_000);

/** The stairs fixture's ground with a sand area and a band-gap area on it (no connector: the gap is all floor). */
function areasFixture(): CityMap {
  const map = stairsFixture();
  return {
    ...map,
    accessZones: [],
    layout: {
      ...map.layout,
      areas: [
        { id: 'area-test-sand', kind: 'sand', rect: { minX: -40, maxX: -20, minZ: -10, maxZ: 10 }, y: 0, district: 'beach' },
        { id: 'area-test-gap', kind: 'bandGap', rect: { minX: 20, maxX: 40, minZ: -10, maxZ: 10 }, y: 0, district: 'slope' },
      ],
    },
  };
}

test('validateCityNav reports car polygons on an unblocked sand or band-gap floor, and none once they are blocked', () => {
  const map = areasFixture();
  const leaky = routerFor(map, { ...navConfig, forbiddenAreasByTier: { ...navConfig.forbiddenAreasByTier, car: [] } });
  const messages = validateCityNav(map, leaky);
  for (const id of ['area-test-sand', 'area-test-gap']) {
    expect(messages.some((m) => m.includes(id) && m.includes('car')), `${id}: ${messages.join('\n')}`).toBe(true);
  }
  const sound = validateCityNav(map, routerFor(map));
  expect(sound.filter((m) => m.includes('area-test'))).toEqual([]);
}, 60_000);

test('the validator samples the whole band-gap floor, under every switchback deck, leaving out only the deck on the floor', () => {
  const city = readCityMap(REPO);
  const rects = areaSampleRects(city, 'car');
  const covered = (x: number, z: number, y: number) =>
    rects.some((r) => Math.abs(r.y - y) < 1e-6 && x > r.rect.minX && x < r.rect.maxX && z > r.rect.minZ && z < r.rect.maxZ);
  for (const c of city.layout.connectors.filter((k) => k.kind === 'switchback')) {
    const g = switchbackGeometry(c, cityConfig.switchback);
    const [za, zb] = g.legZ;
    const xe = g.xs + g.run;
    expect(covered((xe + g.xEast) / 2, (za + zb) / 2, c.y0), `${c.id} under the hairpin`).toBe(true);
    expect(covered((g.xs + xe) / 2, zb, c.y0), `${c.id} under leg 2`).toBe(true);
    expect(covered(xe - 5, za, c.y0), `${c.id} under leg 1`).toBe(true);
    expect(covered(c.x, (zb + c.z1) / 2, c.y0), `${c.id} under the exit`).toBe(true);
    expect(covered(c.x, c.z0 + 1, c.y0), `${c.id} entry stub`).toBe(false);
  }
});
