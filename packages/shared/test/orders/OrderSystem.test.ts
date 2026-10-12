import { describe, expect, it } from 'vitest';
import { ordersConfig } from '../../src/config';
import { OrderSystem } from '../../src/orders/OrderSystem';
import type { Order } from '../../src/orders/types';
import { mulberry32 } from '../../src/util/rng';
import { vec3 } from '../../src/math/vec3';
import { bandFor, streetDistance, type PoiInfo } from '../../src/world/distance';
import type { PlayerZones } from '../../src/world/zones';

const cfg = ordersConfig;
const pois: PoiInfo[] = Array.from({ length: 20 }, (_, i) => {
  const d = 40 + i * 25;
  return {
    poi: { id: `p${i}`, position: vec3(d, 0, 0), district: 'downtown', kind: 'door' },
    hubDistance: d,
    band: bandFor(d, cfg.bands),
  };
});

function make(seed: number, capacity = 1, now = 0, totals?: { points: number; coins: number; deliveries: number }) {
  return new OrderSystem(
    {
      pois,
      distance: streetDistance,
      hub: vec3(0, 0, 0),
      cfg,
      baseSprintSpeed: 8,
      rng: mulberry32(seed),
      unlocks: { express: true, chain: true },
      backpackCapacity: capacity,
      ...(totals ? { totals } : {}),
    },
    now,
  );
}

const zones = (over: { plaza?: boolean; drop?: boolean; pois?: string[] } = {}): PlayerZones => ({
  inPlaza: over.plaza ?? false,
  inDropZone: over.drop ?? false,
  poiIds: new Set(over.pois ?? []),
});
const OUT = zones();
const poiOf = (o: Order, i = 0): string => {
  const s = o.steps[i];
  if (!s || s.kind !== 'poi') throw new Error('not a poi step');
  return s.poiId;
};

function find(pred: (o: Order, board: ReadonlyArray<Order | null>) => boolean, capacity = 1) {
  for (let seed = 1; seed < 2000; seed++) {
    const sys = make(seed, capacity);
    const order = sys.board.find((o): o is Order => o !== null && pred(o, sys.board));
    if (order) return { sys, order };
  }
  throw new Error('no board found');
}
const dropoff = (m: Order['modifier'] | 'any' = null) =>
  find((o) => o.type === 'dropoff' && (m === 'any' || o.modifier === m));
const pickup = (m: Order['modifier'] = null) => find((o) => o.type === 'pickup' && o.modifier === m);

