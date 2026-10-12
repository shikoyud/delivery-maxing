import {
  createPagedPhysicsWorld,
  createWorldFeatureState,
  emptyInput,
  initRapier,
  movementConfig,
  NO_MODS,
  PlayerSim,
  worldConfig,
  type CityMap,
  type InputFrame,
  type PagedPhysicsWorld,
  type PlayerState,
  type SimEvent,
  type StatModifiers,
  type Vec3,
  type WorldFeatureState,
} from '@dm/shared';

/** As the SP1 harness (packages/shared/test/helpers/simHarness.ts). */
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

export type Press = 'jump' | 'crouch' | 'interact' | 'board';

/** The SP1 harness API on the city. */
export interface Harness {
  sim: PlayerSim;
  world: WorldFeatureState;
  map: CityMap;
  /** Simulation time in seconds, advanced by sim.dt per tick. */
  time: number;
  tick(hold?: Hold, press?: Press[], mods?: StatModifiers): SimEvent[];
  run(ticks: number, hold?: Hold, mods?: StatModifiers): SimEvent[];
  /** Ticks until `pred(state)` holds after a tick; returns the number of ticks run. Throws past maxTicks. */
  runUntil(pred: (s: PlayerState) => boolean, maxTicks: number, hold?: Hold): number;
}

export interface CityHarness extends Harness {
  physics: PagedPhysicsWorld;
  /**
   * Starts a fresh courier at `feet` facing `yaw`: a new PlayerSim (the previous capsule is removed from the world), a
   * fresh feature state (orbs available) and time 0. Then, like makeSim, runs idle ticks (at most 3) until grounded.
   */
  spawnAt(feet: Vec3, yaw: number): void;
  /** Distance from `from` straight down to the first surface within `max` m (0 when `from` is inside a solid), or null. */
  dropTo(from: Vec3, max?: number): number | null;
}

/** facing(yaw) = (−sin yaw, 0, −cos yaw): the yaw that faces along the horizontal direction (dx, dz). */
export const yawToward = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

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
 * A courier on the generated city. Physics is the game's paged collider world: every tick pages the chunks around the
 * courier in before stepping, exactly as the client does. (A world with every chunk loaded is stepped at ~2.4 ms per
 * tick on the 8,500-solid city — world.step() walks every body — which content tests cannot afford; paged, ~0.15 ms.)
 * Build one per test file and reuse it with spawnAt.
 */
export async function cityHarness(city: CityMap): Promise<CityHarness> {
  const rapier = await initRapier();
  const physics = createPagedPhysicsWorld(rapier, city, city.chunkSize, worldConfig.physics);
  let yaw = city.hub.spawnYaw;
  const fresh = (feet: Vec3): PlayerSim => {
    physics.update(feet);
    return new PlayerSim(physics, city, movementConfig, feet, yaw);
  };

  const h: CityHarness = {
    sim: fresh(city.hub.spawn),
    world: createWorldFeatureState(city),
    map: city,
    physics,
    time: 0,
    tick(hold = {}, press = [], mods = NO_MODS) {
      physics.update(h.sim.state.position);
      const events = h.sim.step(makeInput(hold, press, yaw, h.sim.state), mods, h.world, h.time);
      h.time += h.sim.dt;
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
        if (pred(h.sim.state)) return i;
      }
      throw new Error(`runUntil: predicate not met within ${maxTicks} ticks`);
    },
    spawnAt(feet, spawnYaw) {
      physics.world.removeRigidBody(h.sim.body.collider.parent()!);
      yaw = spawnYaw;
      h.sim = fresh(feet);
      h.world = createWorldFeatureState(city);
      h.time = 0;
      for (let i = 0; i < 3 && !h.sim.state.grounded; i++) h.tick();
    },
    dropTo(from, max = 200) {
      physics.update(from);
      const hit = physics.world.castRay(
        new rapier.Ray(from, { x: 0, y: -1, z: 0 }),
        max,
        true,
        undefined,
        undefined,
        h.sim.body.collider,
      );
      return hit ? hit.timeOfImpact : null;
    },
  };
  for (let i = 0; i < 3 && !h.sim.state.grounded; i++) h.tick();
  return h;
}
