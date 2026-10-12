import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { add, closestOnSegment, dot, length, normalize, scale, sub, vec3, type Vec3 } from '../math/vec3';
import type { ZipLine } from '../world/mapTypes';
import type { PlayerBody } from './body';
import { facing } from './ground';
import { jumpVelocity } from './jump';
import { enterAir } from './triggers';
import type { PlayerState, StatModifiers } from './types';

/** Unit vector along the line from a to b. */
const lineDir = (line: ZipLine): Vec3 => normalize(sub(line.b, line.a));
const lineLength = (line: ZipLine): number => length(sub(line.b, line.a));
const pointAt = (line: ZipLine, s: number): Vec3 => add(line.a, scale(lineDir(line), s));

/** Unit ride direction (3D) for a ride along `line` in direction `dir` (+1 toward b, -1 toward a). */
const rideDirection = (line: ZipLine, dir: 1 | -1): Vec3 => scale(lineDir(line), dir);

/** Feet position for a given distance along the line: the player hangs hangDrop below it. */
function feetAt(line: ZipLine, s: number, cfg: MovementConfig): Vec3 {
  const p = pointAt(line, s);
  return vec3(p.x, p.y - cfg.zipLine.hangDrop, p.z);
}

/** |cos| between the courier's facing and the line (horizontally) below which the facing does not pick an end. */
const FACING_TIE = 0.1;
/** Horizontal speed (m/s) along the line below which the velocity does not pick an end either. */
const VELOCITY_TIE = 0.1;

/**
 * Ride direction for attaching to `line`: toward the end the courier faces (the sign of facing(heading) · (b − a),
 * horizontally). When the facing is across the line (|cos| < FACING_TIE) the horizontal velocity along the line
 * decides, and failing that the ride runs toward the lower end.
 */
function attachDirection(state: PlayerState, line: ZipLine): 1 | -1 {
  const dx = line.b.x - line.a.x;
  const dz = line.b.z - line.a.z;
  const h = Math.hypot(dx, dz);
  if (h > 0) {
    const f = facing(state.heading);
    const along = (f.x * dx + f.z * dz) / h;
    if (Math.abs(along) >= FACING_TIE) return along > 0 ? 1 : -1;
    const v = (state.velocity.x * dx + state.velocity.z * dz) / h;
    if (Math.abs(v) >= VELOCITY_TIE) return v > 0 ? 1 : -1;
  }
  return line.b.y <= line.a.y ? 1 : -1;
}

/**
 * Attaches to the nearest line when interact was pressed and the hand point (feet + capsule height) is within
 * zipLine.attachDistance of it. Lines are two-way: the ride runs toward the end the courier faces (attachDirection).
 * The starting speed is max(baseSpeed, velocity · direction).
 * The caller checks the mode. Attaching works on the board too and puts the board away (onBoard false; the caller
 * emits boardToggled). Returns whether the player attached.
 */
export function tryAttachZip(state: PlayerState, input: InputFrame, lines: ZipLine[], cfg: MovementConfig): boolean {
  if (!input.interact.pressed) return false;
  const hand = vec3(state.position.x, state.position.y + cfg.capsule.height, state.position.z);

  let best: { line: ZipLine; s: number; dist: number } | null = null;
  for (const line of lines) {
    const hit = closestOnSegment(hand, line.a, line.b);
    if (hit.dist <= cfg.zipLine.attachDistance && (!best || hit.dist < best.dist)) {
      best = { line, s: hit.s, dist: hit.dist };
    }
  }
  if (!best) return false;

  const { line } = best;
  const dir = attachDirection(state, line);
  const speed = Math.max(cfg.zipLine.baseSpeed, dot(state.velocity, rideDirection(line, dir)));
  state.zip = { id: line.id, s: best.s, dir, speed };
  state.mode = 'zipline';
  state.onBoard = false;
  state.grounded = false;
  state.groundNormal = vec3(0, 1, 0);
  state.mantle = null;
  state.wallRun = { time: 0, normal: null, lastNormal: null };
  state.jumpPressAge = null;
  return true;
}

/**
 * Feet on a standing surface under the cable point `p`: the first surface within zipLine.dismountReach straight down
 * that is walkable (no steeper than controller.maxSlopeClimbDeg) and where a standing capsule fits, else null.
 */
function dismountSpot(p: Vec3, body: PlayerBody, cfg: MovementConfig): { feet: Vec3; normal: Vec3 } | null {
  const hit = body.castRay(p, vec3(0, -1, 0), cfg.zipLine.dismountReach);
  if (!hit || hit.normal.y < Math.cos((cfg.controller.maxSlopeClimbDeg * Math.PI) / 180)) return null;
  return body.fitsAt(hit.point, false) ? { feet: hit.point, normal: hit.normal } : null;
}

/**
 * Advances a ride by dt and sets state.position and state.velocity (the caller moves the body there, ignoring
 * collisions). Speed changes by g·sinθ·dt (sinθ is the downhill share of the ride direction) and stays within
 * [baseSpeed, min(maxSpeed × speedMul, speedCap)], so an uphill ride holds at baseSpeed.
 * Jump lets go mid-line (adding jumpVelocity): airborne with the ride velocity and a fresh fall-height apex.
 * At the end of the line the rider steps off onto a standing surface under the cable end (dismountSpot) with the
 * ride's horizontal velocity, in ground mode with no fall; with none there they let go in the air at the hang point.
 */
export function updateZip(
  state: PlayerState,
  line: ZipLine,
  input: InputFrame,
  cfg: MovementConfig,
  mods: StatModifiers,
  dt: number,
  body: PlayerBody,
): 'riding' | 'detached' {
  const z = state.zip;
  if (!z) return 'detached';
  const ride = rideDirection(line, z.dir);

  const downhill = -ride.y;
  z.speed += cfg.gravity * downhill * dt;
  z.speed = Math.min(Math.max(z.speed, cfg.zipLine.baseSpeed), Math.min(cfg.zipLine.maxSpeed * mods.speedMul, cfg.speedCap));
  z.s += z.dir * z.speed * dt;

  const len = lineLength(line);
  const atEnd = z.s >= len || z.s <= 0;
  z.s = Math.min(Math.max(z.s, 0), len);
  state.position = feetAt(line, z.s, cfg);
  state.velocity = scale(ride, z.speed);

  if (!atEnd && !input.jump.pressed) return 'riding';
  const spot = atEnd ? dismountSpot(pointAt(line, z.s), body, cfg) : null;
  if (spot) {
    dismount(state, spot.feet, spot.normal);
    return 'detached';
  }
  if (!atEnd) state.velocity = vec3(state.velocity.x, state.velocity.y + jumpVelocity(cfg, mods), state.velocity.z);
  enterAir(state, cfg); // fresh fall-height apex at the hang point; no free coyote jump after a ride
  state.jumpPressAge = null;
  return 'detached';
}

/** Stands the rider on `feet` with the ride's horizontal velocity, as if they had been grounded there all along. */
function dismount(state: PlayerState, feet: Vec3, normal: Vec3): void {
  state.zip = null;
  state.mode = 'ground';
  state.position = vec3(feet.x, feet.y, feet.z);
  state.velocity = vec3(state.velocity.x, 0, state.velocity.z);
  state.grounded = true;
  state.groundNormal = vec3(normal.x, normal.y, normal.z);
  state.lastGrounded = vec3(feet.x, feet.y, feet.z);
  state.airTicks = 0;
  state.airApexY = feet.y;
  state.wallRun = { time: 0, normal: null, lastNormal: null };
  state.wallChainStartY = null;
  state.jumpPressAge = null;
}