describe('OrderSystem', () => {
  it('starts with a full board, empty active list, zero totals', () => {
    const sys = make(1, 1, 5);
    expect(sys.board).toHaveLength(cfg.board.size);
    expect(sys.active).toHaveLength(0);
    expect(sys.totals).toEqual({ points: 0, coins: 0, deliveries: 0 });
    expect(sys.nextRefreshAt).toBe(5 + cfg.board.refreshSeconds);
    expect(make(1, 1, 0, { points: 3, coins: 30, deliveries: 2 }).totals).toEqual({ points: 3, coins: 30, deliveries: 2 });
  });

  it('accept outside the HUB plaza → not_in_hub', () => {
    const { sys, order } = dropoff();
    expect(sys.canAccept(order.id, 0, false)).toBe('not_in_hub');
    expect(sys.accept(order.id, 0, false)).toBe('not_in_hub');
    expect(sys.active).toHaveLength(0);
    expect(sys.board.find((o) => o?.id === order.id)).toBeDefined();
  });

  it('accept without enough free slots → no_slots (second order at capacity 1; Heavy at 1 free slot)', () => {
    const { sys, order } = dropoff('any');
    expect(sys.accept(order.id, 0, true)).toBe('ok');
    const other = sys.board.find((o): o is Order => o !== null);
    if (!other) throw new Error('board empty');
    expect(sys.accept(other.id, 0, true)).toBe('no_slots');
    expect(sys.active).toHaveLength(1);

    const heavy = find((o, b) => o.modifier === 'heavy' && b.some((x) => x && x.slots === 1 && x.id !== o.id), 2);
    expect(heavy.order.slots).toBe(cfg.heavy.slots);
    const light = heavy.sys.board.find((o): o is Order => o !== null && o.slots === 1);
    if (!light) throw new Error('no light order');
    expect(heavy.sys.accept(light.id, 0, true)).toBe('ok');
    expect(heavy.sys.freeSlots()).toBe(1);
    expect(heavy.sys.canAccept(heavy.order.id, 0, true)).toBe('no_slots');
    expect(heavy.sys.accept(heavy.order.id, 0, true)).toBe('no_slots');
    expect(heavy.sys.usedSlots()).toBe(1);
  });

  it('an accepted order leaves its slot null until the 60 s refresh, which replaces all 6 slots', () => {
    const { sys, order } = dropoff();
    const before = sys.board.map((o) => o?.id);
    const idx = before.indexOf(order.id);
    sys.accept(order.id, 1, true);
    expect(sys.board[idx]).toBeNull();
    expect(sys.board.filter((o) => o === null)).toHaveLength(1);
    expect(sys.update(59.9, OUT)).toEqual([]);
    expect(sys.board[idx]).toBeNull();
    const events = sys.update(60, OUT);
    expect(events).toContainEqual({ kind: 'boardRefreshed' });
    expect(sys.board).toHaveLength(cfg.board.size);
    expect(sys.board.every((o) => o !== null)).toBe(true);
    const after = new Set(sys.board.map((o) => o?.id));
    expect(before.some((id) => id && after.has(id))).toBe(false);
    expect(sys.nextRefreshAt).toBe(120);
    expect(sys.active).toHaveLength(1);
  });

  it('accepting an id that a refresh replaced → gone (Review Focus 3)', () => {
    const { sys, order } = dropoff();
    sys.update(60, OUT);
    expect(sys.canAccept(order.id, 60, true)).toBe('gone');
    expect(sys.accept(order.id, 60, true)).toBe('gone');
    expect(sys.active).toHaveLength(0);
    expect(sys.canAccept('nope', 60, false)).toBe('gone'); // gone outranks not_in_hub
  });

  it('cancel only in the plaza; it starts a 30 s cooldown; accept during cooldown → cooldown; at +30 s → ok', () => {
    const { sys, order } = dropoff('any');
    sys.accept(order.id, 0, true);
    expect(sys.cancel(order.id, 10, false)).toBe('not_in_hub');
    expect(sys.active).toHaveLength(1);
    expect(sys.cancel('nope', 10, true)).toBe('unknown');
    expect(sys.cancel(order.id, 10, true)).toBe('ok');
    expect(sys.cancelCooldownUntil).toBe(10 + cfg.board.cancelCooldownSeconds);
    const next = sys.board.find((o): o is Order => o !== null);
    if (!next) throw new Error('board empty');
    expect(sys.canAccept(next.id, 39.9, true)).toBe('cooldown');
    expect(sys.accept(next.id, 39.9, true)).toBe('cooldown');
    expect(sys.accept(next.id, 40, true)).toBe('ok');
  });

  it('cancelling frees the slots', () => {
    const { sys, order } = dropoff('any');
    sys.accept(order.id, 0, true);
    expect(sys.freeSlots()).toBe(0);
    sys.cancel(order.id, 1, true);
    expect(sys.usedSlots()).toBe(0);
    expect(sys.freeSlots()).toBe(1);
    expect(sys.active).toHaveLength(0);
  });

  it('a drop-off completes on entering its POI zone; totals add its points and coins; deliveries + 1', () => {
    const { sys, order } = dropoff();
    sys.accept(order.id, 0, true);
    expect(sys.update(1, zones({ plaza: true }))).toEqual([]);
    const key = order.band as 'short' | 'medium' | 'long';
    const events = sys.update(2, zones({ pois: [poiOf(order)] }));
    expect(events).toContainEqual({
      kind: 'completed', orderId: order.id, points: cfg.points[key] + cfg.points.withinPar, coins: cfg.coins[key] + cfg.coins.withinPar,
      bonuses: ['par'], onTime: null, withinPar: true,
    });
    expect(sys.totals).toEqual({ points: cfg.points[key] + cfg.points.withinPar, coins: cfg.coins[key] + cfg.coins.withinPar, deliveries: 1 });
    expect(sys.active).toHaveLength(0);
    expect(sys.freeSlots()).toBe(1);
  });

  it('pick-up: the POI collects (stepReached); the plaza does not complete it; the drop zone does', () => {
    const { sys, order } = pickup();
    sys.accept(order.id, 0, true);
    const a = sys.active[0] as NonNullable<(typeof sys.active)[0]>;
    expect(sys.isCarried(a)).toBe(false);
    expect(sys.update(1, zones({ plaza: true }))).toEqual([]);
    const ev = sys.update(2, zones({ pois: [poiOf(order)] }));
    expect(ev).toEqual([{ kind: 'stepReached', orderId: order.id, stepIndex: 1, step: { kind: 'hub' } }]);
    expect(sys.isCarried(sys.active[0] as NonNullable<(typeof sys.active)[0]>)).toBe(true);
    expect(sys.currentStep(sys.active[0] as NonNullable<(typeof sys.active)[0]>)).toEqual({ kind: 'hub' });
    expect(sys.update(3, zones({ plaza: true }))).toEqual([]);
    expect(sys.active).toHaveLength(1);
    const done = sys.update(4, zones({ plaza: true, drop: true }));
    expect(done.map((e) => e.kind)).toEqual(['completed']);
    expect(sys.totals.deliveries).toBe(1);
  });

  it('chain: B before A does nothing; A → B → drop zone completes with 4 pts / 40 coins plus par', () => {
    const { sys, order } = find((o) => o.type === 'chain');
    sys.accept(order.id, 0, true);
    expect(sys.update(1, zones({ pois: [poiOf(order, 1)] }))).toEqual([]);
    expect(sys.active[0]?.stepIndex).toBe(0);
    expect(sys.update(2, zones({ pois: [poiOf(order, 0)] })).map((e) => e.kind)).toEqual(['stepReached']);
    expect(sys.update(3, zones({ pois: [poiOf(order, 1)] })).map((e) => e.kind)).toEqual(['stepReached']);
    expect(sys.update(4, zones({ plaza: true }))).toEqual([]);
    const done = sys.update(5, zones({ plaza: true, drop: true }));
    expect(done).toContainEqual(expect.objectContaining({ kind: 'completed', points: 5, coins: 50, bonuses: ['par'], withinPar: true }));
    expect(sys.totals).toEqual({ points: 5, coins: 50, deliveries: 1 });
  });

  it('express: on time earns +1; late still completes without it', () => {
    const on = dropoff('express');
    const limit = on.order.expressLimit as number;
    on.sys.accept(on.order.id, 100, true);
    const ev = on.sys.update(100 + limit, zones({ pois: [poiOf(on.order)] }));
    const key = on.order.band as 'short' | 'medium' | 'long';
    expect(ev).toContainEqual(expect.objectContaining({
      kind: 'completed', onTime: true, bonuses: ['express'], points: cfg.points[key] + cfg.points.expressOnTime,
    }));

    const late = dropoff('express');
    late.sys.accept(late.order.id, 0, true);
    const ev2 = late.sys.update(0.001 + (late.order.expressLimit as number), zones({ pois: [poiOf(late.order)] }));
    expect(ev2).toContainEqual(expect.objectContaining({ kind: 'completed', onTime: false, withinPar: false, bonuses: [] }));
    expect(late.sys.totals.deliveries).toBe(1);
  });

  it('completed reports withinPar from sim time since accept (par inclusive, hidden-tab pause safe)', () => {
    const a = dropoff('any');
    const limit = a.order.parLimit;
    expect(limit).toBe((cfg.par.distanceFactor * a.order.routeDistance) / 8 + cfg.par.extraSeconds);
    a.sys.accept(a.order.id, 100, true);
    const ev = a.sys.update(100 + limit, zones({ pois: [poiOf(a.order)] }));
    expect(ev).toContainEqual(expect.objectContaining({ kind: 'completed', withinPar: true }));

    const b = dropoff('any');
    b.sys.accept(b.order.id, 0, true);
    const ev2 = b.sys.update(b.order.parLimit + 0.001, zones({ pois: [poiOf(b.order)] }));
    expect(ev2).toContainEqual(expect.objectContaining({ kind: 'completed', withinPar: false }));
    expect(b.sys.totals.deliveries).toBe(1);
  });

  it('par stacks with the modifier bonus: fragile intact within par is +2 and +1', () => {
    const d = dropoff('fragile');
    d.sys.accept(d.order.id, 0, true);
    const ev = d.sys.update(1, zones({ pois: [poiOf(d.order)] }));
    const key = d.order.band as 'short' | 'medium' | 'long';
    expect(ev).toContainEqual(expect.objectContaining({
      kind: 'completed', bonuses: ['fragile', 'par'], points: cfg.points[key] + 2 + 1, coins: cfg.coins[key] + 20 + 10,
    }));
  });

  it('fragile: a 7.5 m fall while carried breaks it; 7.0 m does not; falls before pick-up collection do not count', () => {
    const d = dropoff('fragile');
    d.sys.accept(d.order.id, 0, true);
    expect(d.sys.onSimEvents([{ kind: 'landed', fallHeight: cfg.fragile.maxFallMeters }])).toEqual([]);
    expect(d.sys.onSimEvents([{ kind: 'landed', fallHeight: 7.0 }])).toEqual([]);
    expect(d.sys.active[0]?.fragileIntact).toBe(true);
    expect(d.sys.onSimEvents([{ kind: 'landed', fallHeight: 7.5 }])).toEqual([
      { kind: 'fragileBroken', orderId: d.order.id, reason: 'fall' },
    ]);
    expect(d.sys.active[0]?.fragileIntact).toBe(false);
    expect(d.sys.onSimEvents([{ kind: 'landed', fallHeight: 9 }])).toEqual([]); // already broken
    const ev = d.sys.update(1, zones({ pois: [poiOf(d.order)] }));
    expect(ev).toContainEqual(expect.objectContaining({ kind: 'completed', bonuses: ['par'] }));

    const p = pickup('fragile');
    p.sys.accept(p.order.id, 0, true);
    expect(p.sys.onSimEvents([{ kind: 'landed', fallHeight: 20 }])).toEqual([]);
    expect(p.sys.active[0]?.fragileIntact).toBe(true);
    p.sys.update(1, zones({ pois: [poiOf(p.order)] }));
    expect(p.sys.onSimEvents([{ kind: 'landed', fallHeight: 7.0 }])).toEqual([]);
    expect(p.sys.onSimEvents([{ kind: 'landed', fallHeight: 7.5 }]).map((e) => e.kind)).toEqual(['fragileBroken']);
    const done = p.sys.update(2, zones({ drop: true, plaza: true }));
    expect(done).toContainEqual(expect.objectContaining({ kind: 'completed', bonuses: ['par'] }));
  });

  it('fragile: respawn while carried breaks it', () => {
    const d = dropoff('fragile');
    d.sys.accept(d.order.id, 0, true);
    expect(d.sys.onSimEvents([{ kind: 'respawned', checkpointId: 'c1' }])).toEqual([
      { kind: 'fragileBroken', orderId: d.order.id, reason: 'respawn' },
    ]);
    const p = pickup('fragile');
    p.sys.accept(p.order.id, 0, true);
    expect(p.sys.onSimEvents([{ kind: 'respawned', checkpointId: 'c1' }])).toEqual([]);
    expect(p.sys.active[0]?.fragileIntact).toBe(true);
  });

  it('non-fragile orders ignore falls and respawns', () => {
    const d = dropoff();
    d.sys.accept(d.order.id, 0, true);
    expect(d.sys.onSimEvents([{ kind: 'landed', fallHeight: 50 }, { kind: 'respawned', checkpointId: 'c' }])).toEqual([]);
  });

  it('heavy: statModifiers().jumpHeightMul is 0.9 only while a Heavy package is carried', () => {
    const d = find((o) => o.type === 'dropoff' && o.modifier === 'heavy', 2);
    expect(d.sys.statModifiers().jumpHeightMul).toBe(1);
    d.sys.accept(d.order.id, 0, true);
    expect(d.sys.statModifiers().jumpHeightMul).toBe(cfg.heavy.jumpHeightMultiplier);
    expect(d.sys.statModifiers().jumpHeightMul).toBe(0.9);
    d.sys.update(1, zones({ pois: [poiOf(d.order)] }));
    expect(d.sys.statModifiers().jumpHeightMul).toBe(1);

    const p = find((o) => o.type === 'pickup' && o.modifier === 'heavy', 2);
    p.sys.accept(p.order.id, 0, true);
    expect(p.sys.statModifiers().jumpHeightMul).toBe(1); // not yet collected
    p.sys.update(1, zones({ pois: [poiOf(p.order)] }));
    expect(p.sys.statModifiers().jumpHeightMul).toBe(0.9);
    p.sys.update(2, zones({ drop: true }));
    expect(p.sys.statModifiers().jumpHeightMul).toBe(1);
  });

  it('setBackpackCapacity changes free slots', () => {
    const sys = make(1, 1);
    sys.setBackpackCapacity(3);
    expect(sys.backpackCapacity).toBe(3);
    expect(sys.freeSlots()).toBe(3);
  });

  it('R29c: refreshBoard regenerates now (new capacity applies), resets the timer and reports boardRefreshed', () => {
    // Capacity 1 never offers Heavy; after raising capacity a refresh can (seeded: find one that does).
    let found = false;
    for (let seed = 1; seed <= 200 && !found; seed++) {
      const sys = make(seed, 1);
      expect(sys.board.some((o) => o?.modifier === 'heavy')).toBe(false);
      const before = new Set(sys.board.map((o) => o?.id));
      sys.setBackpackCapacity(cfg.backpack.maxSlots);
      const events = sys.refreshBoard(25);
      expect(events).toEqual([{ kind: 'boardRefreshed' }]);
      expect(sys.nextRefreshAt).toBe(25 + cfg.board.refreshSeconds);
      expect(sys.board).toHaveLength(cfg.board.size);
      expect(sys.board.some((o) => o && before.has(o.id))).toBe(false);
      expect(sys.update(25 + cfg.board.refreshSeconds - 0.1, OUT)).toEqual([]);
      found = sys.board.some((o) => o?.modifier === 'heavy');
    }
    expect(found).toBe(true);
  });
});
