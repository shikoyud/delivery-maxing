import type { MovementConfig } from '../config/types';
import { lerpVec3, vec3, type Vec3 } from '../math/vec3';
import { WALL_MAX_NY, type PlayerBody } from './body';
import { facing } from './ground';
import type { MantleState, PlayerState } from './types';

export type { MantleState };

/** Height above the feet of the forward (wall) probe. */
const WALL_PROBE_HEIGHT = 1.0;
/** Extra distance past the capsule radius at which the top is probed (and the player ends up). */
const TOP_PROBE_INSET = 0.1;
/** The down probe starts this far above the highest mantle-able top, and reaches this far below the lowest. */
const TOP_PROBE_MARGIN = 0.1;
const TOP_PROBE_EXTRA = 0.2;
/**
 * Slack on the height window for Rapier's float32 geometry (a 1.5 m top reads as 1.50000005), so the window's
 * edges behave as written: a 1.5 m ledge mantles, a 0.4 m curb is left to autostep.
 */
const HEIGHT_EPS = 1e-3;
/** Ground probe for the height base: starts this far above the feet and reaches the same distance below them. */
const BASE_PROBE = 0.1;
/** The rise takes this fraction of the mantle; the rest moves forward onto the top. */
const RISE_FRACTION = 0.6;

/**
 * Looks for a mantle-able ledge straight ahead. Returns the feet position on top of the ledge, or null.
 * 1. A ray forward from feet + 1.0 m, over radius + mantle.reach, must hit a wall face (|n.y| < 0.3).
 * 2. A ray down from hit + forward·(radius + 0.1), starting at feet.y + maxHeight + 0.1 and reaching maxHeight + 0.2,
 *    finds the top.
 * 3. The top must be in (minHeight, maxHeight] above the feet (the ground under them when grounded) and a standing capsule must fit there.
 * The caller checks the mode, the board and forward input.
 */
export function findLedge(body: PlayerBody, state: PlayerState, cfg: MovementConfig): Vec3 | null {
  const { radius } = cfg.capsule;
  const { minHeight, maxHeight, reach } = cfg.mantle;
  const feet = state.position;
  const fwd = facing(state.yaw);

  const wall = body.castRay(vec3(feet.x, feet.y + WALL_PROBE_HEIGHT, feet.z), fwd, radius + reach);
  if (!wall || Math.abs(wall.normal.y) >= WALL_MAX_NY) return null;

  const inset = radius + TOP_PROBE_INSET;
  const startY = feet.y + maxHeight + TOP_PROBE_MARGIN;
  const down = body.castRay(
    vec3(wall.point.x + fwd.x * inset, startY, wall.point.z + fwd.z * inset),
    vec3(0, -1, 0),
    maxHeight + TOP_PROBE_EXTRA,
  );
  // A zero-distance hit means the probe started inside geometry: the obstacle is too tall.
  if (!down || down.distance <= 0) return null;

  const rise = down.point.y - baseHeight(body, state);
  if (rise <= minHeight + HEIGHT_EPS || rise > maxHeight + HEIGHT_EPS) return null;
  const top = down.point;
  return body.fitsAt(top, false) ? top : null;
}

/**
 * Height the ledge is measured from. Grounded, it is the ground under the feet: the controller lets the feet
 * settle up to controller.offset below the contact, which would otherwise make a 1.5 m ledge read as 1.51 m.
 * Airborne (or with no ground found), it is the feet.
 */
function baseHeight(body: PlayerBody, state: PlayerState): number {
  const feet = state.position;
  if (!state.grounded) return feet.y;
  const ground = body.castRay(vec3(feet.x, feet.y + BASE_PROBE, feet.z), vec3(0, -1, 0), 2 * BASE_PROBE);
  return ground ? ground.point.y : feet.y;
}

/** Starts a mantle from the current feet to `top`, storing the current horizontal velocity. */
export function startMantle(state: PlayerState, top: Vec3): void {
  state.mantle = {
    from: vec3(state.position.x, state.position.y, state.position.z),
    to: vec3(top.x, top.y, top.z),
    t: 0,
    horizontalVelocity: vec3(state.velocity.x, 0, state.velocity.z),
  };
  state.mode = 'mantle';
  state.grounded = false;
  state.velocity = vec3(0, 0, 0);
}

/**
 * Advances the mantle by dt and sets state.position (the caller moves the body there, ignoring collisions).
 * For the first 60 % of mantle.duration the feet rise to top.y; for the last 40 % they move forward onto the top.
 * Returns true when the mantle finishes: the player is then on the top in ground mode with the stored horizontal
 * velocity restored.
 */
export function updateMantle(state: PlayerState, cfg: MovementConfig, dt: number): boolean {
  const m = state.mantle;
  if (!m) return true;
  m.t += dt;
  const f = cfg.mantle.duration > 0 ? Math.min(1, m.t / cfg.mantle.duration) : 1;
  const raised = vec3(m.from.x, m.to.y, m.from.z);
  state.position =
    f < RISE_FRACTION
      ? lerpVec3(m.from, raised, f / RISE_FRACTION)
      : lerpVec3(raised, m.to, (f - RISE_FRACTION) / (1 - RISE_FRACTION));
  if (f < 1) return false;

  state.position = vec3(m.to.x, m.to.y, m.to.z);
  state.velocity = vec3(m.horizontalVelocity.x, 0, m.horizontalVelocity.z);
  state.mode = 'ground';
  state.grounded = true;
  state.groundNormal = vec3(0, 1, 0);
  state.lastGrounded = vec3(m.to.x, m.to.y, m.to.z);
  state.airTicks = 0;
  state.airApexY = m.to.y;
  state.mantle = null;
  return true;
}
