import type { MovementConfig } from '../config/types';
import { vec3 } from '../math/vec3';
import { nearestHospital } from '../world/hospitals';
import type { Garage } from '../vehicles/Garage';
import type { Hospital, MapData } from '../world/mapTypes';
import type { PlayerBody } from './body';
import { coyoteTicks } from './jump';
import type { PlayerState, SimEvent } from './types';

/**
 * Puts the player into free airborne motion at their current position: clears the mantle, ends grounding, and
 * closes the coyote window. Shared by teleport and respawn. Velocity and jump buffer are left to the caller.
 */
export function enterAir(state: PlayerState, cfg: MovementConfig): void {
  state.mantle = null;
  state.mode = 'air';
  state.grounded = false;
  state.groundNormal = vec3(0, 1, 0);
  state.airTicks = coyoteTicks(cfg) + 1;
  state.airApexY = state.position.y;
}

/**
 * Out-of-bounds respawn. Called after the move each tick. Riding, the courier also gets off and the vehicle is towed
 * to the same hospital's bay (Decision 6): `respawned` then `towed`.
 */
export function applyTriggers(state: PlayerState, body: PlayerBody, map: MapData, cfg: MovementConfig, garage: Garage): SimEvent[] {
  const feet = state.position;
  // The greybox island is centred on the origin; the city spans 0..size in x and z.
  const lo = (map.kind === 'city' ? 0 : -map.size / 2) - cfg.fall.boundsMargin;
  const hi = lo + map.size + 2 * cfg.fall.boundsMargin;
  if (feet.y < cfg.fall.outOfBoundsY || feet.x < lo || feet.x > hi || feet.z < lo || feet.z > hi) {
    const hospital = nearestHospital(map, state.lastGrounded);
    const tier = state.riding;
    if (tier) {
      garage.tow(tier, hospital);
      state.riding = null;
      body.setEnabled(true);
    }
    const events: SimEvent[] = [respawn(state, body, cfg, hospital)];
    if (tier) events.push({ kind: 'towed', tier, hospitalId: hospital.id });
    return events;
  }
  return [];
}

/**
 * Teleports to the spawn of `hospital` (the caller picks the one nearest the last grounded position), facing its
 * spawnYaw (courier heading and look yaw; the client turns its camera to match on the `respawned` event).
 */
export function respawn(state: PlayerState, body: PlayerBody, cfg: MovementConfig, hospital: Hospital): SimEvent {
  body.setFeet(hospital.spawn);
  state.position = body.feet;
  state.velocity = vec3(0, 0, 0);
  enterAir(state, cfg);
  state.jumpPressAge = null;
  state.heading = state.yaw = hospital.spawnYaw;
  return { kind: 'respawned', hospitalId: hospital.id };
}
