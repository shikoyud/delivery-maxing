import {
  createPagedPhysicsWorld,
  createWorldFeatureState,
  initRapier,
  movementConfig,
  NO_MODS,
  PlayerSim,
  worldConfig,
  type CityMap,
  type PagedPhysicsWorld,
  type SimEvent,
  type Vec3,
} from '@dm/shared';
// The SP1 harness API and input semantics (sprint toggle taps), shared so the two harnesses cannot diverge
import { makeInput, type Harness } from '../../../shared/test/helpers/simHarness';

export type { Harness, Hold, Press } from '../../../shared/test/helpers/simHarness';

export interface CityHarness extends Harness<CityMap> {
  physics: PagedPhysicsWorld;
  /**
   * Starts a fresh courier at `feet` facing `yaw`: a new PlayerSim (the previous one's capsule and character
   * controller leave the world), a fresh feature state (orbs available) and time 0. Then, like makeSim, runs idle
   * ticks (at most 3) until grounded.
   */
  spawnAt(feet: Vec3, yaw: number): void;
  /** Distance from `from` straight down to the first surface within `max` m (0 when `from` is inside a solid), or null. */
  dropTo(from: Vec3, max?: number): number | null;
}

/** facing(yaw) = (−sin yaw, 0, −cos yaw): the yaw that faces along the horizontal direction (dx, dz). */
export const yawToward = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

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
      h.sim.body.dispose();
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
