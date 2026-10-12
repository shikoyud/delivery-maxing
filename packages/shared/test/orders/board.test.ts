import { describe, expect, it } from 'vitest';
import { ordersConfig } from '../../src/config';
import { generateBoard, type BoardContext } from '../../src/orders/board';
import { mulberry32 } from '../../src/util/rng';
import { vec3 } from '../../src/math/vec3';
import { bandFor, streetDistance, type PoiInfo } from '../../src/world/distance';

const hub = vec3(0, 0, 0);
const bands = ordersConfig.bands;
// 20 POIs along +x: 7 short, 7 medium, 6 long.
const pois: PoiInfo[] = Array.from({ length: 20 }, (_, i) => {
  const d = 40 + i * 25;
  return {
    poi: { id: `p${i}`, position: vec3(d, 0, 0), district: 'downtown', kind: 'door' },
    hubDistance: d,
    band: bandFor(d, bands),
  };
});

function ctx(seed: number, over: Partial<BoardContext> = {}): BoardContext {
  let n = 0;
  return {
    pois,
    distance: streetDistance,
    hub,
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
      const [a, b] = ids.map((id) => pois.find((p) => p.poi.id === id) as PoiInfo);
      expect(o.hubDistance).toBe((a as PoiInfo).hubDistance);
      expect(o.routeDistance).toBe(
        streetDistance(hub, (a as PoiInfo).poi.position) +
          streetDistance((a as PoiInfo).poi.position, (b as PoiInfo).poi.position) +
          streetDistance((b as PoiInfo).poi.position, hub),
      );
    }
  });

  it('carries at most one modifier per order', () => {
    for (const o of seeds.flatMap((s) => generateBoard(ctx(s)))) {
      expect([null, 'express', 'fragile', 'heavy']).toContain(o.modifier);
      expect(o.expressLimit !== null).toBe(o.modifier === 'express');
    }
  });

  it('drop-off/pick-up band equals the POI band; route distance and express timer follow', () => {
    for (const o of seeds.flatMap((s) => generateBoard(ctx(s))).filter((x) => x.type !== 'chain')) {
      const first = o.steps[0];
      const info = pois.find((p) => first?.kind === 'poi' && p.poi.id === first.poiId) as PoiInfo;
      expect(o.band).toBe(info.band);
      expect(o.hubDistance).toBe(info.hubDistance);
      expect(o.routeDistance).toBe(o.type === 'pickup' ? 2 * info.hubDistance : info.hubDistance);
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
});
