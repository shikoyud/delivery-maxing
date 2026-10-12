import { beforeAll, describe, expect, it } from 'vitest';
import greyboxJson from '../../../../map/greybox.json';
import { movementConfig } from '../../src/config';
import { emptyInput } from '../../src/input/inputFrame';
import { facing } from '../../src/movement/ground';
import { PlayerSim } from '../../src/movement/PlayerSim';
import { createWorldFeatureState } from '../../src/movement/triggers';
import { NO_MODS } from '../../src/movement/types';
import { expandGreybox } from '../../src/world/greybox';
import type { GreyboxSource, MapData } from '../../src/world/mapTypes';
import { createPhysicsWorld, initRapier, type Rapier } from '../../src/world/physicsWorld';

/**
 * Playtest blocker: on the real map's 600 m ground slab, sprinting across open ground stalled for seconds at a time
 * (9.8 m in 5 s from the plaza instead of ~39 m) and the feet sank 2–5 cm into the slab.
 */
const map: MapData = expandGreybox(greyboxJson as unknown as GreyboxSource);
const SPRINT_TICKS = 5 * movementConfig.tickRate;
/** Sprint 8 m/s for 5 s, less the ~0.13 s acceleration from rest. */
const MIN_DISTANCE = 37;
/** A tick that covers less than this while sprinting on open ground is a stall. */
const STALL_STEP = 0.05;

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initRapier();
});

const hub = map.hub.spawn;
const RUNS: { label: string; x: number; z: number; yaw: number }[] = [
  { label: 'plaza (-30, 8) facing +X', x: -30, z: 8, yaw: -Math.PI / 2 },
  { label: 'HUB spawn facing +Z', x: hub.x, z: hub.z, yaw: Math.PI },
  { label: 'HUB spawn facing +X', x: hub.x, z: hub.z, yaw: -Math.PI / 2 },
  { label: 'street (-150, 50) facing +X', x: -150, z: 50, yaw: -Math.PI / 2 },
  { label: 'street (-150, 50) facing -Z', x: -150, z: 50, yaw: 0 },
  { label: 'hub (0, 0) diagonal', x: 0, z: 0, yaw: Math.PI / 4 },
  { label: '(12, -40) facing +X', x: 12, z: -40, yaw: -Math.PI / 2 },
  { label: '(80, 80) facing -Z', x: 80, z: 80, yaw: 0 },
  { label: '(-200, -120) facing -Z', x: -200, z: -120, yaw: 0 },
];

describe('sprinting across the real map ground', () => {
  it.each(RUNS)('$label covers ≥ 37 m in 5 s, flat and straight, with no stalls or sinking', ({ x, z, yaw }) => {
    const physics = createPhysicsWorld(rapier, map);
    const dir = facing(yaw);
    // Precondition: the 45 m path is open ground (no solid other than the ground slab in the way).
    for (const h of [0.05, 0.5, 1.7]) {
      const hit = physics.world.castRayAndGetNormal(new rapier.Ray({ x, y: h, z }, dir), 45, true);
      expect(hit, `path blocked at height ${h}`).toBeNull();
    }

    const sim = new PlayerSim(physics, map, structuredClone(movementConfig), { x, y: 0, z }, yaw);
    const world = createWorldFeatureState(map);
    const start = sim.state.position;
    let stalls = 0;
    let minFeetY = Infinity;
    let maxFeetY = -Infinity;
    let maxDrift = 0;
    for (let t = 0; t < SPRINT_TICKS; t++) {
      const input = emptyInput();
      input.move.y = 1;
      input.look.yaw = yaw;
      input.sprint.held = true;
      const before = sim.state.position;
      sim.step(input, NO_MODS, world, t / movementConfig.tickRate);
      const p = sim.state.position;
      if (t > 10 && Math.hypot(p.x - before.x, p.z - before.z) < STALL_STEP) stalls++;
      minFeetY = Math.min(minFeetY, p.y);
      if (t > 10) maxFeetY = Math.max(maxFeetY, p.y);
      maxDrift = Math.max(maxDrift, Math.abs((p.x - start.x) * dir.z - (p.z - start.z) * dir.x));
    }
    const p = sim.state.position;
    expect(Math.hypot(p.x - start.x, p.z - start.z)).toBeGreaterThanOrEqual(MIN_DISTANCE);
    expect(stalls).toBe(0);
    expect(minFeetY).toBeGreaterThanOrEqual(-0.01);
    // Flat ground runs flat and straight: no hops off the ground, no sideways drift.
    expect(maxFeetY).toBeLessThanOrEqual(0.003);
    expect(maxDrift).toBeLessThanOrEqual(0.005);
    expect(sim.state.mode).toBe('ground');
  });

  it('sprint-jumping across the plaza lands on the slab without sinking into it', () => {
    const physics = createPhysicsWorld(rapier, map);
    const yaw = -Math.PI / 2;
    const sim = new PlayerSim(physics, map, structuredClone(movementConfig), { x: -30, y: 0, z: 8 }, yaw);
    const world = createWorldFeatureState(map);
    let minFeetY = Infinity;
    let landings = 0;
    for (let t = 0; t < SPRINT_TICKS; t++) {
      const input = emptyInput();
      input.move.y = 1;
      input.look.yaw = yaw;
      input.sprint.held = true;
      if (t % 25 === 5) { input.jump.pressed = true; input.jump.held = true; }
      const events = sim.step(input, NO_MODS, world, t / movementConfig.tickRate);
      landings += events.filter((e) => e.kind === 'landed').length;
      minFeetY = Math.min(minFeetY, sim.state.position.y);
    }
    expect(landings).toBeGreaterThanOrEqual(5);
    expect(sim.state.position.x - -30).toBeGreaterThanOrEqual(MIN_DISTANCE);
    expect(minFeetY).toBeGreaterThanOrEqual(-0.01);
  });
});
