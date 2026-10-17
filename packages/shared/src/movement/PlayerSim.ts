import { ordersConfig } from '../config';
import type { MovementConfig, RideTier } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { add, clampHorizontal, horizontalLength, scale, vec3, type Vec3 } from '../math/vec3';
import { restsCarried, type Garage } from '../vehicles/Garage';
import { stepVehicle } from '../vehicles/stepVehicle';
import type { VehicleState } from '../vehicles/types';
import { nearestHospital } from '../world/hospitals';
import type { MapData } from '../world/mapTypes';
import type { PhysicsWorld } from '../world/physicsWorld';
import { PlayerBody, type MoveResult } from './body';
import { applyAirVelocity, applyGroundVelocity, facing, hasMoveInput, targetGroundSpeed, wishDirection, yawOf } from './ground';
import { ageJumpBuffer, coyoteTicks, tryJump } from './jump';
import { findLedge, startMantle, updateMantle } from './mantle';
import { startSlide, updateSlide } from './slide';
import { updateSprint } from './sprint';
import { applyTriggers, enterAir, respawn } from './triggers';
import type { PlayerState, SimEvent, StatModifiers } from './types';

/** Minimum blocked distance (m) before a wall or ceiling contact removes velocity. */
const BLOCK_EPS = 1e-4;
/** Below this horizontal speed (m/s) a velocity has no usable direction: the courier heading is used instead. */
const DIRECTION_EPS = 1e-6;

/**
 * Horizontal velocity `v` of a courier stepping off at `spot` from a vehicle at `vehicle`, less its component back
 * toward the vehicle: with n the horizontal unit vector from vehicle to spot, v − min(0, v·n)·n. Unchanged when the
 * spot is the vehicle's own position (the skateboard).
 */
function awayFrom(v: Vec3, vehicle: Vec3, spot: Vec3): Vec3 {
  const n = vec3(spot.x - vehicle.x, 0, spot.z - vehicle.z);
  const l = horizontalLength(n);
  if (l <= DIRECTION_EPS) return v;
  const into = Math.min(0, (v.x * n.x + v.z * n.z) / l);
  return vec3(v.x - (into * n.x) / l, v.y, v.z - (into * n.z) / l);
}

/**
 * Deterministic single-player movement simulation, stepped at cfg.tickRate: on foot, or riding a vehicle from the
 * garage (F mounts and dismounts). `cfg` is held by reference: edits (e.g. from the dev panel) apply on the next step.
 */
export class PlayerSim {
  readonly state: PlayerState;
  readonly dt: number;
  readonly body: PlayerBody;
  readonly physics: PhysicsWorld;
  readonly map: MapData;
  readonly cfg: MovementConfig;
  /** The owned vehicles: parked ones, the carried skateboard and the one being ridden. */
  readonly garage: Garage;
  /** Result of the most recent body move (null before the first step). */
  lastMove: MoveResult | null = null;

  constructor(physics: PhysicsWorld, map: MapData, cfg: MovementConfig, spawn: Vec3, yaw: number, garage: Garage) {
    this.physics = physics;
    this.map = map;
    this.cfg = cfg;
    this.garage = garage;
    this.dt = 1 / cfg.tickRate;
    this.body = new PlayerBody(physics, cfg, spawn);
    this.state = {
      position: this.body.feet,
      velocity: vec3(0, 0, 0),
      yaw,
      pitch: 0,
      heading: yaw,
      mode: 'air',
      riding: null,
      lastRide: null,
      crouched: false,
      sprinting: false,
      stamina: cfg.stamina.max,
      grounded: false,
      groundNormal: vec3(0, 1, 0),
      lastGrounded: vec3(spawn.x, spawn.y, spawn.z),
      airTicks: coyoteTicks(cfg) + 1,
      jumpPressAge: null,
      airApexY: spawn.y,
      mantle: null,
      slideBoostCooldown: 0,
    };
  }

