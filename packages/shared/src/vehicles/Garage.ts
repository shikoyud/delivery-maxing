import { ridingConfig } from '../config';
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
 * All four vehicles owned (Decision 2): the skateboard carried, the others parked in bay slots 0–2 of the first
 * hospital, full tanks.
 */
export function defaultGarage(map: MapData, cfg: RidingConfig = ridingConfig): SavedVehicle[] {
  const h = map.hospitals[0];
  if (!h) throw new Error('map has no hospitals');
  let slot = 0;
  return RIDE_TIERS.map((tier) => ({
    tier,
    spot: restsCarried(tier) ? { kind: 'carried' } : { kind: 'parked', ...baySlot(h, slot++, cfg) },
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

/** A parked vehicle within this horizontal distance (m) of a bay slot takes it. */
const SLOT_TAKEN_FRACTION = 0.5;

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
   * Buys or removes a vehicle. A new one gets a full tank and parks at the first free bay slot of `startAt` (the
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

  /** Out of bounds (Decision 6): parks the vehicle at the first free bay slot of `h`, stopped, fuel unchanged. */
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

  /** Parks `t` at the lowest-numbered slot of `h` that no other owned parked or ridden vehicle occupies. */
  private parkAtBay(t: RideTier, h: Hospital): void {
    const taken = (pos: Vec3): boolean =>
      this.owned().some((o) => {
        const e = this.entries[o];
        if (o === t || e.spot.kind === 'carried') return false;
        // A ridden vehicle counts where it is now (its saved spot is only where it was parked).
        const at = e.spot.kind === 'parked' ? e.spot.position : e.state.position;
        return Math.hypot(at.x - pos.x, at.z - pos.z) < this.cfg.bays.spacing * SLOT_TAKEN_FRACTION;
      });
    for (let i = 0; ; i++) {
      const slot = baySlot(h, i, this.cfg);
      if (!taken(slot.position)) {
        this.park(t, slot.position, slot.heading);
        return;
      }
    }
  }
}
