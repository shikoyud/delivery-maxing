import { describe, expect, it } from 'vitest';
import { ordersConfig } from '../../src/config';
import { generateBoard, type BoardContext } from '../../src/orders/board';
import { navDistanceTable, type DistanceTable } from '../../src/orders/distanceTable';
import type { SelectionContext } from '../../src/orders/selection';
import { mulberry32 } from '../../src/util/rng';
import { vec3, type Vec3 } from '../../src/math/vec3';
import { bandFor, buildPoiInfo, type PoiInfo } from '../../src/world/distance';
import type { District, MapData } from '../../src/world/mapTypes';
import type { PoiTableFile } from '../../src/world/poiTable';
import { emptyMap } from '../world/fixtures';

const bands = ordersConfig.bands.greybox;
const spread = ordersConfig.selection.spreadMeters;

/** POIs at (x, 0, z); `district` alternates downtown/harbor unless given. */
function infos(points: [number, number][], district?: District): PoiInfo[] {
  return points.map(([x, z], i) => ({
    poi: { id: `p${i}`, position: vec3(x, 0, z), district: district ?? (i % 2 ? 'harbor' : 'downtown'), kind: 'door' },
    hubDistance: x,
    band: bandFor(x, bands),
    elevated: false,
  }));
}

// 20 POIs along +x, 50 m apart (beyond the 40 m spread): 3 short, 4 medium, 13 long on the greybox bands.
const pois = infos(Array.from({ length: 20 }, (_, i) => [40 + i * 50, 0]));
const byId = new Map(pois.map((p) => [p.poi.id, p]));
const xOf = (id: string): number => (byId.get(id) as PoiInfo).poi.position.x;
/**
 * A measured-looking table that differs from street distance: the way back is 7 m longer, and A→B costs 3 m more
 * going +x than −x, so a test can tell which direction a route used.
 */
const distances: DistanceTable = {
  fromHub: (id) => xOf(id),
  toHub: (id) => xOf(id) + 7,
  between: (a, b) => Math.abs(xOf(a) - xOf(b)) + (xOf(a) < xOf(b) ? 3 : 0),
};

const noSelection = (over: Partial<SelectionContext> = {}): SelectionContext => ({
  now: 0,
  recentUse: new Map(),
  activePois: [],
  recentDistricts: [],
  ...over,
});

function ctx(seed: number, over: Partial<BoardContext> = {}): BoardContext {
  let n = 0;
  return {
    pois,
    distances,
    selection: noSelection(),
    rng: mulberry32(seed),
    cfg: ordersConfig,
    baseSprintSpeed: 8,
    unlocks: { express: true, chain: true },
    backpackCapacity: 2,
    nextId: () => `o${n++}`,
    ...over,
  };
}
const poiIds = (b: ReturnType<typeof generateBoard>) =>
  b.flatMap((o) => o.steps.flatMap((s) => (s.kind === 'poi' ? [s.poiId] : [])));
const seeds = Array.from({ length: 200 }, (_, i) => i + 1);

