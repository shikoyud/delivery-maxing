import { colliderLength, ridingConfig } from '../config';
import { RIDE_TIERS, type RideTier, type RidingConfig } from '../config/types';
import { vec3, type Vec3 } from '../math/vec3';
import { facing } from '../movement/ground';
import { baySlot } from '../world/access';
import type { Hospital, MapData } from '../world/mapTypes';
import type { PhysicsWorld } from '../world/physicsWorld';
import type { SummonResult } from './summon';
import type { VehicleState } from './types';
import { VehicleBody } from './VehicleBody';

/**
 * Where a vehicle is: parked in the world, carried by the courier (the skateboard's resting spot, Decision 1) or
 * being ridden.
 */
export type VehicleSpot = { kind: 'parked'; position: Vec3; heading: number } | { kind: 'carried' } | { kind: 'riding' };

/** One owned vehicle as saved. */
export interface SavedVehicle {
  tier: RideTier;
  spot: VehicleSpot;
  fuel: number;
}

interface Entry {
  owned: boolean;
  spot: VehicleSpot;
  state: VehicleState;
  body: VehicleBody;
}

/** A tier that rests carried rather than parked (Decision 1): it is picked up on dismount and never left behind. */
export const restsCarried = (t: RideTier): boolean => t === 'skateboard';

/**
 * Bay order: the longer collider first (2 × (halfLength + radius), config/riding.json), ties by the higher tier. The
 * slots run nose-to-tail behind slot 0 with slot 0 at the front, so the longest ride has nothing ahead of it and every
 * shorter one behind can back out; a car behind a motorbike would be boxed in 2.2 m from its nose.
 */
export function bayOrder(tiers: readonly RideTier[], cfg: RidingConfig = ridingConfig): RideTier[] {
  return [...tiers].sort((a, b) => colliderLength(cfg, b) - colliderLength(cfg, a) || RIDE_TIERS.indexOf(b) - RIDE_TIERS.indexOf(a));
}

/**
 * All four vehicles owned (Decision 2): the skateboard carried, the others parked in bay slots 0–2 of the first
 * hospital in bayOrder (the car in front), full tanks.
 */
export function defaultGarage(map: MapData, cfg: RidingConfig = ridingConfig): SavedVehicle[] {
  const h = map.hospitals[0];
  if (!h) throw new Error('map has no hospitals');
  const parkOrder = bayOrder(RIDE_TIERS.filter((t) => !restsCarried(t)), cfg);
  return RIDE_TIERS.map((tier) => ({
    tier,
    spot: restsCarried(tier) ? { kind: 'carried' } : { kind: 'parked', ...baySlot(h, parkOrder.indexOf(tier), cfg) },
    fuel: 1,
  }));
}

/** Horizontal distance from `p` to the segment a..b. */
function distanceToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/** A parked vehicle within this fraction of bays.spacing (horizontally) of a bay slot takes it. */
const SLOT_TAKEN_FRACTION = 0.5;
/** A vehicle this close (m, rad) to a slot's position and heading was parked there by the bay (and may be re-parked). */
const AT_SLOT_EPS = 1e-3;

/**
 * Every vehicle's parked state and body. All four tiers have a body; parked ones are enabled colliders (obstacles
 * for the courier and for the ridden vehicle), carried and unowned ones are disabled. The ridden vehicle's body is
 * enabled and driven by PlayerSim.
 */
export class Garage {
  private readonly entries: Record<RideTier, Entry>;
  readonly map: MapData;
  /** Sim time (s) from which the next summon may run: one cooldown for all vehicles, started by a successful summon. */
  summonReadyAt = 0;
  /** Held by reference: dev-panel edits apply on the next use. */
  readonly cfg: RidingConfig;

  constructor(physics: PhysicsWorld, map: MapData, owned: SavedVehicle[], cfg: RidingConfig = ridingConfig) {
    this.map = map;
    this.cfg = cfg;
    const entries = {} as Record<RideTier, Entry>;
    for (const tier of RIDE_TIERS) {
      const state: VehicleState = {
        tier,
        position: vec3(0, 0, 0),
        heading: 0,
        velocity: vec3(0, 0, 0),
        grounded: true,
        groundNormal: vec3(0, 1, 0),
        airApexY: 0,
        fuel: 1,
      };
      const body = new VehicleBody(physics, cfg.rides[tier], state.position, 0);
      body.setEnabled(false);
      entries[tier] = { owned: false, spot: { kind: 'carried' }, state, body };
    }
    this.entries = entries;
    for (const v of owned) {
      const e = entries[v.tier];
      e.owned = true;
      e.state.fuel = v.fuel;
      // The skateboard always rests carried. A save never holds 'riding' (snapshot parks the ridden vehicle), and
      // only the skateboard is carried: any other such spot parks like a newly bought vehicle.
      if (restsCarried(v.tier)) this.carry(v.tier);
      else if (v.spot.kind === 'parked') this.park(v.tier, v.spot.position, v.spot.heading);
      else this.parkAtBay(v.tier, this.firstHospital());
    }
  }

