import { beforeAll, describe, expect, test } from 'vitest';
import { movementConfig, ordersConfig, ridingConfig } from '../../src/config';
import type { RideTier } from '../../src/config/types';
import { emptyInput } from '../../src/input/inputFrame';
import { vec3 } from '../../src/math/vec3';
import type { SimEvent } from '../../src/movement/types';
import { burnFuel, pumpAt, Refueller, type RefuelEvent } from '../../src/vehicles/fuel';
import { stepVehicle } from '../../src/vehicles/stepVehicle';
import type { VehicleState } from '../../src/vehicles/types';
import { VehicleBody } from '../../src/vehicles/VehicleBody';
import type { MapData } from '../../src/world/mapTypes';
import { createPhysicsWorld, initRapier, type PhysicsWorld } from '../../src/world/physicsWorld';
import { box } from '../helpers/simHarness';
import { emptyMap } from '../world/fixtures';

const DT = 1 / 30;
let map: MapData;
let physics: PhysicsWorld;

beforeAll(async () => {
  map = { ...emptyMap(), solids: [box('floor', vec3(0, -0.5, 0), vec3(2000, 1, 2000), { kind: 'ground' })] };
  physics = createPhysicsWorld(await initRapier(), map);
});

const state = (tier: RideTier, fuel: number): VehicleState => ({
  tier, position: vec3(0, 0, 0), heading: 0, velocity: vec3(0, 0, 0), grounded: true, groundNormal: vec3(0, 1, 0), airApexY: 0, fuel,
});

const drive = (tier: RideTier, fuel: number, ticks: number, onTick?: (v: VehicleState) => void) => {
  const spec = ridingConfig.rides[tier];
  const body = new VehicleBody(physics, spec, vec3(0, 0, 0), 0);
  const v = state(tier, fuel);
  v.position = body.feet;
  const ctx = { map, spec, gravity: movementConfig.gravity, dt: DT, crashSpeed: ordersConfig.fragile.crashSpeed };
  const i = emptyInput();
  i.move = { x: 0, y: 1 };
  i.look = { yaw: 0, pitch: 0 };
  const events: SimEvent[] = [];
  let dist = 0;
  for (let k = 0; k < ticks; k++) {
    const z0 = v.position.z;
    events.push(...stepVehicle(v, body, i, ctx));
    dist += Math.abs(v.position.z - z0);
    onTick?.(v);
  }
  body.destroy();
  return { v, events, dist };
};

describe('burnFuel', () => {
  test('the car burns a full tank over 5000 m and the motorbike over 6000 m', () => {
    expect(burnFuel(1, 5000, ridingConfig.rides.car)).toBeCloseTo(0, 9);
    expect(burnFuel(1, 2500, ridingConfig.rides.car)).toBeCloseTo(0.5, 9);
    expect(burnFuel(1, 6000, ridingConfig.rides.motorbike)).toBeCloseTo(0, 9);
    expect(burnFuel(1, 3000, ridingConfig.rides.motorbike)).toBeCloseTo(0.5, 9);
    expect(burnFuel(0.1, 99999, ridingConfig.rides.car)).toBe(0);
    expect(burnFuel(1, 1000, ridingConfig.rides.bicycle)).toBe(1);
  });

  test('stepVehicle burns by the distance actually moved', () => {
    const r = drive('car', 1, 90);
    expect(r.dist).toBeGreaterThan(10);
    expect(r.v.fuel).toBeCloseTo(1 - r.dist / 5000, 6);
  });
});

describe('empty tank', () => {
  test('fuelEmpty fires once; an empty car still drives at 3 m/s (Review Focus 2)', () => {
    const r = drive('car', 0.0005, 240);
    expect(r.events.filter((e) => e.kind === 'fuelEmpty')).toEqual([{ kind: 'fuelEmpty', tier: 'car' }]);
    expect(r.v.fuel).toBe(0);
    const speed = Math.hypot(r.v.velocity.x, r.v.velocity.z);
    expect(speed).toBeCloseTo(ridingConfig.riding.emptyTankSpeed, 1);
    expect(speed).toBeGreaterThan(2.5);
  });
});

