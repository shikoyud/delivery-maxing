import { describe, expect, it } from 'vitest';
import {
  OrderSystem,
  buildPoiTable,
  expandGreybox,
  movementConfig,
  mulberry32,
  orderSteps,
  ordersConfig,
  streetDistance,
  vec3,
  type GreyboxSource,
  type MapData,
  type Modifier,
  type Order,
  type OrderType,
  type PlayerZones,
} from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { hudModel, poiLabel } from '../src/ui/hudModel';

const map: MapData = expandGreybox(greybox as GreyboxSource);
const [poiA, poiB] = map.pois as [MapData['pois'][number], MapData['pois'][number]];

function system(capacity = 3): OrderSystem {
  return new OrderSystem(
    {
      pois: buildPoiTable(map, streetDistance, ordersConfig.bands),
      distance: streetDistance,
      hub: map.hub.center,
      cfg: ordersConfig,
      baseSprintSpeed: movementConfig.run.sprintSpeed,
      rng: mulberry32(1),
      unlocks: { express: true, chain: true },
      backpackCapacity: capacity,
    },
    0,
  );
}

function order(id: string, type: OrderType, poiIds: string[], modifier: Modifier | null = null, expressLimit: number | null = null): Order {
  return {
    id,
    type,
    modifier,
    steps: orderSteps(type, poiIds),
    band: type === 'chain' ? null : 'short',
    hubDistance: 100,
    routeDistance: type === 'pickup' ? 200 : 100,
    slots: 1,
    expressLimit,
    parLimit: 60,
  };
}

/** Puts `o` on the board and accepts it at `now` from inside the plaza. */
function acceptOrder(s: OrderSystem, o: Order, now = 0): void {
  s.board = [o];
  expect(s.accept(o.id, now, true)).toBe('ok');
}

const zones = (poiIds: string[] = [], inDropZone = false): PlayerZones => ({
  inPlaza: inDropZone,
  inDropZone,
  poiIds: new Set(poiIds),
});

const hub = map.hub.center;

describe('poiLabel', () => {
  it('reads "Kind · District"', () => {
    expect(poiLabel({ id: 'x', position: vec3(0, 0, 0), kind: 'mailbox', district: 'harbor' })).toBe('Mailbox · Harbor');
    expect(poiLabel({ id: 'y', position: vec3(0, 0, 0), kind: 'balcony', district: 'hillside' })).toBe('Balcony · Hillside');
  });
});

