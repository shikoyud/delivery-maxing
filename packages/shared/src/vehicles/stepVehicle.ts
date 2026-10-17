import type { RideSpec } from '../config/types';
import type { InputFrame } from '../input/inputFrame';
import { vec3, type Vec3 } from '../math/vec3';
import type { MoveResult } from '../movement/kinematicMover';
import type { SimEvent } from '../movement/types';
import type { MapData } from '../world/mapTypes';
import { facing } from '../movement/ground';
import { clipToAccess } from './accessClip';
import { applyDrive, driveInput, vehicleTopSpeed } from './drive';
import { burnFuel } from './fuel';
import type { VehicleState } from './types';
import type { VehicleBody } from './VehicleBody';

/** Minimum blocked distance (m) before a wall contact or access edge removes velocity. */
const BLOCK_EPS = 1e-4;

export interface VehicleStepContext {
  map: MapData;
  spec: RideSpec;
  gravity: number;
  dt: number;
  /** Wall impacts above this speed (m/s) emit `crashed` (ordersConfig.fragile.crashSpeed). */
  crashSpeed: number;
  /**
   * The jump of a ride with a `jumpHeight` (the skateboard ollie, Decision 10), from PlayerSim's on-foot timers:
   * `pressAge` is the ticks since a buffered Space press (null when none; PlayerSim expires it past the jump buffer),
   * `coyote` is true while the ride left the ground no more than the coyote window ago. Absent: no jump.
   */
  jump?: { pressAge: number | null; coyote: boolean };
}

/**
 * One fixed step of a ridden vehicle: drive (grounded only; no air control) → tryTurn (a blocked turn keeps the
 * old heading) → jump (a ride with a jumpHeight, grounded or within coyote, with a buffered press) → gravity → clipToAccess → body.move → remove blocked velocity (walls and access edges) → crash
 * check → landing → fuel burn. Mutates `v`; returns this step's events.
 */
export function stepVehicle(v: VehicleState, body: VehicleBody, input: InputFrame, ctx: VehicleStepContext): SimEvent[] {
  const events: SimEvent[] = [];
  const { dt, gravity } = ctx;
  const arriving = v.velocity;
  const startX = v.position.x;
  const startZ = v.position.z;
  const fuelBefore = v.fuel;

  // 1. Drive.
  const delta = v.grounded ? applyDrive(v, driveInput(input, ctx.spec), ctx.spec, vehicleTopSpeed(v), gravity, dt) : 0;

  // 2. Turn the collider by the steer: a turn the collider has no room for is refused and the heading stays. No
  //    turn in the air.
  if (delta !== 0) v.heading = body.tryTurn(delta);

  // 3. Jump: take-off speed sqrt(2·g·jumpHeight) up, the horizontal velocity kept. The caller consumes the press.
  const jumpHeight = ctx.spec.jumpHeight;
  if (jumpHeight !== null && ctx.jump && ctx.jump.pressAge !== null && (v.grounded || ctx.jump.coyote)) {
    v.velocity = vec3(v.velocity.x, Math.sqrt(2 * gravity * jumpHeight), v.velocity.z);
    v.grounded = false;
    v.airApexY = v.position.y;
    events.push({ kind: 'jumped' });
  }

  // 4. Gravity, integrated exactly for a constant acceleration (as PlayerSim does).
  const vy0 = v.velocity.y;
  const dy = vy0 * dt - 0.5 * gravity * dt * dt;
  v.velocity = vec3(v.velocity.x, vy0 - gravity * dt, v.velocity.z);
  const wanted = vec3(v.velocity.x * dt, dy, v.velocity.z * dt);

  // 5. Access walls. The event fires once per arrival, not on every tick the vehicle is held against the edge: a
  //    vehicle blocked last tick starts this one with no velocity across the edge (step 7 removed it) and, resting
  //    at the edge, clips to no movement across it.
  const clip = clipToAccess(ctx.map, v.tier, v.position, wanted, accessProbes(ctx.spec, v.heading));
  if (clip.zone && clip.normal) {
    const n = clip.normal;
    const wasMovingIn = -(arriving.x * n.x + arriving.z * n.z) > BLOCK_EPS;
    const advanced = -(clip.move.x * n.x + clip.move.z * n.z) > BLOCK_EPS;
    if (wasMovingIn || advanced) events.push({ kind: 'accessBlocked', zone: clip.zone.kind });
  }

  // 6. Collide-and-slide move.
  const desired = clip.move;
  const move = body.move(desired, v.velocity.y <= 0);
  v.position = body.feet;

  // 7–8. Remove velocity into walls and the access edge; a fast wall impact is a crash.
  const impact = removeBlockedVelocity(v, move, desired, clip.normal);
  if (impact > ctx.crashSpeed) events.push({ kind: 'crashed', speed: impact });

  // 9. Landing and apex tracking.
  resolveLanding(v, move, events);

  // 10. Fuel burn by the horizontal distance actually moved; the tank running dry is announced once.
  v.fuel = burnFuel(v.fuel, Math.hypot(v.position.x - startX, v.position.z - startZ), ctx.spec);
  if (fuelBefore > 0 && v.fuel <= 0) events.push({ kind: 'fuelEmpty', tier: v.tier });

  return events;
}

/** Nose and tail of a lengthwise collider, relative to the feet, so access walls stop its ends rather than its centre. */
function accessProbes(spec: RideSpec, heading: number): Vec3[] {
  if (spec.collider.shape !== 'lengthwise') return [];
  const reach = spec.collider.halfLength + spec.collider.radius;
  const f = facing(heading);
  return [vec3(f.x * reach, 0, f.z * reach), vec3(-f.x * reach, 0, -f.z * reach)];
}

/**
 * Removes horizontal velocity into walls and too-steep contacts (step edges, curbs) the move was actually stopped
 * by (auto-steps are not blocks) and into the access edge. Returns the largest speed into a blocking wall (0 when none); access edges never count as impacts.
 */
function removeBlockedVelocity(v: VehicleState, move: MoveResult, desired: Vec3, accessNormal: Vec3 | null): number {
  let { x, z } = v.velocity;
  let impact = 0;
  for (const n of [...move.wallNormals, ...move.steepNormals]) {
    const l = Math.hypot(n.x, n.z);
    if (l === 0) continue;
    const nx = n.x / l;
    const nz = n.z / l;
    const blocked = (move.movement.x - desired.x) * nx + (move.movement.z - desired.z) * nz;
    const into = x * nx + z * nz;
    if (blocked > BLOCK_EPS && into < 0) {
      impact = Math.max(impact, -into);
      x -= nx * into;
      z -= nz * into;
    }
  }
  if (accessNormal) {
    const into = x * accessNormal.x + z * accessNormal.z;
    if (into < 0) {
      x -= accessNormal.x * into;
      z -= accessNormal.z * into;
    }
  }
  v.velocity = vec3(x, v.velocity.y, z);
  return impact;
}

function resolveLanding(v: VehicleState, move: MoveResult, events: SimEvent[]): void {
  const wasGrounded = v.grounded;
  const grounded = move.grounded && v.velocity.y <= 0;
  v.grounded = grounded;
  if (grounded) {
    if (!wasGrounded) events.push({ kind: 'landed', fallHeight: Math.max(v.airApexY, v.position.y) - v.position.y });
    v.velocity = vec3(v.velocity.x, 0, v.velocity.z);
    v.groundNormal = move.groundNormal;
    v.airApexY = v.position.y;
  } else {
    v.groundNormal = vec3(0, 1, 0);
    v.airApexY = Math.max(v.airApexY, v.position.y);
  }
}
