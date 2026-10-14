import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { clampHorizontal, horizontalLength, vec3, type Vec3 } from '../math/vec3';
import type { MapData } from '../world/mapTypes';
import type { PhysicsWorld } from '../world/physicsWorld';
import { PlayerBody, type MoveResult } from './body';
import { alignBoardHeading, applyBoardVelocity, toggleBoard } from './board';
import { applyAirVelocity, applyGroundVelocity, hasMoveInput, targetGroundSpeed, wishDirection, yawOf } from './ground';
import { ageJumpBuffer, coyoteTicks, tryJump } from './jump';
import { findLedge, startMantle, updateMantle } from './mantle';
import { startSlide, updateSlide } from './slide';
import { updateSprint } from './sprint';
import { applyTriggers, enterAir } from './triggers';
import type { PlayerState, SimEvent, StatModifiers } from './types';

/** Minimum blocked distance (m) before a wall or ceiling contact removes velocity. */
const BLOCK_EPS = 1e-4;

/**
 * Deterministic single-player movement simulation, stepped at cfg.tickRate.
 * `cfg` is held by reference: edits (e.g. from the dev panel) apply on the next step.
 */
export class PlayerSim {
  readonly state: PlayerState;
  readonly dt: number;
  readonly body: PlayerBody;
  readonly physics: PhysicsWorld;
  readonly map: MapData;
  readonly cfg: MovementConfig;
  /** Result of the most recent body move (null before the first step). */
  lastMove: MoveResult | null = null;

  constructor(physics: PhysicsWorld, map: MapData, cfg: MovementConfig, spawn: Vec3, yaw = 0) {
    this.physics = physics;
    this.map = map;
    this.cfg = cfg;
    this.dt = 1 / cfg.tickRate;
    this.body = new PlayerBody(physics, cfg, spawn);
    this.state = {
      position: this.body.feet,
      velocity: vec3(0, 0, 0),
      yaw,
      pitch: 0,
      heading: yaw,
      mode: 'air',
      onBoard: false,
      boardHeading: yaw,
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

  /** Places the player at `position` (airborne, no coyote jump, no buffered press). The heading is kept. */
  teleport(position: Vec3, velocity: Vec3 = vec3(0, 0, 0)): void {
    this.body.setFeet(position);
    const s = this.state;
    s.position = this.body.feet;
    s.velocity = vec3(velocity.x, velocity.y, velocity.z);
    s.jumpPressAge = null;
    enterAir(s, this.cfg);
  }

  /**
   * One tick: movement (all modes), then the out-of-bounds respawn. Horizontal speed leaves every step within
   * speedCap: the move itself is capped, and so is anything added after it (slide slope gravity).
   */
  // `time` (sim seconds) is part of the step contract; nothing in the movement sim reads it any more.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  step(input: InputFrame, mods: StatModifiers, time: number): SimEvent[] {
    this.state.slideBoostCooldown = Math.max(0, this.state.slideBoostCooldown - this.dt);
    const events = this.stepMovement(input, mods);
    events.push(...applyTriggers(this.state, this.body, this.map, this.cfg));
    this.state.velocity = clampHorizontal(this.state.velocity, this.cfg.speedCap);
    if (this.state.onBoard) this.state.heading = this.state.boardHeading;
    return events;
  }

  private stepMovement(input: InputFrame, mods: StatModifiers): SimEvent[] {
    const events: SimEvent[] = [];

    // 1. Look, courier heading and timers; crouch (stays crouched while standing is blocked; ignored on the board); board toggle (Q);
    //    crouch-slide entry (never on the board).
    const wish = wishDirection(input); // camera-relative; computed once per tick
    this.updateLookAndTimers(input, wish, mods);
    this.updateCrouch(input);
    if (input.board.pressed && toggleBoard(this.state)) events.push({ kind: 'boardToggled', onBoard: this.state.onBoard });
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
    if (!this.state.onBoard) updateSlide(this.state, move, this.cfg, this.dt); // a board rolls itself

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
      // The ledge probe runs along the heading. Off the board, any movement input has already turned the heading to
      // the wish direction this tick (updateLookAndTimers), so "input along the heading" is just "has movement input".
      const canStart = !s.onBoard && hasMoveInput(input) && (s.mode === 'ground' || s.mode === 'air');
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
   * step sees this tick's sprint state. Off the board, any movement input turns the courier to face its
   * (camera-relative) wish direction; with no input the heading holds. On the board the heading mirrors boardHeading
   * (set by the board code and at the end of the step).
   */
  private updateLookAndTimers(input: InputFrame, wish: Vec3, mods: StatModifiers): void {
    const s = this.state;
    s.yaw = input.look.yaw;
    s.pitch = input.look.pitch;
    updateSprint(s, input, mods, this.cfg.stamina, this.dt);
    if (!s.onBoard && hasMoveInput(input)) s.heading = yawOf(wish);
    ageJumpBuffer(s, input, this.cfg);
  }

  /**
   * The capsule is crouched while crouch is held. Releasing crouch stands up only
   * if a standing capsule fits (Review Focus 4); otherwise the player stays crouched (and a crouch-slide goes on)
   * and tries again every tick, so they stand automatically once clear. On the board crouch is ignored.
   */
  private updateCrouch(input: InputFrame): void {
    this.body.setCrouched(input.crouch.held && !this.state.onBoard);
    this.state.crouched = this.body.crouched;
  }

  private applyLocomotion(input: InputFrame, wish: Vec3, mods: StatModifiers): void {
    const s = this.state;
    if (s.onBoard && s.grounded) {
      applyBoardVelocity(s, input, wish, this.cfg, mods, this.dt);
      return;
    }
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
        const keepsSliding = !wasGrounded && !s.onBoard && s.crouched && horizontalLength(s.velocity) >= this.cfg.slide.endSpeed;
        s.mode = keepsSliding ? 'slide' : 'ground';
      }
      // A board landing points the board along the landing travel (air control may have turned it).
      if (!wasGrounded && s.onBoard) alignBoardHeading(s);
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
