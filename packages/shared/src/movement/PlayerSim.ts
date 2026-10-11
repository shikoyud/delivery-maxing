import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { clampHorizontal, vec3, type Vec3 } from '../math/vec3';
import type { MapData } from '../world/mapTypes';
import type { PhysicsWorld } from '../world/physicsWorld';
import { PlayerBody, type MoveResult } from './body';
import { alignBoardHeading, applyBoardVelocity, toggleBoard } from './board';
import { applyAirVelocity, applyGroundVelocity, targetGroundSpeed, wishDirection } from './ground';
import { ageJumpBuffer, coyoteTicks, jumpBuffered, tryJump } from './jump';
import { findLedge, startMantle, updateMantle } from './mantle';
import { startSlide, updateSlide } from './slide';
import { applyTriggers, enterAir } from './triggers';
import { tryStartGrind, updateGrind } from './rail';
import { tryAttachZip, updateZip } from './zipLine';
import type { PlayerState, SimEvent, StatModifiers, WorldFeatureState } from './types';
import { canStartWallRun, findWall, startWallRun, updateWallRun, wallJump, wallRunGravityScale } from './wallRun';

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
      boardHeading: yaw,
      crouched: false,
      grounded: false,
      groundNormal: vec3(0, 1, 0),
      lastGrounded: vec3(spawn.x, spawn.y, spawn.z),
      airTicks: coyoteTicks(cfg) + 1,
      jumpPressAge: null,
      airApexY: spawn.y,
      mantle: null,
      wallRun: { time: 0, normal: null, lastNormal: null },
      zip: null,
      grind: null,
      boostLeft: 0,
      padCooldown: {},
    };
  }

  /** Places the player at `position` (airborne, no coyote jump, no buffered press). */
  teleport(position: Vec3, velocity: Vec3 = vec3(0, 0, 0)): void {
    this.body.setFeet(position);
    const s = this.state;
    s.position = this.body.feet;
    s.velocity = vec3(velocity.x, velocity.y, velocity.z);
    s.jumpPressAge = null;
    enterAir(s, this.cfg);
  }

  /** One tick: movement (all modes), then pads, orbs and out-of-bounds respawn. */
  step(input: InputFrame, mods: StatModifiers, world: WorldFeatureState, time: number): SimEvent[] {
    this.state.boostLeft = Math.max(0, this.state.boostLeft - this.dt);
    const events = this.stepMovement(input, mods);
    events.push(...applyTriggers(this.state, this.body, this.map, world, this.cfg, time));
    return events;
  }

  private stepMovement(input: InputFrame, mods: StatModifiers): SimEvent[] {
    const events: SimEvent[] = [];

    // 1. Look and timers; crouch (stays crouched while standing is blocked; ignored on the board); board toggle (Q);
    //    crouch-slide entry (never on the board).
    this.updateLookAndTimers(input);
    this.updateCrouch(input);
    if (input.board.pressed && toggleBoard(this.state)) events.push({ kind: 'boardToggled', onBoard: this.state.onBoard });
    startSlide(this.state, input, this.cfg); // crouch is pressed, so the capsule is already crouched

    // 2. Special modes run here and return early: mantle (Task 6); zip line (Task 8); grind rail (Task 10).
    //    Ledge detection runs before the move, so the stored horizontal velocity is the approach velocity
    //    (a blocking move would already have removed the part into the ledge face).
    if (this.tryZip(input, mods, events)) return events;
    if (this.tryGrind(input, mods)) return events;
    if (this.tryMantle(input)) return events;

    // 3. Wall-run: a buffered jump wall-jumps off the wall; otherwise the run holds to the wall (or ends).
    //    Locomotion: ground or air acceleration toward the wish direction. A slide drives itself in step 9 and a
    //    wall-run drives itself here; a wall-jump tick keeps its launch velocity.
    if (this.state.mode === 'wallrun' && jumpBuffered(this.state, this.cfg)) {
      wallJump(this.state, this.cfg, mods);
      events.push({ kind: 'jumped' });
    } else {
      if (this.state.mode === 'wallrun') updateWallRun(this.state, this.body, input, this.cfg, this.dt);
      if (this.state.mode !== 'slide' && this.state.mode !== 'wallrun') this.applyLocomotion(input, mods);

      // 4. Jump (buffer + coyote).
      if (tryJump(this.state, input, this.cfg, mods, this.dt)) events.push({ kind: 'jumped' });
    }

    // 5–7. Gravity, speed cap, collide-and-slide move.
    const move = this.integrateAndMove();

    // 8. Landing, air timers and apex tracking.
    this.resolveContacts(move, events);

    // 9. Post-move checks: slide physics and end (Task 5), wall-run start (Task 7); triggers run after this method (step).
    if (!this.state.onBoard) updateSlide(this.state, move, input, this.cfg, this.dt); // a board rolls itself (chutes too)
    this.tryStartWallRun(input);

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
      const canStart = !s.onBoard && input.move.y > 0 && (s.mode === 'ground' || s.mode === 'air');
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
   * Advances a zip line ride, or attaches when interact is pressed near a line (on the board too: attaching puts the
   * board away and emits boardToggled). While riding the body is placed on the line directly (no collisions). Returns true when this step was a ride step (the rest of the step is
   * skipped); the tick that detaches is a ride step too.
   */
  private tryZip(input: InputFrame, mods: StatModifiers, events: SimEvent[]): boolean {
    const s = this.state;
    if (s.mode !== 'zipline') {
      const canAttach = s.mode === 'ground' || s.mode === 'air' || s.mode === 'slide' || s.mode === 'wallrun';
      const wasOnBoard = s.onBoard;
      if (!canAttach || !tryAttachZip(s, input, this.map.zipLines, this.cfg)) return false;
      if (wasOnBoard) events.push({ kind: 'boardToggled', onBoard: false }); // attaching put the board away
    }
    const line = this.map.zipLines.find((l) => l.id === s.zip?.id);
    if (line) updateZip(s, line, input, this.cfg, mods, this.dt);
    else {
      s.zip = null;
      s.mode = 'air';
    }
    this.body.setFeet(s.position);
    s.position = this.body.feet;
    return true;
  }

  /**
   * Advances a grind in progress, or starts one when airborne and falling onto a rail. While grinding the body is
   * placed on the rail directly (no collisions). Returns true when this step was a grind step (the rest of the step
   * is skipped); the tick that detaches is a grind step too.
   */
  private tryGrind(input: InputFrame, mods: StatModifiers): boolean {
    const s = this.state;
    if (s.mode !== 'grind' && !tryStartGrind(s, this.map.rails, this.cfg)) return false;
    const rail = this.map.rails.find((r) => r.id === s.grind?.id);
    if (rail) updateGrind(s, rail, input, this.cfg, mods, this.dt);
    else enterAir(s, this.cfg);
    this.body.setFeet(s.position);
    s.position = this.body.feet;
    return true;
  }

  /** Starts a wall-run when airborne beside a wall that passes canStartWallRun. */
  private tryStartWallRun(input: InputFrame): void {
    const s = this.state;
    if (s.mode !== 'air' || s.grounded || s.onBoard) return;
    const normal = findWall(this.body, s, this.cfg);
    if (normal && canStartWallRun(s, normal, input, this.cfg)) startWallRun(s, normal, this.cfg);
  }

  private updateLookAndTimers(input: InputFrame): void {
    this.state.yaw = input.look.yaw;
    this.state.pitch = input.look.pitch;
    ageJumpBuffer(this.state, input, this.cfg);
  }

  /**
   * The capsule is crouched while crouch is held (a chute slide needs no crouch). Releasing crouch stands up only
   * if a standing capsule fits (Review Focus 4); otherwise the player stays crouched (and a crouch-slide goes on)
   * and tries again every tick, so they stand automatically once clear. On the board crouch is ignored.
   */
  private updateCrouch(input: InputFrame): void {
    this.body.setCrouched(input.crouch.held && !this.state.onBoard);
    this.state.crouched = this.body.crouched;
  }

  private applyLocomotion(input: InputFrame, mods: StatModifiers): void {
    const s = this.state;
    if (s.onBoard && s.grounded) {
      applyBoardVelocity(s, input, this.cfg, mods, this.dt);
      return;
    }
    const wish = wishDirection(input);
    const target = targetGroundSpeed(input, s, this.cfg, mods);
    if (s.grounded) applyGroundVelocity(s, wish, target, this.cfg, this.dt);
    else applyAirVelocity(s, wish, target, this.cfg, this.dt);
  }

  /**
   * Gravity is integrated exactly for a constant acceleration (dy = vy·dt − ½·g·dt²), so the jump apex
   * is exact at any tick rate. Snap-to-ground is only enabled while not moving up. A wall-run scales gravity.
   */
  private integrateAndMove(): MoveResult {
    const s = this.state;
    const { dt, cfg } = this;
    const g = cfg.gravity * wallRunGravityScale(s, cfg);
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
      // An air or wall-run landing changes the mode: a slide stays a slide (mantle steps never reach here).
      if (s.mode === 'air' || s.mode === 'wallrun') s.mode = 'ground';
      // A board landing points the board along the landing travel (air control may have turned it).
      if (!wasGrounded && s.onBoard) alignBoardHeading(s);
      // Landing unlocks every wall for wall-running again.
      s.wallRun = { time: 0, normal: null, lastNormal: null };
      s.velocity = vec3(s.velocity.x, 0, s.velocity.z);
      s.groundNormal = move.groundNormal;
      s.lastGrounded = vec3(s.position.x, s.position.y, s.position.z);
      s.airTicks = 0;
      s.airApexY = s.position.y;
    } else {
      s.airTicks = wasGrounded ? 0 : s.airTicks + 1;
      // Leaving the ground on foot (or mid-slide) goes airborne; a wall-run keeps its own mode until it ends.
      if (s.mode === 'ground' || s.mode === 'slide') s.mode = 'air';
      s.groundNormal = vec3(0, 1, 0);
      s.airApexY = Math.max(s.airApexY, s.position.y);
    }
  }
}
