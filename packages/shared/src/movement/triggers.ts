import type { MovementConfig } from '../config/types';
import { distance, vec3 } from '../math/vec3';
import type { MapData } from '../world/mapTypes';
import type { PlayerBody } from './body';
import { coyoteTicks } from './jump';
import type { PlayerState, SimEvent, WorldFeatureState } from './types';

/** Height (m) of a jump pad's trigger cylinder. */
const PAD_HEIGHT = 0.5;

export function createWorldFeatureState(map: MapData): WorldFeatureState {
  const orbAvailableAt = new Map<string, number>();
  for (const orb of map.boostOrbs) orbAvailableAt.set(orb.id, 0);
  return { orbAvailableAt };
}

/** Jump pads, boost orbs, then out-of-bounds respawn. Called after the move each tick. */
export function applyTriggers(
  state: PlayerState,
  body: PlayerBody,
  map: MapData,
  world: WorldFeatureState,
  cfg: MovementConfig,
  time: number,
): SimEvent[] {
  const events: SimEvent[] = [];
  const dt = 1 / cfg.tickRate;
  const feet = state.position;

  for (const id of Object.keys(state.padCooldown)) {
    state.padCooldown[id] = Math.max(0, (state.padCooldown[id] ?? 0) - dt);
  }

  for (const pad of map.jumpPads) {
    const inside =
      Math.hypot(feet.x - pad.position.x, feet.z - pad.position.z) <= pad.radius &&
      feet.y >= pad.position.y - cfg.controller.offset &&
      feet.y <= pad.position.y + PAD_HEIGHT;
    if (!inside || (state.padCooldown[pad.id] ?? 0) > 0) continue;
    state.velocity = vec3(pad.launch.x, pad.launch.y, pad.launch.z);
    state.mode = 'air';
    state.grounded = false;
    state.groundNormal = vec3(0, 1, 0);
    state.airApexY = feet.y;
    state.airTicks = coyoteTicks(cfg) + 1; // a pad launch is not followed by a free coyote jump
    state.padCooldown[pad.id] = cfg.jumpPad.retriggerCooldown;
    events.push({ kind: 'jumpPad', padId: pad.id });
  }

  const centre = vec3(feet.x, feet.y + 1, feet.z);
  for (const orb of map.boostOrbs) {
    if (time < (world.orbAvailableAt.get(orb.id) ?? 0)) continue;
    if (distance(centre, orb.position) > cfg.boostOrb.radius + cfg.capsule.radius) continue;
    state.boostLeft = cfg.boostOrb.duration;
    world.orbAvailableAt.set(orb.id, time + cfg.boostOrb.respawnTime);
    events.push({ kind: 'orbCollected', orbId: orb.id });
  }

  const limit = map.size / 2 + cfg.fall.boundsMargin;
  if (feet.y < cfg.fall.outOfBoundsY || Math.abs(feet.x) > limit || Math.abs(feet.z) > limit) {
    events.push(respawn(state, body, map, cfg));
  }
  return events;
}

/** Teleports to the checkpoint nearest the last grounded position (or the spawn when the map has none). */
function respawn(state: PlayerState, body: PlayerBody, map: MapData, cfg: MovementConfig): SimEvent {
  let id = 'spawn';
  let target = map.hub.spawn;
  let best = Infinity;
  for (const c of map.checkpoints) {
    const d = distance(c.position, state.lastGrounded);
    if (d < best) {
      best = d;
      id = c.id;
      target = c.position;
    }
  }
  body.setFeet(target);
  state.position = body.feet;
  state.velocity = vec3(0, 0, 0);
  state.mode = 'air';
  state.grounded = false;
  state.groundNormal = vec3(0, 1, 0);
  state.airTicks = coyoteTicks(cfg) + 1;
  state.airApexY = target.y;
  state.jumpPressAge = null;
  state.mantle = null;
  state.zip = null;
  state.wallRun = { time: 0, normal: null, lastNormal: null };
  // Task 10: also clear grind state here.
  return { kind: 'respawned', checkpointId: id };
}
