import { worldConfig } from '../../src/config';
import { movementConfig } from '../../src/config';
import { emptyInput, type InputFrame } from '../../src/input/inputFrame';
import { vec3, type Vec3 } from '../../src/math/vec3';
import { PlayerSim } from '../../src/movement/PlayerSim';
import { Garage, type SavedVehicle } from '../../src/vehicles/Garage';
import { NO_MODS, type PlayerState, type SimEvent, type StatModifiers } from '../../src/movement/types';
import type { Hospital, MapData, Solid } from '../../src/world/mapTypes';
import { createPhysicsWorld, initRapier } from '../../src/world/physicsWorld';

export interface Hold {
  forward?: number;
  strafe?: number;
  /** Sprint should be on: the harness taps Shift on the tick where the sprint state differs (and a move key is held). */
  sprint?: boolean;
  crouch?: boolean;
  jump?: boolean;
  /** Absolute look yaw; defaults to the spawn yaw. */
  yaw?: number;
}

export type Press = 'jump' | 'crouch' | 'interact' | 'mount';

export interface Harness {
  sim: PlayerSim;
  map: MapData;
  /** Simulation time in seconds, advanced by sim.dt per tick. */
  time: number;
  tick(hold?: Hold, press?: Press[], mods?: StatModifiers): SimEvent[];
  run(ticks: number, hold?: Hold, mods?: StatModifiers): SimEvent[];
  /** Ticks until `pred(state)` holds after a tick; returns the number of ticks run. Throws past maxTicks. */
  runUntil(pred: (s: PlayerState) => boolean, maxTicks: number, hold?: Hold): number;
}

export interface SimOptions {
  floor?: boolean;
  solids?: Solid[];
  spawn?: Vec3;
  yaw?: number;
  hospitals?: Hospital[];
  /** Map size and floor side (m); default 200. */
  size?: number;
  /** The vehicles owned at the start (a function receives the map); default: the carried skateboard only. */
  garage?: SavedVehicle[] | ((map: MapData) => SavedVehicle[]);
}

/** The default test garage: only the carried skateboard, so no parked vehicle stands in a movement test. */
export const SKATEBOARD_ONLY: SavedVehicle[] = [{ tier: 'skateboard', spot: { kind: 'carried' }, fuel: 1 }];

export const box = (id: string, center: Vec3, size: Vec3, extra?: Partial<Solid>): Solid => ({
  id,
  kind: 'prop',
  center,
  size,
  ...extra,
});

function makeInput(hold: Hold, press: Press[], defaultYaw: number, state: PlayerState): InputFrame {
  const input = emptyInput();
  input.move = { x: hold.strafe ?? 0, y: hold.forward ?? 0 };
  input.look = { yaw: hold.yaw ?? defaultYaw, pitch: 0 };
  const wantSprint = hold.sprint ?? false;
  const moving = input.move.x !== 0 || input.move.y !== 0;
  // Sprint is a toggle: tap Shift when the wanted state differs. With no move key it is off anyway, so no tap.
  if (moving && wantSprint !== state.sprinting) input.sprint.pressed = true;
  input.sprint.held = input.sprint.pressed;
  input.crouch.held = hold.crouch ?? false;
  input.jump.held = hold.jump ?? false;
  for (const p of press) {
    input[p].pressed = true;
    input[p].held = true;
  }
  return input;
}

/**
 * Builds a sim on a test map. Unless `floor: false`, a size x 1 x size slab (200 by default) has its top at y = 0.
 * The sim spawns airborne; makeSim runs idle ticks (at most 3) until it reports grounded, so tests
 * start from a settled player when the spawn is on a surface. `time` keeps counting from those ticks.
 */
export async function makeSim(opts: SimOptions = {}): Promise<Harness> {
  const rapier = await initRapier();
  const spawn = opts.spawn ?? vec3(0, 0, 0);
  const yaw = opts.yaw ?? 0;
  const size = opts.size ?? 200;
  const map: MapData = {
    kind: 'greybox',
    chunkSize: worldConfig.chunkSize,
    size,
    solids: [
      ...(opts.floor === false ? [] : [box('floor', vec3(0, -0.5, 0), vec3(size, 1, size), { kind: 'ground' })]),
      ...(opts.solids ?? []),
    ],
    pois: [],
    hospitals: opts.hospitals ?? [{ id: 'h-test', name: 'Test Hospital', center: vec3(spawn.x, spawn.y, spawn.z - 8), safeRadius: 18, spawn, spawnYaw: yaw, bay: vec3(spawn.x, spawn.y, spawn.z + 8), bayYaw: yaw }],
    accessZones: [],
    gasStations: [],
    orderRules: { bands: { shortMax: 150, mediumMax: 350 }, foodDropoff: { min: 80, max: 400 }, packageDropoff: { min: 100, max: 650 }, maxPickupDistance: 250 },
  };
  const physics = createPhysicsWorld(rapier, map);
  const saved = typeof opts.garage === 'function' ? opts.garage(map) : (opts.garage ?? SKATEBOARD_ONLY);
  const sim = new PlayerSim(physics, map, movementConfig, spawn, yaw, new Garage(physics, map, saved));
  const h: Harness = {
    sim,
    map,
    time: 0,
    tick(hold = {}, press = [], mods = NO_MODS) {
      const events = sim.step(makeInput(hold, press, yaw, sim.state), mods, h.time);
      h.time += sim.dt;
      return events;
    },
    run(ticks, hold = {}, mods = NO_MODS) {
      const events: SimEvent[] = [];
      for (let i = 0; i < ticks; i++) events.push(...h.tick(hold, [], mods));
      return events;
    },
    runUntil(pred, maxTicks, hold = {}) {
      for (let i = 1; i <= maxTicks; i++) {
        h.tick(hold);
        if (pred(sim.state)) return i;
      }
      throw new Error(`runUntil: predicate not met within ${maxTicks} ticks`);
    },
  };

  for (let i = 0; i < 3 && !sim.state.grounded; i++) h.tick();
  return h;
}
