import { ridingConfig } from '../config';
import type { RideSpec } from '../config/types';
import type { Vec3 } from '../math/vec3';
import type { MapData } from '../world/mapTypes';
import type { VehicleState } from './types';

/** Tank left after driving `meters`; unchanged for a ride without a tank. */
export function burnFuel(fuel: number, meters: number, spec: RideSpec): number {
  if (!spec.fuel) return fuel;
  return Math.max(0, fuel - meters / spec.fuel.rangeMeters);
}

/** The pump within `radius` (horizontal) of `p`, nearest first, or null. */
export function pumpAt(map: MapData, p: Vec3, radius: number): { stationId: string; pump: Vec3 } | null {
  let best: { stationId: string; pump: Vec3 } | null = null;
  let bestD = radius;
  for (const s of map.gasStations) {
    for (const pump of s.pumps) {
      const d = Math.hypot(pump.x - p.x, pump.z - p.z);
      if (d <= bestD) {
        bestD = d;
        best = { stationId: s.id, pump };
      }
    }
  }
  return best;
}

export type RefuelEvent =
  | { kind: 'refuelStarted' }
  | { kind: 'refuelled'; cost: number; fuel: number; reason: 'full' | 'released' | 'coins' | 'moved' };

export interface RefuelContext {
  holding: boolean;
  atPump: boolean;
  stopped: boolean;
  coins: number;
  dt: number;
}

/** Float slack when rounding accrued Coins up. */
const EPS = 1e-9;

/**
 * One refuelling session at a time. Fuel rises at refuel.tankPerSecond while E is held, stopped, at a pump; cost
 * accrues at fullTankCoins × fuel added and is charged (`refuelled.cost`) as ceil(accrued) when the session ends:
 * tank full, E released, the vehicle moved, or the next tick would cost more whole Coins than the player holds.
 * The caller pays `cost` (OrderSystem.spendCoins) on each `refuelled` event; `ctx.coins` is the balance before it.
 */
export class Refueller {
  private active = false;
  private accrued = 0;

  tick(v: VehicleState, spec: RideSpec, ctx: RefuelContext): RefuelEvent[] {
    const tank = spec.fuel;
    if (!tank) return [];
    const events: RefuelEvent[] = [];
    const can = ctx.holding && ctx.atPump && ctx.stopped;
    if (this.active && !can) {
      this.end(v, events, !ctx.holding ? 'released' : 'moved');
      return events;
    }
    if (!can || v.fuel >= 1) return events;

    const add = Math.min(ridingConfig.refuel.tankPerSecond * ctx.dt, 1 - v.fuel);
    const next = this.accrued + tank.fullTankCoins * add;
    if (Math.ceil(next - EPS) > ctx.coins) {
      if (this.active) this.end(v, events, 'coins');
      return events;
    }
    if (!this.active) {
      this.active = true;
      events.push({ kind: 'refuelStarted' });
    }
    this.accrued = next;
    v.fuel = v.fuel + add >= 1 - EPS ? 1 : v.fuel + add;
    if (v.fuel >= 1) this.end(v, events, 'full');
    return events;
  }

  private end(v: VehicleState, events: RefuelEvent[], reason: 'full' | 'released' | 'coins' | 'moved'): void {
    events.push({ kind: 'refuelled', cost: Math.ceil(this.accrued - EPS), fuel: v.fuel, reason });
    this.active = false;
    this.accrued = 0;
  }
}
