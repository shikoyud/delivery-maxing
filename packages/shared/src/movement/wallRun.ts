import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { horizontalLength, vec3, type Vec3 } from '../math/vec3';
import { WALL_MAX_NY, type PlayerBody } from './body';
import { hasMoveInput, rightOf } from './ground';
import { coyoteTicks, jumpVelocity } from './jump';
import type { PlayerState, StatModifiers } from './types';

/** Height above the feet of the wall probes (waist). */
const WAIST_HEIGHT = 0.9;
const DEG = Math.PI / 180;

/** Horizontal unit normal of a near-vertical face, or null for floors, ceilings and slopes. */
function wallNormal(n: Vec3): Vec3 | null {
  if (Math.abs(n.y) >= WALL_MAX_NY) return null;
  const l = Math.hypot(n.x, n.z);
  return l > 1e-9 ? vec3(n.x / l, 0, n.z / l) : null;
}

/** Casts one waist-height probe along `dir` over radius + wallRun.checkDistance; returns the wall's hit distance and normal. */
function probe(body: PlayerBody, state: PlayerState, cfg: MovementConfig, dir: Vec3): { distance: number; normal: Vec3 } | null {
  const feet = state.position;
  const hit = body.castRay(vec3(feet.x, feet.y + WAIST_HEIGHT, feet.z), dir, cfg.capsule.radius + cfg.wallRun.checkDistance);
  if (!hit) return null;
  const normal = wallNormal(hit.normal);
  return normal ? { distance: hit.distance, normal } : null;
}

/**
 * Casts rays left and right (relative to the courier heading) at waist height (feet + 0.9) over radius + wallRun.checkDistance.
 * Returns the horizontal normal of the nearer near-vertical hit, or null.
 */
export function findWall(body: PlayerBody, state: PlayerState, cfg: MovementConfig): Vec3 | null {
  const r = rightOf(state.heading);
  const right = probe(body, state, cfg, r);
  const left = probe(body, state, cfg, vec3(-r.x, 0, -r.z));
  if (left && (!right || left.distance <= right.distance)) return left.normal;
  return right ? right.normal : null;
}

/**
 * All must hold: airborne (mode 'air') and not on the board; movement input; horizontal speed ≥ minSpeed;
 * the angle between the horizontal velocity and the wall plane ≤ maxApproachAngleDeg; and this is not the wall
 * last run or jumped off (lastNormal null, or dot(normal, lastNormal) < sameWallDot); and the feet are at most
 * wallRun.maxChainRise above the first wall-run start of the current chain (R25: chains keep height, never climb).
 */
export function canStartWallRun(state: PlayerState, normal: Vec3, input: InputFrame, cfg: MovementConfig): boolean {
  const w = cfg.wallRun;
  if (state.grounded || state.mode !== 'air' || state.onBoard) return false;
  if (!hasMoveInput(input)) return false;
  const v = state.velocity;
  const speed = horizontalLength(v);
  if (speed < w.minSpeed || speed === 0) return false;
  const sinAngle = Math.abs(v.x * normal.x + v.z * normal.z) / speed;
  if (Math.asin(Math.min(1, sinAngle)) > w.maxApproachAngleDeg * DEG) return false;
  const chainY = state.wallChainStartY;
  if (chainY !== null && state.position.y > chainY + w.maxChainRise) return false;
  const last = state.wallRun.lastNormal;
  return last === null || normal.x * last.x + normal.z * last.z < w.sameWallDot;
}

/** Keeps the along-wall horizontal velocity and sets the into-wall component to -stickSpeed (vertical unchanged). */
function stickToWall(state: PlayerState, normal: Vec3, cfg: MovementConfig): void {
  const v = state.velocity;
  const into = v.x * normal.x + v.z * normal.z;
  const k = cfg.wallRun.stickSpeed;
  state.velocity = vec3(v.x - normal.x * (into + k), v.y, v.z - normal.z * (into + k));
}

/**
 * Enters a wall-run on the wall with horizontal normal `normal` (the caller checked canStartWallRun). A fall is
 * arrested: vy = max(vy, -wallRun.maxEntryFallSpeed) (R24). The first start since landing begins the chain (R25).
 */
export function startWallRun(state: PlayerState, normal: Vec3, cfg: MovementConfig): void {
  state.mode = 'wallrun';
  state.wallRun = { time: 0, normal, lastNormal: normal };
  state.wallChainStartY ??= state.position.y;
  state.airApexY = state.position.y;
  const v = state.velocity;
  state.velocity = vec3(v.x, Math.max(v.y, -cfg.wallRun.maxEntryFallSpeed), v.z);
  stickToWall(state, normal, cfg);
}

/** Leaves a wall-run into the air (lastNormal keeps the wall locked until landing). */
export function endWallRun(state: PlayerState): void {
  if (state.mode === 'wallrun') state.mode = 'air';
  state.wallRun = { ...state.wallRun, time: 0, normal: null };
}

/**
 * Pre-move wall-run update (mode 'wallrun'). The run ends (back to 'air') when time ≥ wallRun.maxTime, movement
 * input is released, or the wall is lost (a waist probe along -normal finds no near-vertical face). Otherwise the
 * velocity is projected onto the wall plane (along-wall speed kept) and the player is pulled toward the wall at
 * stickSpeed. Gravity is scaled in the integrator (wallRunGravityScale); landing is resolved after the move.
 */
export function updateWallRun(state: PlayerState, body: PlayerBody, input: InputFrame, cfg: MovementConfig, dt: number): void {
  const n = state.wallRun.normal;
  if (state.mode !== 'wallrun' || !n) return;
  state.wallRun.time += dt;
  const hit = probe(body, state, cfg, vec3(-n.x, 0, -n.z));
  if (state.wallRun.time >= cfg.wallRun.maxTime || !hasMoveInput(input) || !hit) {
    endWallRun(state);
    return;
  }
  state.wallRun.normal = hit.normal;
  stickToWall(state, hit.normal, cfg);
}

/**
 * Gravity multiplier for this step. While wall-running and not rising, gravity is scaled by wallRun.gravityScale;
 * upward velocity (the rest of a jump) decays at full gravity so a wall-run never climbs higher than the jump.
 */
export function wallRunGravityScale(state: PlayerState, cfg: MovementConfig): number {
  return state.mode === 'wallrun' && state.velocity.y <= 0 ? cfg.wallRun.gravityScale : 1;
}

/**
 * Jumps off the wall being run: velocity = alongWall + normal·wallJumpPush + up·jumpVelocity(cfg, mods).
 * Consumes the buffered press, leaves the run into the air and sets lastNormal to the wall's normal.
 */
export function wallJump(state: PlayerState, cfg: MovementConfig, mods: StatModifiers): void {
  const n = state.wallRun.normal;
  if (!n) return;
  const v = state.velocity;
  const into = v.x * n.x + v.z * n.z;
  const push = cfg.wallRun.wallJumpPush;
  state.velocity = vec3(v.x - n.x * into + n.x * push, jumpVelocity(cfg, mods), v.z - n.z * into + n.z * push);
  state.mode = 'air';
  state.grounded = false;
  state.wallRun = { time: 0, normal: null, lastNormal: n };
  state.jumpPressAge = null;
  state.airTicks = coyoteTicks(cfg) + 1;
  state.airApexY = state.position.y;
}
