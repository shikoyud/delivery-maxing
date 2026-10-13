import type { MovementConfig } from '../config/types';
import { vec3 } from '../math/vec3';
import type { MapData } from '../world/mapTypes';
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

/** Out-of-bounds respawn. Called after the move each tick. */
export function applyTriggers(state: PlayerState, body: PlayerBody, map: MapData, cfg: MovementConfig): SimEvent[] {
  const feet = state.position;
  const limit = map.size / 2 + cfg.fall.boundsMargin;
  if (feet.y < cfg.fall.outOfBoundsY || Math.abs(feet.x) > limit || Math.abs(feet.z) > limit) {
    return [respawn(state, body, map, cfg)];
  }
  return [];
}

/** Teleports to the map spawn (stopgap: the nearest hospital replaces this once the map has hospitals). */
function respawn(state: PlayerState, body: PlayerBody, map: MapData, cfg: MovementConfig): SimEvent {
  body.setFeet(map.spawn);
  state.position = body.feet;
  state.velocity = vec3(0, 0, 0);
  enterAir(state, cfg);
  state.jumpPressAge = null;
  return { kind: 'respawned', hospitalId: 'spawn' };
}