describe('generateBoard', () => {
  it('fixture spans all three bands', () => {
    expect(new Set(pois.map((p) => p.band)).size).toBe(3);
  });

  it('returns cfg.board.size (6) orders', () => {
    expect(generateBoard(ctx(1))).toHaveLength(ordersConfig.board.size);
  });

  it('is deterministic for a seed', () => {
    expect(generateBoard(ctx(42))).toEqual(generateBoard(ctx(42)));
    expect(generateBoard(ctx(42))).not.toEqual(generateBoard(ctx(43)));
  });

  it('never repeats a POI on one board', () => {
    for (const s of seeds) {
      const ids = poiIds(generateBoard(ctx(s)));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('no two board POIs are within 40 m', () => {
    // A dense 15 m grid (64 POIs) so the spread rule has to cut.
    const grid = infos(Array.from({ length: 64 }, (_, i) => [(i % 8) * 15, Math.floor(i / 8) * 15]));
    const gridById = new Map(grid.map((p) => [p.poi.id, p.poi.position]));
    const flat: DistanceTable = { fromHub: () => 100, toHub: () => 100, between: () => 50 };
    let cards = 0;
    for (const s of seeds) {
      const board = generateBoard(ctx(s, { pois: grid, distances: flat }));
      cards += board.length;
      const at = poiIds(board).map((id) => gridById.get(id) as Vec3);
      for (let i = 0; i < at.length; i++) {
        for (let j = i + 1; j < at.length; j++) {
          const [a, b] = [at[i] as Vec3, at[j] as Vec3];
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(spread);
        }
      }
    }
    expect(cards).toBeGreaterThan(seeds.length); // boards are not trivially empty
  });

  it('offers no heavy at capacity 1, and offers heavy at capacity 2 (over 200 seeded boards)', () => {
    const at = (cap: number) => seeds.flatMap((s) => generateBoard(ctx(s, { backpackCapacity: cap })));
    expect(at(1).some((o) => o.modifier === 'heavy')).toBe(false);
    const two = at(2).filter((o) => o.modifier === 'heavy');
    expect(two.length).toBeGreaterThan(0);
    expect(two.every((o) => o.slots === 2)).toBe(true);
  });

  it('offers no express or chain when locked', () => {
    const all = seeds.flatMap((s) => generateBoard(ctx(s, { unlocks: { express: false, chain: false } })));
    expect(all.some((o) => o.modifier === 'express' || o.expressLimit !== null)).toBe(false);
    expect(all.some((o) => o.type === 'chain')).toBe(false);
    const open = seeds.flatMap((s) => generateBoard(ctx(s)));
    expect(open.some((o) => o.modifier === 'express')).toBe(true);
    expect(open.some((o) => o.type === 'chain')).toBe(true);
  });

  it('chain orders use two different POIs and have no modifier', () => {
    const chains = seeds.flatMap((s) => generateBoard(ctx(s))).filter((o) => o.type === 'chain');
    expect(chains.length).toBeGreaterThan(0);
    for (const o of chains) {
      const ids = poiIds([o]);
      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toBe(ids[1]);
      expect(o.steps[2]).toEqual({ kind: 'hub' });
      expect(o.modifier).toBeNull();
      expect(o.band).toBeNull();
      expect(o.slots).toBe(1);
      expect(o.hubDistance).toBe((byId.get(ids[0] as string) as PoiInfo).hubDistance);
    }
  });

  it('pickup route = fromHub + toHub; chain route = fromHub(A) + between(A,B) + toHub(B)', () => {
    const all = seeds.flatMap((s) => generateBoard(ctx(s)));
    const types = new Set(all.map((o) => o.type));
    expect(types).toEqual(new Set(['dropoff', 'pickup', 'chain']));
    for (const o of all) {
      const [a, b] = poiIds([o]) as [string, string];
      const expected =
        o.type === 'dropoff'
          ? distances.fromHub(a)
          : o.type === 'pickup'
            ? distances.fromHub(a) + distances.toHub(a)
            : distances.fromHub(a) + distances.between(a, b) + distances.toHub(b);
      expect(o.routeDistance, o.type).toBe(expected);
    }
  });

  it('chain is weighted 4 (spec §5.3: higher than SP1): about 4/13 of the cards on open boards', () => {
    const all = seeds.flatMap((s) => generateBoard(ctx(s)));
    const share = all.filter((o) => o.type === 'chain').length / all.length;
    const tw = ordersConfig.mix.typeWeights;
    expect(share).toBeGreaterThan(0.8 * (tw.chain / (tw.dropoff + tw.pickup + tw.chain)));
    expect(share).toBeLessThan(1.2 * (tw.chain / (tw.dropoff + tw.pickup + tw.chain)));
  });

  it('carries at most one modifier per order', () => {
    for (const o of seeds.flatMap((s) => generateBoard(ctx(s)))) {
      expect([null, 'express', 'fragile', 'heavy']).toContain(o.modifier);
      expect(o.expressLimit !== null).toBe(o.modifier === 'express');
    }
  });

  it('drop-off/pick-up band equals the POI band (one-way fromHub); the express timer follows the route', () => {
    for (const o of seeds.flatMap((s) => generateBoard(ctx(s))).filter((x) => x.type !== 'chain')) {
      const first = o.steps[0];
      const info = pois.find((p) => first?.kind === 'poi' && p.poi.id === first.poiId) as PoiInfo;
      expect(o.band).toBe(info.band);
      expect(o.hubDistance).toBe(info.hubDistance);
      if (o.modifier === 'express') {
        expect(o.expressLimit).toBe(
          (ordersConfig.express.distanceFactor * o.routeDistance) / 8 + ordersConfig.express.extraSeconds,
        );
      }
    }
  });

  it('every order, chain included, carries parLimit from its route distance', () => {
    const all = seeds.flatMap((s) => generateBoard(ctx(s)));
    expect(all.some((o) => o.type === 'chain')).toBe(true);
    for (const o of all) {
      expect(o.parLimit).toBe((ordersConfig.par.distanceFactor * o.routeDistance) / 8 + ordersConfig.par.extraSeconds);
    }
  });

  it('stops early when POIs run out', () => {
    const board = generateBoard(ctx(5, { pois: pois.slice(0, 3) }));
    expect(board.length).toBeLessThanOrEqual(3);
    expect(board.length).toBeGreaterThan(0);
  });

  it('bands use city limits 500/1200 with a nav table', () => {
    const map: MapData = emptyMap();
    const from = [499, 500, 1200, 1201];
    map.pois = from.map((_, i) => ({ id: `c${i}`, position: vec3(i * 100, 0, 0), district: 'harbor', kind: 'door', elevated: i === 1 }));
    const file: PoiTableFile = {
      version: 1,
      pois: from.map((d, i) => ({ id: `c${i}`, district: 'harbor', elevated: i === 1, fromHub: d, toHub: d + 10, reachable: true })),
      between: from.map((_, i) => from.map((__, j) => (i === j ? 0 : 100))),
      unreachable: [],
    };
    const table = navDistanceTable(file);
    const city = buildPoiInfo(map, table, ordersConfig.bands.city);
    expect(city.map((p) => [p.poi.id, p.hubDistance, p.band, p.elevated])).toEqual([
      ['c0', 499, 'short', false], ['c1', 500, 'medium', true], ['c2', 1200, 'medium', false], ['c3', 1201, 'long', false],
    ]);
    const orders = seeds.flatMap((s) =>
      generateBoard(ctx(s, { pois: city, distances: table, unlocks: { express: true, chain: false } })),
    );
    expect(new Set(orders.map((o) => o.band))).toEqual(new Set(['short', 'medium', 'long']));
    for (const o of orders) {
      const [id] = poiIds([o]) as [string];
      expect(o.band).toBe(bandFor(table.fromHub(id), ordersConfig.bands.city));
      expect(o.routeDistance).toBe(o.type === 'pickup' ? 2 * table.fromHub(id) + 10 : table.fromHub(id));
    }
  });

  it('Review Focus 3: with 8 POIs all within 40 m of an active order, the board is empty and generate() returns []', () => {
    const ring = infos(Array.from({ length: 8 }, (_, i) => [Math.cos(i) * 39, Math.sin(i) * 39]));
    for (const s of seeds) {
      expect(generateBoard(ctx(s, { pois: ring, selection: noSelection({ activePois: [vec3(0, 0, 0)] }) }))).toEqual([]);
    }
  });

  it('recently accepted POIs are not offered within reuseSeconds', () => {
    const recentUse = new Map(pois.slice(0, 15).map((p) => [p.poi.id, 10]));
    for (const s of seeds) {
      const ids = poiIds(generateBoard(ctx(s, { selection: noSelection({ now: 100, recentUse }) })));
      expect(ids.every((id) => !recentUse.has(id))).toBe(true);
    }
  });

  it('district balance: a district sent to in all of the last 6 is offered about 1/7 as often', () => {
    const recentDistricts: District[] = Array.from({ length: 6 }, () => 'harbor');
    const count = { harbor: 0, downtown: 0 } as Record<District, number>;
    for (const s of seeds) {
      const board = generateBoard(ctx(s, { selection: noSelection({ recentDistricts }), unlocks: { express: true, chain: false } }));
      for (const id of poiIds(board)) count[(byId.get(id) as PoiInfo).poi.district]++;
    }
    // 10 harbor and 10 downtown POIs; 6 picks per board from 20 without replacement dampens the 7:1 weight ratio.
    expect(count.harbor).toBeGreaterThan(0);
    expect(count.harbor * 3).toBeLessThan(count.downtown);
  });

  it('a chain whose second POI would break the spread becomes a single order (never throws)', () => {
    const pair = infos([[100, 0], [110, 0]]);
    const chainy = { ...ordersConfig, mix: { ...ordersConfig.mix, typeWeights: { dropoff: 1, pickup: 0, chain: 1000 } } };
    for (const s of seeds) {
      const board = generateBoard(ctx(s, { pois: pair, cfg: chainy, distances: { fromHub: () => 1, toHub: () => 1, between: () => 1 } }));
      expect(board.map((o) => o.type)).toEqual(['dropoff']);
    }
  });
});
