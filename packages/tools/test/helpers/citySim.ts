import { expect } from 'vitest';
import {
  closestOnSegment,
  createPagedPhysicsWorld,
  createWorldFeatureState,
  distance,
  initRapier,
  movementConfig,
  NO_MODS,
  PlayerSim,
  worldConfig,
  type CityMap,
  type PagedPhysicsWorld,
  type SimEvent,
  type Vec3,
  type ZipLine,
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

/** Settling after a landing: this many ticks with no input. */
const SETTLE_TICKS = 10;

/**
 * Lands the courier: runs `hold` until grounded in ground mode after being airborne (already airborne when
 * `airborne`), then lets go of the keys for SETTLE_TICKS. Returns the largest fall seen and the feet on the landing
 * tick. Fails on a respawn.
 */
export function untilLanded(
  h: CityHarness,
  label: string,
  hold: Parameters<CityHarness['tick']>[0],
  maxTicks: number,
  airborne = false,
): { fall: number; at: Vec3 } {
  let fall = 0;
  const watch = (events: SimEvent[]): void => {
    expect(events.filter((e) => e.kind === 'respawned'), `${label}: respawned`).toEqual([]);
    for (const e of events) if (e.kind === 'landed') fall = Math.max(fall, e.fallHeight);
  };
  for (let i = 0; i < maxTicks; i++) {
    watch(h.tick(hold));
    const s = h.sim.state;
    if (!s.grounded) airborne = true;
    else if (airborne && s.mode === 'ground') {
      const at = { ...s.position };
      for (let k = 0; k < SETTLE_TICKS; k++) watch(h.tick());
      return { fall, at };
    }
  }
  throw new Error(`${label}: not standing again within ${maxTicks} ticks (at ${JSON.stringify(h.sim.state.position)})`);
}

/**
 * Feet for a standing spot under the first 4 m of the cable from `from` (toward `to`) where a standing courier's hand
 * reaches the cable, or null.
 */
export function grabSpot(h: CityHarness, z: ZipLine, from: Vec3, to: Vec3): Vec3 | null {
  const cfg = movementConfig;
  const len = distance(from, to);
  for (let s = 0; s <= Math.min(4, len); s += 0.25) {
    const k = s / len;
    const c = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k };
    const drop = h.dropTo(c, 10);
    if (drop === null || drop <= 0) continue;
    const feet = { x: c.x, y: c.y - drop, z: c.z };
    const hand = { x: feet.x, y: feet.y + cfg.capsule.height, z: feet.z };
    if (closestOnSegment(hand, z.a, z.b).dist <= cfg.zipLine.attachDistance) return feet;
  }
  return null;
}

/**
 * Rides zip line `z` toward its end `to`: grabs it from a standing spot near the other end, rides to the end without
 * a respawn, and checks the ride ends in a dismount (mode ground on the detach tick) at the far end, standing still on
 * the dismount surface half a second later with no fall.
 */
export function rideZip(h: CityHarness, z: ZipLine, to: 'a' | 'b'): void {
  const cfg = movementConfig;
  const [from, target, dir] = to === 'b' ? [z.a, z.b, 1] : [z.b, z.a, -1];
  const label = `${z.id} -> ${to}`;
  const feet = grabSpot(h, z, from, target);
  expect(feet, `${label}: a standing spot within reach of the cable near the start`).not.toBeNull();
  h.spawnAt(feet!, yawToward(target.x - from.x, target.z - from.z));
  h.tick({}, ['interact']);
  expect(h.sim.state.zip, `${label}: grabbed`).toMatchObject({ id: z.id, dir });
  const rideTicks = Math.ceil((distance(z.a, z.b) / cfg.zipLine.baseSpeed) * cfg.tickRate) + 5;
  for (let i = 0; i < rideTicks && h.sim.state.mode === 'zipline'; i++) {
    const events = h.tick();
    expect(events.filter((e) => e.kind === 'respawned'), `${label}: respawned`).toEqual([]);
  }
  expect(h.sim.state.mode, `${label}: the ride ends in a dismount`).toBe('ground');
  const off = { ...h.sim.state.position };
  expect(Math.hypot(off.x - target.x, off.z - target.z), `${label}: rode to the far end`).toBeLessThan(1);
  const events = h.run(cfg.tickRate / 2);
  expect(events.filter((e) => e.kind === 'landed' && e.fallHeight > 0.1), `${label}: no fall after the dismount`).toEqual([]);
  expect(h.sim.state.grounded, `${label}: standing after the exit`).toBe(true);
  expect(Math.abs(h.sim.state.position.y - off.y), `${label}: still on the dismount surface`).toBeLessThanOrEqual(0.05);
}
