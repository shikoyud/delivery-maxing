import type { MovementConfig } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { add, closestOnSegment, dot, length, normalize, scale, sub, vec3, type Vec3 } from '../math/vec3';
import type { ZipLine } from '../world/mapTypes';
import { facing } from './ground';
import { coyoteTicks, jumpVelocity } from './jump';
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

/**
 * Attaches to the nearest line when interact was pressed and the hand point (feet + capsule height) is within
 * zipLine.attachDistance of it. The ride runs toward the lower end; on a level line (|dy| < levelThreshold) it runs
 * toward the end the player faces. The starting speed is max(baseSpeed, velocity · direction).
 * The caller checks the mode (it does not check the board: attaching will put the board away, Task 11). Returns whether the player attached.
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
  const dy = line.b.y - line.a.y;
  let dir: 1 | -1;
  if (Math.abs(dy) < cfg.zipLine.levelThreshold) {
    const f = facing(state.yaw);
    const along = (line.b.x - line.a.x) * f.x + (line.b.z - line.a.z) * f.z;
    dir = along >= 0 ? 1 : -1;
  } else {
    dir = dy < 0 ? 1 : -1;
  }

  const speed = Math.max(cfg.zipLine.baseSpeed, dot(state.velocity, rideDirection(line, dir)));
  state.zip = { id: line.id, s: best.s, dir, speed };
  state.mode = 'zipline';
  state.grounded = false;
  state.groundNormal = vec3(0, 1, 0);
  state.mantle = null;
  state.wallRun = { time: 0, normal: null, lastNormal: null };
  state.jumpPressAge = null;
  return true;
}

/**
 * Advances a ride by dt and sets state.position and state.velocity (the caller moves the body there, ignoring
 * collisions). Speed changes by g·sinθ·dt (sinθ is the downhill share of the ride direction) and stays within
 * [baseSpeed, min(maxSpeed × speedMul, speedCap)]. The ride ends at the end of the line, or when jump is pressed (which also adds
 * jumpVelocity); the player is then airborne with the ride velocity and a fresh fall-height apex.
 */
export function updateZip(
  state: PlayerState,
  line: ZipLine,
  input: InputFrame,
  cfg: MovementConfig,
  mods: StatModifiers,
  dt: number,
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
  if (!atEnd) state.velocity = vec3(state.velocity.x, state.velocity.y + jumpVelocity(cfg, mods), state.velocity.z);
  state.zip = null;
  state.mode = 'air';
  state.grounded = false;
  state.groundNormal = vec3(0, 1, 0);
  state.airApexY = state.position.y;
  state.jumpPressAge = null;
  state.airTicks = coyoteTicks(cfg) + 1; // no free coyote jump after a ride
  return 'detached';
}