describe('Refueller', () => {
  const car = ridingConfig.rides.car;
  const base = { holding: true, atPump: true, stopped: true, dt: DT };
  /** Runs ticks, paying each `refuelled` cost; returns all events and Coins left. */
  const run = (v: VehicleState, spec = car, coins: number, ticks: number, over: Partial<typeof base> = {}) => {
    const rf = new Refueller();
    const all: RefuelEvent[] = [];
    for (let k = 0; k < ticks; k++) {
      for (const e of rf.tick(v, spec, { ...base, ...over, coins })) {
        all.push(e);
        if (e.kind === 'refuelled') coins -= e.cost;
      }
    }
    return { all, coins };
  };

  test('a full car fill costs 80 Coins; half a tank costs 40', () => {
    const v = state('car', 0);
    const { all, coins } = run(v, car, 500, 400);
    expect(all[0]).toEqual({ kind: 'refuelStarted' });
    expect(all[1]).toEqual({ kind: 'refuelled', cost: 80, fuel: 1, reason: 'full' });
    expect(coins).toBe(420);
    expect(v.fuel).toBe(1);

    const h = state('car', 0.5);
    expect(run(h, car, 500, 400).all[1]).toEqual({ kind: 'refuelled', cost: 40, fuel: 1, reason: 'full' });
  });

  test('a half-tank fill released midway charges proportionally', () => {
    const v = state('car', 0);
    const rf = new Refueller();
    // 0.25 tank/s: 60 ticks = 2 s = half a tank.
    for (let k = 0; k < 60; k++) rf.tick(v, car, { ...base, coins: 500 });
    const ev = rf.tick(v, car, { ...base, holding: false, coins: 500 });
    expect(v.fuel).toBeCloseTo(0.5, 6);
    expect(ev).toEqual([{ kind: 'refuelled', cost: 40, fuel: v.fuel, reason: 'released' }]);
  });

  test('Review Focus 2: with 30 Coins at an empty car pump, refuelling stops at 30/80 of a tank and charges at most 30', () => {
    const v = state('car', 0);
    const { all, coins } = run(v, car, 30, 400);
    const end = all.find((e) => e.kind === 'refuelled');
    expect(end).toMatchObject({ kind: 'refuelled', reason: 'coins', cost: 30 });
    expect(v.fuel).toBeCloseTo(30 / 80, 6);
    expect(coins).toBeGreaterThanOrEqual(0);
    // Exact list: no refuelRefused for the rest of the press, even though E stays held for 400 ticks.
    expect(all).toEqual([{ kind: 'refuelStarted' }, { kind: 'refuelled', cost: 30, fuel: v.fuel, reason: 'coins' }]);
  });

  test('never charges more than held for awkward balances', () => {
    for (const held of [0, 1, 7, 13, 29, 55, 79]) {
      const v = state('car', 0);
      const { coins } = run(v, car, held, 400);
      expect(coins).toBeGreaterThanOrEqual(0);
    }
  });

  test('no fuel while moving, away from a pump, or on the bicycle', () => {
    const moving = state('car', 0.2);
    expect(run(moving, car, 500, 30, { stopped: false }).all).toEqual([]);
    expect(moving.fuel).toBe(0.2);
    const away = state('car', 0.2);
    expect(run(away, car, 500, 30, { atPump: false }).all).toEqual([]);
    expect(away.fuel).toBe(0.2);
    const idle = state('car', 0.2);
    expect(run(idle, car, 500, 30, { holding: false }).all).toEqual([]);
    const bike = state('bicycle', 1);
    expect(run(bike, ridingConfig.rides.bicycle, 500, 30).all).toEqual([]);
    expect(bike.fuel).toBe(1);
  });

  test('holding E with 0 Coins emits refuelRefused once, then nothing while held (playtest issue 2)', () => {
    const v = state('car', 0.2);
    const rf = new Refueller();
    const t = (holding: boolean) => rf.tick(v, car, { ...base, holding, coins: 0 });
    expect(t(true)).toEqual([{ kind: 'refuelRefused', reason: 'noCoins' }]);
    for (let k = 0; k < 9; k++) expect(t(true)).toEqual([]);
    t(false);
    expect(t(true)).toEqual([{ kind: 'refuelRefused', reason: 'noCoins' }]);
    expect(v.fuel).toBe(0.2);
  });

  test('a full tank, or E without being at a pump, is not a refusal', () => {
    expect(run(state('car', 1), car, 0, 10).all).toEqual([]);
    expect(run(state('car', 0.2), car, 0, 10, { atPump: false }).all).toEqual([]);
  });

  test('moving mid-session ends it with reason moved', () => {
    const v = state('car', 0);
    const rf = new Refueller();
    for (let k = 0; k < 30; k++) rf.tick(v, car, { ...base, coins: 500 });
    const ev = rf.tick(v, car, { ...base, stopped: false, coins: 500 });
    expect(ev).toMatchObject([{ kind: 'refuelled', reason: 'moved' }]);
  });
});

describe('pumpAt', () => {
  test('finds a pump within the radius, else null', () => {
    const m: MapData = { ...emptyMap(), gasStations: [{ id: 'g1', name: 'Gas', position: vec3(0, 0, 0), pumps: [vec3(10, 0, 10), vec3(20, 0, 10)] }] };
    expect(pumpAt(m, vec3(11, 0, 10), 3)).toEqual({ stationId: 'g1', pump: vec3(10, 0, 10) });
    expect(pumpAt(m, vec3(15, 0, 10), 3)).toBeNull();
  });
});