  /**
   * Places the player at `position` (airborne, no coyote jump, no buffered press). The heading is kept. Riding, the
   * vehicle is placed there with the courier on it.
   */
  teleport(position: Vec3, velocity: Vec3 = vec3(0, 0, 0)): void {
    const s = this.state;
    s.jumpPressAge = null;
    if (s.riding) {
      const v = this.garage.state(s.riding);
      const body = this.garage.body(s.riding);
      body.place(position, v.heading);
      Object.assign(v, {
        position: body.feet,
        velocity: vec3(velocity.x, velocity.y, velocity.z),
        grounded: false,
        groundNormal: vec3(0, 1, 0),
        airApexY: position.y,
      });
      this.mirrorVehicle(v);
      s.airTicks = coyoteTicks(this.cfg) + 1;
      return;
    }
    this.body.setFeet(position);
    s.position = this.body.feet;
    s.velocity = vec3(velocity.x, velocity.y, velocity.z);
    enterAir(s, this.cfg);
  }

  /**
   * What F would mount now: the nearest owned parked vehicle within riding.mountRadius, else the carried skateboard
   * (when owned). Null while riding, airborne, crouched, sliding or mantling.
   */
  mountCandidate(): RideTier | null {
    const s = this.state;
    if (s.riding || !s.grounded || s.mode !== 'ground' || s.crouched) return null;
    const g = this.garage;
    const near = g.nearestParked(s.position, g.cfg.riding.mountRadius);
    if (near) return near;
    return g.owned().includes('skateboard') && g.spot('skateboard').kind === 'carried' ? 'skateboard' : null;
  }

  /**
   * Dev and tests: gets on the owned `tier` now, whatever else is happening. Any current ride is left first; a
   * vehicle other than the skateboard is parked `ahead` m in front of the courier (facing the same way) and boarded
   * there.
   */
  rideNow(tier: RideTier, ahead: number): SimEvent[] {
    this.leaveRide();
    const s = this.state;
    if (!restsCarried(tier)) {
      const f = facing(s.heading);
      this.garage.parkAt(tier, vec3(s.position.x + f.x * ahead, s.position.y, s.position.z + f.z * ahead), s.heading);
    }
    const events: SimEvent[] = [];
    this.mount(tier, events);
    return events;
  }

  /**
   * Gets off at once, whatever the speed (dev tools and respawn): the ridden vehicle is left where it is, parked on the
   * ground (at the last grounded spot when airborne) or carried for the skateboard. The courier is on foot, at rest,
   * where the board was (skateboard) or at the first free spot of dismountSpots (the left one when none is free),
   * grounded when the vehicle was, else airborne. Nothing happens on foot.
   */
  leaveRide(): void {
    const s = this.state;
    const tier = s.riding;
    if (!tier) return;
    const v = this.garage.state(tier);
    const wasGrounded = v.grounded;
    if (!wasGrounded) v.position = vec3(s.lastGrounded.x, s.lastGrounded.y, s.lastGrounded.z);
    let feet = v.position;
    if (!restsCarried(tier)) {
      const spots = this.dismountSpots(tier, v);
      feet = spots.find((p) => this.body.fitsAt(p, false)) ?? spots[0]!;
    }
    this.garage.leave(tier);
    s.riding = null;
    this.body.setEnabled(true);
    this.body.setFeet(feet);
    s.position = this.body.feet;
    s.velocity = vec3(0, 0, 0);
    if (!wasGrounded) enterAir(s, this.cfg);
  }

  /**
   * Spec §13 "Vehicle stuck" (the Settings app): respawns on foot at the hospital nearest the last grounded position,
   * like an out-of-bounds respawn (`respawned`, so a carried Fragile breaks), but every vehicle stays where it is. A
   * ridden vehicle is left there: parked on the ground (at the last grounded spot when airborne), or carried for the
   * skateboard.
   */
  respawnAtHospital(): SimEvent[] {
    const s = this.state;
    this.leaveRide();
    return [respawn(s, this.body, this.cfg, nearestHospital(this.map, s.lastGrounded))];
  }