describe('hudModel', () => {
  it('drop-off stage reads "Deliver to …"', () => {
    const s = system();
    acceptOrder(s, order('d', 'dropoff', [poiA.id]));
    const m = hudModel(s, map, hub, 1);
    expect(m.orders).toHaveLength(1);
    expect(m.orders[0]!.stage).toBe(`Deliver to ${poiLabel(poiA)}`);
    expect(m.orders[0]!.title).toBe('Drop-off');
    expect(m.orders[0]!.target).toEqual(poiA.position);
  });

  it('pick-up stage reads "Collect at …" then "Return to HUB" after collection', () => {
    const s = system();
    acceptOrder(s, order('p', 'pickup', [poiA.id]));
    expect(hudModel(s, map, hub, 1).orders[0]!.stage).toBe(`Collect at ${poiLabel(poiA)}`);
    s.update(2, zones([poiA.id]));
    const m = hudModel(s, map, poiA.position, 2);
    expect(m.orders[0]!.stage).toBe('Return to HUB');
    expect(m.orders[0]!.target).toEqual(map.hub.center);
    expect(m.orders[0]!.title).toBe('Pick-up');
  });

  it('chain stages read Collect at A, Deliver to B, Return to HUB', () => {
    const s = system();
    acceptOrder(s, order('c', 'chain', [poiA.id, poiB.id]));
    expect(hudModel(s, map, hub, 1).orders[0]!.stage).toBe(`Collect at ${poiLabel(poiA)}`);
    s.update(2, zones([poiA.id]));
    expect(hudModel(s, map, hub, 2).orders[0]!.stage).toBe(`Deliver to ${poiLabel(poiB)}`);
    s.update(3, zones([poiB.id]));
    expect(hudModel(s, map, hub, 3).orders[0]!.stage).toBe('Return to HUB');
  });

  it('express secondsLeft counts down; late flips after the limit', () => {
    const s = system();
    acceptOrder(s, order('e', 'dropoff', [poiA.id], 'express', 30), 10);
    const at = (now: number) => hudModel(s, map, hub, now).orders[0]!.express;
    expect(at(10)).toEqual({ secondsLeft: 30, late: false });
    expect(at(25)).toEqual({ secondsLeft: 15, late: false });
    expect(at(40)).toEqual({ secondsLeft: 0, late: false });
    expect(at(41)).toEqual({ secondsLeft: 0, late: true });
    const plain = system();
    acceptOrder(plain, order('n', 'dropoff', [poiA.id]));
    expect(hudModel(plain, map, hub, 5).orders[0]!.express).toBeNull();
  });

  it('par secondsLeft counts down from parLimit and late flips after it', () => {
    const s = system();
    acceptOrder(s, order('p', 'dropoff', [poiA.id]), 10); // parLimit 60
    const at = (now: number) => hudModel(s, map, hub, now).orders[0]!.par;
    expect(at(10)).toEqual({ secondsLeft: 60, late: false });
    expect(at(25)).toEqual({ secondsLeft: 45, late: false });
    expect(at(70)).toEqual({ secondsLeft: 0, late: false });
    expect(at(71)).toEqual({ secondsLeft: 0, late: true });
  });

  it('every order has a par timer, Express included (both timers, independent)', () => {
    const s = system();
    acceptOrder(s, order('e', 'dropoff', [poiA.id], 'express', 30), 0);
    const m = hudModel(s, map, hub, 40).orders[0]!;
    expect(m.express).toEqual({ secondsLeft: 0, late: true });
    expect(m.par).toEqual({ secondsLeft: 20, late: false });
    const chain = system();
    acceptOrder(chain, order('c', 'chain', [poiA.id, poiB.id]));
    expect(hudModel(chain, map, hub, 1).orders[0]!.par).toEqual({ secondsLeft: 59, late: false });
  });

  it('fragileIntact is null without the modifier and tracks breaks', () => {
    const s = system();
    acceptOrder(s, order('f', 'dropoff', [poiA.id], 'fragile'));
    expect(hudModel(s, map, hub, 1).orders[0]!.fragileIntact).toBe(true);
    s.onSimEvents([{ kind: 'respawned', checkpointId: 'cp' }]);
    expect(hudModel(s, map, hub, 1).orders[0]!.fragileIntact).toBe(false);
    const plain = system();
    acceptOrder(plain, order('n', 'dropoff', [poiA.id]));
    expect(hudModel(plain, map, hub, 1).orders[0]!.fragileIntact).toBeNull();
  });

  it('distance is the straight-line distance to the current target, rounded to 1 m', () => {
    const s = system();
    acceptOrder(s, order('d', 'dropoff', [poiA.id]));
    const t = poiA.position;
    const player = vec3(t.x + 3.36, t.y + 4.48, t.z); // 5.6 m away (3D, height included)
    expect(hudModel(s, map, player, 1).orders[0]!.distance).toBe(6);
    const player2 = vec3(t.x - 30, t.y, t.z + 40.2); // 50.16 m
    expect(hudModel(s, map, player2, 1).orders[0]!.distance).toBe(50);
  });

  it('refreshIn = nextRefreshAt − now; cooldownLeft is never negative', () => {
    const s = system();
    const m = hudModel(s, map, hub, 12);
    expect(m.refreshIn).toBeCloseTo(s.nextRefreshAt - 12);
    expect(m.cooldownLeft).toBe(0);
    acceptOrder(s, order('d', 'dropoff', [poiA.id]), 12);
    expect(s.cancel('d', 20, true)).toBe('ok');
    expect(hudModel(s, map, hub, 30).cooldownLeft).toBeCloseTo(s.cancelCooldownUntil - 30);
    expect(hudModel(s, map, hub, s.cancelCooldownUntil + 5).cooldownLeft).toBe(0);
  });

  it('reports totals and slots', () => {
    const s = system(3);
    s.totals = { points: 5, coins: 50, deliveries: 3 };
    acceptOrder(s, order('d', 'dropoff', [poiA.id]));
    const m = hudModel(s, map, hub, 1);
    expect(m.totals).toEqual({ points: 5, coins: 50, deliveries: 3 });
    expect(m.slots).toEqual({ used: 1, capacity: 3 });
  });
});