  /** Owned tiers, in RIDE_TIERS order. */
  owned(): readonly RideTier[] {
    return RIDE_TIERS.filter((t) => this.entries[t].owned);
  }

  /** The live dynamic state (PlayerSim mutates the ridden one). */
  state(t: RideTier): VehicleState {
    return this.entries[t].state;
  }

  spot(t: RideTier): VehicleSpot {
    return this.entries[t].spot;
  }

  body(t: RideTier): VehicleBody {
    return this.entries[t].body;
  }

  /**
   * The owned parked vehicle nearest to `feet` within `radius` (m), measured horizontally to its capsule's axis
   * (the centre point for upright rides, the segment along the heading for lengthwise ones), and within reach
   * vertically (riding.mountReachHeight); null when none.
   */
  nearestParked(feet: Vec3, radius: number): RideTier | null {
    let best: RideTier | null = null;
    let bestD = Infinity;
    for (const t of this.owned()) {
      const e = this.entries[t];
      if (e.spot.kind !== 'parked') continue;
      const p = e.state.position;
      if (Math.abs(p.y - feet.y) > this.cfg.riding.mountReachHeight) continue;
      const c = this.cfg.rides[t].collider;
      const half = c.shape === 'lengthwise' ? c.halfLength : 0;
      const f = facing(e.state.heading);
      const d = distanceToSegment(
        feet,
        vec3(p.x - f.x * half, p.y, p.z - f.z * half),
        vec3(p.x + f.x * half, p.y, p.z + f.z * half),
      );
      if (d <= radius && d < bestD) {
        best = t;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * Buys or removes a vehicle. A new one gets a full tank and parks in the bay of `startAt` in bayOrder (parkAtBay; the
   * skateboard is carried); a removed one's collider is disabled. No change when already in that state.
   */
  setOwned(t: RideTier, owned: boolean, startAt: Hospital): void {
    const e = this.entries[t];
    if (e.owned === owned) return;
    e.owned = owned;
    if (!owned) {
      e.spot = { kind: 'carried' };
      e.body.setEnabled(false);
      return;
    }
    e.state.fuel = 1;
    if (restsCarried(t)) this.carry(t);
    else this.parkAtBay(t, startAt);
  }

  /** Dev and tests: parks the owned `t` at `position`, stopped (the skateboard is carried instead). */
  parkAt(t: RideTier, position: Vec3, heading: number): void {
    if (restsCarried(t)) this.carry(t);
    else this.park(t, position, heading);
  }

  /** Out of bounds (Decision 6): parks the vehicle in the bay of `h` in bayOrder (parkAtBay), stopped, fuel unchanged. */
  tow(t: RideTier, h: Hospital): void {
    if (restsCarried(t)) this.carry(t);
    else this.parkAtBay(t, h);
  }

  /** Marks `t` as ridden: its collider is enabled (PlayerSim places a carried skateboard at the feet first). */
  ride(t: RideTier): void {
    const e = this.entries[t];
    e.spot = { kind: 'riding' };
    e.body.setEnabled(true);
  }

  /** Leaves the ridden `t` where it is: parked (stopped), or carried for the skateboard. */
  leave(t: RideTier): void {
    const e = this.entries[t];
    if (restsCarried(t)) this.carry(t);
    else this.park(t, e.state.position, e.state.heading);
  }

  /**
   * Whether `t` could be summoned to `player` at sim time `now`, short of finding a spot: 'riding', 'carried' (the
   * skateboard), 'tooClose' within summon.minDistance, 'cooldown' before summonReadyAt, else 'ok'.
   */
  summonStatus(t: RideTier, player: Vec3, now: number): SummonResult {
    const e = this.entries[t];
    if (e.spot.kind === 'riding') return 'riding';
    if (e.spot.kind === 'carried') return 'carried';
    const p = e.state.position;
    if (Math.hypot(p.x - player.x, p.y - player.y, p.z - player.z) <= this.cfg.summon.minDistance) return 'tooClose';
    if (now < this.summonReadyAt) return 'cooldown';
    return 'ok';
  }

  /**
   * Summons the parked `t` to the spot `spot(t)` finds by `player` (spec §4.4, see findRoadSpot): parked there,
   * stopped, and the summon cooldown starts. A refusal (summonStatus, or 'noSpot' when `spot` finds none) changes
   * nothing and never starts the cooldown.
   */
  summon(
    t: RideTier,
    player: Vec3,
    now: number,
    spot: (t: RideTier) => { position: Vec3; heading: number } | null,
  ): SummonResult {
    const status = this.summonStatus(t, player, now);
    if (status !== 'ok') return status;
    const to = spot(t);
    if (!to) return 'noSpot';
    this.park(t, to.position, to.heading);
    this.summonReadyAt = now + this.cfg.summon.cooldownSeconds;
    return 'ok';
  }

  /** The owned vehicles to save; a ridden vehicle is saved parked where it is (the skateboard carried). */
  snapshot(): SavedVehicle[] {
    return this.owned().map((tier) => {
      const e = this.entries[tier];
      let spot: VehicleSpot;
      if (e.spot.kind === 'parked') spot = { kind: 'parked', position: { ...e.spot.position }, heading: e.spot.heading };
      else if (restsCarried(tier)) spot = { kind: 'carried' };
      else spot = { kind: 'parked', position: { ...e.state.position }, heading: e.state.heading };
      return { tier, spot, fuel: e.state.fuel };
    });
  }

  private firstHospital(): Hospital {
    const h = this.map.hospitals[0];
    if (!h) throw new Error('map has no hospitals');
    return h;
  }

  private carry(t: RideTier): void {
    const e = this.entries[t];
    e.spot = { kind: 'carried' };
    e.state.velocity = vec3(0, 0, 0);
    e.body.setEnabled(false);
  }

  private park(t: RideTier, position: Vec3, heading: number): void {
    const e = this.entries[t];
    const p = vec3(position.x, position.y, position.z);
    e.body.place(p, heading);
    e.body.setEnabled(true);
    e.spot = { kind: 'parked', position: vec3(p.x, p.y, p.z), heading };
    Object.assign(e.state, {
      position: e.body.feet,
      heading,
      velocity: vec3(0, 0, 0),
      grounded: true,
      groundNormal: vec3(0, 1, 0),
      airApexY: p.y,
    });
  }

  /**
   * Parks `t` in the bay of `h` in bayOrder: `t` and the vehicles the bay parked there (exactly on a slot) are re-parked
   * front-to-back, longest first, in the free slots from slot 0. A slot under a ridden vehicle or one parked there by
   * hand (near a slot, not on it) is not free, and those vehicles stay where they are.
   */
  private parkAtBay(t: RideTier, h: Hospital): void {
    const spacing = this.cfg.bays.spacing;
    const behind = vec3(Math.sin(h.bayYaw), 0, Math.cos(h.bayYaw));
    const inBay: RideTier[] = [];
    const blockers: Vec3[] = [];
    for (const o of this.owned()) {
      const e = this.entries[o];
      if (o === t || e.spot.kind === 'carried') continue;
      // A ridden vehicle counts where it is now (its saved spot is only where it was parked).
      const at = e.spot.kind === 'parked' ? e.spot.position : e.state.position;
      if (e.spot.kind === 'parked' && this.onSlot(h, behind, e.spot.position, e.spot.heading)) inBay.push(o);
      else blockers.push(at);
    }
    const blocked = (pos: Vec3): boolean => blockers.some((b) => Math.hypot(b.x - pos.x, b.z - pos.z) < spacing * SLOT_TAKEN_FRACTION);
    const order = bayOrder([...inBay, t], this.cfg);
    let k = 0;
    for (let i = 0; k < order.length; i++) {
      const slot = baySlot(h, i, this.cfg);
      if (blocked(slot.position)) continue;
      this.park(order[k++]!, slot.position, slot.heading);
    }
  }

  /** Whether a vehicle parked at `p` facing `heading` stands exactly on a bay slot of `h`. */
  private onSlot(h: Hospital, behind: Vec3, p: Vec3, heading: number): boolean {
    if (Math.abs(heading - h.bayYaw) > AT_SLOT_EPS) return false;
    const i = Math.round(((p.x - h.bay.x) * behind.x + (p.z - h.bay.z) * behind.z) / this.cfg.bays.spacing);
    if (i < 0) return false;
    const slot = baySlot(h, i, this.cfg).position;
    return Math.hypot(slot.x - p.x, slot.y - p.y, slot.z - p.z) < AT_SLOT_EPS;
  }
}