  /**
   * One tick: movement (all modes), then the out-of-bounds respawn. Horizontal speed leaves every step within
   * speedCap: the move itself is capped, and so is anything added after it (slide slope gravity).
   */
  // `time` (sim seconds) is part of the step contract; nothing in the movement sim reads it any more.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  step(input: InputFrame, mods: StatModifiers, time: number): SimEvent[] {
    this.state.slideBoostCooldown = Math.max(0, this.state.slideBoostCooldown - this.dt);
    const events: SimEvent[] = [];
    // F first: a mount rides from this very tick, a dismount walks from it.
    if (input.mount.pressed) this.toggleMount(events);
    events.push(...(this.state.riding ? this.stepRiding(input) : this.stepMovement(input, mods)));
    events.push(...applyTriggers(this.state, this.body, this.map, this.cfg, this.garage));
    // On foot the courier's speed cap applies; a vehicle is held to its own top speed by the drive model.
    if (!this.state.riding) this.state.velocity = clampHorizontal(this.state.velocity, this.cfg.speedCap);
    return events;
  }

  /**
   * F: mounts mountCandidate() on foot (ignored when there is none), dismounts while riding, at any speed. In the air
   * only the skateboard gets off (it is carried); any other ride refuses (`mountRefused 'airborne'`), so nothing is
   * ever left parked in the air.
   */
  private toggleMount(events: SimEvent[]): void {
    const tier = this.state.riding;
    if (tier) {
      if (this.garage.state(tier).grounded || restsCarried(tier)) this.dismount(tier, events);
      else events.push({ kind: 'mountRefused', reason: 'airborne' });
      return;
    }
    const candidate = this.mountCandidate();
    if (candidate) this.mount(candidate, events);
  }

  /**
   * Gets on `tier`. The courier's collider is disabled (the vehicle collides instead). A parked vehicle is boarded
   * where it stands, at rest; the carried skateboard is put down at the feet, keeping the courier's horizontal velocity
   * and pointing along it (along the courier heading when still). Sprint switches off.
   */
  private mount(tier: RideTier, events: SimEvent[]): void {
    const s = this.state;
    const g = this.garage;
    const v = g.state(tier);
    this.body.setEnabled(false);
    if (g.spot(tier).kind === 'carried') {
      const flat = vec3(s.velocity.x, 0, s.velocity.z);
      const heading = horizontalLength(flat) > DIRECTION_EPS ? yawOf(flat) : s.heading;
      const body = g.body(tier);
      body.place(s.position, heading);
      Object.assign(v, {
        position: body.feet,
        heading,
        velocity: flat,
        grounded: s.grounded,
        groundNormal: s.groundNormal,
        airApexY: s.position.y,
      });
    }
    g.ride(tier);
    s.riding = tier;
    s.lastRide = tier;
    s.sprinting = false;
    s.mantle = null;
    s.jumpPressAge = null;
    this.mirrorVehicle(v);
    events.push({ kind: 'mounted', tier });
  }

  /**
   * Gets off `tier` at any speed (Decision 9). The skateboard is picked up and the courier is where it was, when a
   * standing courier fits there, grounded or in the air as the board was. Any other (grounded) vehicle is parked
   * where it is, stopped, and the courier steps off at the first spot of dismountSpots a standing courier fits and
   * reaches from the vehicle in a straight line (never through a wall or rail). No such spot: `mountRefused 'noRoom'`,
   * still riding. The courier keeps the ride's horizontal velocity less any part of it pointing back into the parked
   * vehicle (awayFrom), clamped to speedCap, and in the air its vertical velocity.
   */
  private dismount(tier: RideTier, events: SimEvent[]): void {
    const s = this.state;
    const g = this.garage;
    const v = g.state(tier);
    let feet: Vec3 | undefined;
    if (restsCarried(tier)) {
      // The board's own collider stands where the courier would: test the spot with it out of the way.
      const board = g.body(tier);
      board.setEnabled(false);
      if (this.body.fitsAt(v.position, false)) feet = v.position;
      else board.setEnabled(true);
    } else {
      const vehicle = g.body(tier).collider;
      feet = this.dismountSpots(tier, v).find((p) => this.body.fitsAt(p, false) && this.body.pathClear(v.position, p, vehicle));
    }
    if (!feet) {
      events.push({ kind: 'mountRefused', reason: 'noRoom' });
      return;
    }
    const grounded = v.grounded;
    const flat = clampHorizontal(awayFrom(vec3(v.velocity.x, 0, v.velocity.z), v.position, feet), this.cfg.speedCap);
    const velocity = vec3(flat.x, grounded ? 0 : v.velocity.y, flat.z);
    g.leave(tier);
    s.riding = null;
    this.body.setEnabled(true);
    this.body.setFeet(feet);
    s.position = this.body.feet;
    s.velocity = velocity;
    if (!grounded) enterAir(s, this.cfg);
    events.push({ kind: 'dismounted', tier });
  }

  /**
   * Feet spots beside a vehicle, in order: its left side, its right side (collider radius + capsule radius +
   * riding.dismountGap from its axis), then behind it (the same gap past its rear).
   */
  private dismountSpots(tier: RideTier, v: VehicleState): Vec3[] {
    const c = this.garage.cfg.rides[tier].collider;
    const extra = this.cfg.capsule.radius + this.garage.cfg.riding.dismountGap;
    const side = c.radius + extra;
    const back = (c.shape === 'lengthwise' ? c.halfLength : 0) + c.radius + extra;
    const f = facing(v.heading);
    const left = vec3(f.z, 0, -f.x);
    return [add(v.position, scale(left, side)), add(v.position, scale(left, -side)), add(v.position, scale(f, -back))];
  }

  /**
   * One riding tick: the camera look follows the input, sprint stays off while stamina regenerates, the vehicle steps
   * (stepVehicle) and the courier mirrors it.
   */
  private stepRiding(input: InputFrame): SimEvent[] {
    const s = this.state;
    const tier = s.riding as RideTier;
    const g = this.garage;
    s.yaw = input.look.yaw;
    s.pitch = input.look.pitch;
    s.sprinting = false;
    s.stamina = Math.min(this.cfg.stamina.max, s.stamina + this.cfg.stamina.regenPerSecond * this.dt);
    const spec = g.cfg.rides[tier];
    // Space ollies a ride with a jumpHeight, with the on-foot jump buffer and coyote time; on any other it is the handbrake.
    if (spec.jumpHeight !== null) ageJumpBuffer(s, input, this.cfg);
    else s.jumpPressAge = null;
    const v = g.state(tier);
    const events = stepVehicle(v, g.body(tier), input, {
      map: this.map,
      spec,
      gravity: this.cfg.gravity,
      dt: this.dt,
      crashSpeed: ordersConfig.fragile.crashSpeed,
      jump: { pressAge: s.jumpPressAge, coyote: s.airTicks <= coyoteTicks(this.cfg) },
    });
    this.mirrorVehicle(v);
    if (events.some((e) => e.kind === 'jumped')) {
      // As tryJump: the press is spent and the coyote window is over (no second jump in the air).
      s.jumpPressAge = null;
      s.airTicks = coyoteTicks(this.cfg) + 1;
    }
    return events;
  }

  /** The courier rides along: position, velocity, heading, grounding and mode ('ground' / 'air') follow `v`. */
  private mirrorVehicle(v: VehicleState): void {
    const s = this.state;
    const wasGrounded = s.grounded;
    s.position = vec3(v.position.x, v.position.y, v.position.z);
    s.velocity = vec3(v.velocity.x, v.velocity.y, v.velocity.z);
    s.heading = v.heading;
    s.grounded = v.grounded;
    s.groundNormal = v.groundNormal;
    s.mode = v.grounded ? 'ground' : 'air';
    if (v.grounded) {
      s.lastGrounded = vec3(v.position.x, v.position.y, v.position.z);
      s.airTicks = 0;
      s.airApexY = v.position.y;
    } else {
      s.airTicks = wasGrounded ? 0 : s.airTicks + 1;
      s.airApexY = Math.max(s.airApexY, v.position.y);
    }
  }

  private stepMovement(input: InputFrame, mods: StatModifiers): SimEvent[] {
    const events: SimEvent[] = [];

    // 1. Look, courier heading and timers; crouch (stays crouched while standing is blocked); crouch-slide entry.
    const wish = wishDirection(input); // camera-relative; computed once per tick
    this.updateLookAndTimers(input, wish, mods);
    this.updateCrouch(input);
    const slide = startSlide(this.state, input, this.cfg); // crouch is pressed, so the capsule is already crouched
    if (slide !== 'none') events.push({ kind: 'slideStarted', boosted: slide === 'boosted' });

    // 2. Mantle runs here and returns early. Ledge detection runs before the move, so the stored horizontal
    //    velocity is the approach velocity (a blocking move would already have removed the part into the ledge face).
    if (this.tryMantle(input)) return events;

    // 3. Locomotion: ground or air acceleration toward the wish direction. A slide drives itself in step 9.
    if (this.state.mode !== 'slide') this.applyLocomotion(input, wish, mods);

    // 4. Jump (buffer + coyote).
    if (tryJump(this.state, input, this.cfg, mods, this.dt)) events.push({ kind: 'jumped' });

    // 5–7. Gravity, speed cap, collide-and-slide move.
    const move = this.integrateAndMove();

    // 8. Landing, air timers and apex tracking.
    this.resolveContacts(move, events);

    // 9. Post-move slide physics and end; triggers run after this method (step).
    updateSlide(this.state, move, this.cfg, this.dt);

    return events;
  }

  /**
   * Advances a mantle in progress, or starts one when a ledge is found. While mantling the body is placed on the
   * mantle path directly (no collisions); the mantle finishes in ground mode. Returns true when this step was a
   * mantle step (the rest of the step is skipped).
   */
  private tryMantle(input: InputFrame): boolean {
    const s = this.state;
    if (s.mode !== 'mantle') {
      // The ledge probe runs along the heading. Any movement input has already turned the heading to the wish
      // direction this tick (updateLookAndTimers), so "input along the heading" is just "has movement input".
      const canStart = hasMoveInput(input) && (s.mode === 'ground' || s.mode === 'air');
      const top = canStart ? findLedge(this.body, s, this.cfg) : null;
      if (!top) return false;
      startMantle(s, top);
    }
    updateMantle(s, this.cfg, this.dt);
    this.body.setFeet(s.position);
    s.position = this.body.feet;
    return true;
  }

  /**
   * The camera yaw and pitch come from the input. The sprint toggle updates first (updateSprint), so every later
   * step sees this tick's sprint state. Any movement input turns the courier to face its (camera-relative) wish
   * direction; with no input the heading holds.
   */
  private updateLookAndTimers(input: InputFrame, wish: Vec3, mods: StatModifiers): void {
    const s = this.state;
    s.yaw = input.look.yaw;
    s.pitch = input.look.pitch;
    updateSprint(s, input, mods, this.cfg.stamina, this.dt);
    if (hasMoveInput(input)) s.heading = yawOf(wish);
    ageJumpBuffer(s, input, this.cfg);
  }

  /**
   * The capsule is crouched while crouch is held. Releasing crouch stands up only
   * if a standing capsule fits (Review Focus 4); otherwise the player stays crouched (and a crouch-slide goes on)
   * and tries again every tick, so they stand automatically once clear.
   */
  private updateCrouch(input: InputFrame): void {
    this.body.setCrouched(input.crouch.held);
    this.state.crouched = this.body.crouched;
  }

  private applyLocomotion(input: InputFrame, wish: Vec3, mods: StatModifiers): void {
    const s = this.state;
    const target = targetGroundSpeed(input, s, this.cfg, mods);
    if (s.grounded) applyGroundVelocity(s, wish, target, this.cfg, this.dt);
    else applyAirVelocity(s, wish, target, this.cfg, this.dt);
  }

  /**
   * Gravity is integrated exactly for a constant acceleration (dy = vy·dt − ½·g·dt²), so the jump apex
   * is exact at any tick rate. Snap-to-ground is only enabled while not moving up.
   */
  private integrateAndMove(): MoveResult {
    const s = this.state;
    const { dt, cfg } = this;
    const g = cfg.gravity;
    const vy0 = s.velocity.y;
    const dy = vy0 * dt - 0.5 * g * dt * dt;
    s.velocity = clampHorizontal(vec3(s.velocity.x, vy0 - g * dt, s.velocity.z), cfg.speedCap);
    const desired = vec3(s.velocity.x * dt, dy, s.velocity.z * dt);
    const move = this.body.move(desired, s.velocity.y <= 0);
    s.position = this.body.feet;
    this.removeBlockedVelocity(move, desired);
    this.lastMove = move;
    return move;
  }

  /** Removes velocity into walls/ceilings the move was actually stopped by (auto-steps are not blocks). */
  private removeBlockedVelocity(move: MoveResult, desired: Vec3): void {
    const s = this.state;
    let { x, y, z } = s.velocity;
    for (const n of move.wallNormals) {
      const l = Math.hypot(n.x, n.z);
      if (l === 0) continue;
      const nx = n.x / l;
      const nz = n.z / l;
      const blocked = (move.movement.x - desired.x) * nx + (move.movement.z - desired.z) * nz;
      const into = x * nx + z * nz;
      if (blocked > BLOCK_EPS && into < 0) {
        x -= nx * into;
        z -= nz * into;
      }
    }
    if (y > 0 && move.ceilingNormals.length > 0 && move.movement.y < desired.y - BLOCK_EPS) y = 0;
    s.velocity = vec3(x, y, z);
  }

  private resolveContacts(move: MoveResult, events: SimEvent[]): void {
    const s = this.state;
    const wasGrounded = s.grounded;
    const grounded = move.grounded && s.velocity.y <= 0;
    s.grounded = grounded;
    if (grounded) {
      if (!wasGrounded) {
        events.push({ kind: 'landed', fallHeight: Math.max(s.airApexY, s.position.y) - s.position.y });
      }
      // An air landing changes the mode: a slide stays a slide (mantle steps never reach here).
      // Landing on foot still crouched at slide speed (a slide off a ledge, a slide-jump) slides on (R26).
      if (s.mode === 'air') {
        const keepsSliding = !wasGrounded && s.crouched && horizontalLength(s.velocity) >= this.cfg.slide.endSpeed;
        s.mode = keepsSliding ? 'slide' : 'ground';
      }
      s.velocity = vec3(s.velocity.x, 0, s.velocity.z);
      s.groundNormal = move.groundNormal;
      s.lastGrounded = vec3(s.position.x, s.position.y, s.position.z);
      s.airTicks = 0;
      s.airApexY = s.position.y;
    } else {
      s.airTicks = wasGrounded ? 0 : s.airTicks + 1;
      // Leaving the ground on foot (or mid-slide) goes airborne.
      if (s.mode === 'ground' || s.mode === 'slide') s.mode = 'air';
      s.groundNormal = vec3(0, 1, 0);
      s.airApexY = Math.max(s.airApexY, s.position.y);
    }
  }
}
