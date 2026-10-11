import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { clampHorizontal, vec3, type Vec3 } from '../math/vec3';
import type { MapData } from '../world/mapTypes';
import type { PhysicsWorld } from '../world/physicsWorld';
import { PlayerBody, type MoveResult } from './body';
import { applyAirVelocity, applyGroundVelocity, targetGroundSpeed, wishDirection } from './ground';
import { ageJumpBuffer, coyoteTicks, tryJump } from './jump';
import { startSlide, updateSlide } from './slide';
import type { PlayerState, SimEvent, StatModifiers, WorldFeatureState } from './types';

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
      mode: 'air',
      onBoard: false,
      crouched: false,
      grounded: false,
      groundNormal: vec3(0, 1, 0),
      lastGrounded: vec3(spawn.x, spawn.y, spawn.z),
      airTicks: coyoteTicks(cfg) + 1,
      jumpPressAge: null,
      airApexY: spawn.y,
    };
  }

  /** Places the player at `position` (airborne, no coyote jump, no buffered press). */
  teleport(position: Vec3, velocity: Vec3 = vec3(0, 0, 0)): void {
    this.body.setFeet(position);
    const s = this.state;
    s.position = this.body.feet;
    s.velocity = vec3(velocity.x, velocity.y, velocity.z);
    s.mode = 'air';
    s.grounded = false;
    s.groundNormal = vec3(0, 1, 0);
    s.airTicks = coyoteTicks(this.cfg) + 1;
    s.jumpPressAge = null;
    s.airApexY = position.y;
  }

  step(input: InputFrame, mods: StatModifiers, world: WorldFeatureState, time: number): SimEvent[] {
    void world; // used by triggers (Task 9)
    void time;
    const events: SimEvent[] = [];

    // 1. Look and timers; crouch (stays crouched while standing is blocked); crouch-slide entry.
    this.updateLookAndTimers(input);
    this.updateCrouch(input);
    startSlide(this.state, input, this.cfg); // crouch is pressed, so the capsule is already crouched

    // 2. Special modes (Tasks 6 mantle, 8 zip line, 10 grind) run here and return early.

    // 3. Locomotion: ground or air acceleration toward the wish direction (a slide drives itself in step 9).
    if (this.state.mode !== 'slide') this.applyLocomotion(input, mods);

    // 4. Jump (buffer + coyote).
    if (tryJump(this.state, input, this.cfg, mods, this.dt)) events.push({ kind: 'jumped' });

    // 5–7. Gravity, speed cap, collide-and-slide move.
    const move = this.integrateAndMove();

    // 8. Landing, air timers and apex tracking.
    this.resolveContacts(move, events);

    // 9. Post-move checks: slide physics and end (Task 5); Tasks 7 wall-run and 9 triggers run here too.
    updateSlide(this.state, move, input, this.cfg, this.dt);

    return events;
  }

  private updateLookAndTimers(input: InputFrame): void {
    this.state.yaw = input.look.yaw;
    this.state.pitch = input.look.pitch;
    ageJumpBuffer(this.state, input, this.cfg);
  }

  /**
   * The capsule is crouched while crouch is held (a chute slide needs no crouch). Releasing crouch stands up only
   * if a standing capsule fits (Review Focus 4); otherwise the player stays crouched (and a crouch-slide goes on)
   * and tries again every tick, so they stand automatically once clear.
   */
  private updateCrouch(input: InputFrame): void {
    this.body.setCrouched(input.crouch.held);
    this.state.crouched = this.body.crouched;
  }

  private applyLocomotion(input: InputFrame, mods: StatModifiers): void {
    const s = this.state;
    const wish = wishDirection(input);
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
    const vy0 = s.velocity.y;
    const dy = vy0 * dt - 0.5 * cfg.gravity * dt * dt;
    s.velocity = clampHorizontal(vec3(s.velocity.x, vy0 - cfg.gravity * dt, s.velocity.z), cfg.speedCap);
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
      if (s.mode !== 'slide') s.mode = 'ground';
      s.velocity = vec3(s.velocity.x, 0, s.velocity.z);
      s.groundNormal = move.groundNormal;
      s.lastGrounded = vec3(s.position.x, s.position.y, s.position.z);
      s.airTicks = 0;
      s.airApexY = s.position.y;
    } else {
      s.airTicks = wasGrounded ? 0 : s.airTicks + 1;
      s.mode = 'air';
      s.groundNormal = vec3(0, 1, 0);
      s.airApexY = Math.max(s.airApexY, s.position.y);
    }
  }
}
