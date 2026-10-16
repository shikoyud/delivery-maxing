import { describe, expect, test } from 'vitest';
import catalogJson from '../../../../map/catalog.json';
import cityJson from '../../../../map/city.layout.json';
import { movementConfig as cfg, worldConfig } from '../../src/config';
import { vec3, type Vec3 } from '../../src/math/vec3';
import type { PlayerState, SimEvent } from '../../src/movement/types';
import type { SavedVehicle } from '../../src/vehicles/Garage';
import { CatalogIndex, parseCatalog } from '../../src/world/catalog';
import { chunkOf } from '../../src/world/chunks';
import { parseCityLayout } from '../../src/world/cityLayout';
import { layoutToMap } from '../../src/world/cityMap';
import { makeSim } from '../helpers/simHarness';

// Review Focus 5: the committed city on the paged physics world (colliders loaded at worldConfig.physics.loadRadius,
// unloaded at unloadRadius), updated around the player before every tick as the client does.
const map = layoutToMap(parseCityLayout(cityJson), new CatalogIndex(parseCatalog(catalogJson)));
const avenue = map.layout.roads.find((r) => r.name === 'Bayview Avenue')!;
const L1 = avenue.y;

const seconds = (t: number) => Math.round(t * cfg.tickRate);
/** Look yaw whose forward is the horizontal direction (dx, dz). */
const yawToward = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const EAST = yawToward(1, 0);
const TOWARD_WATER = yawToward(0, -1);
const speed = (s: PlayerState) => Math.hypot(s.velocity.x, s.velocity.z);
const SKATEBOARD: SavedVehicle = { tier: 'skateboard', spot: { kind: 'carried' }, fuel: 1 };
const respawned = (events: SimEvent[]) => events.some((e) => e.kind === 'respawned');

describe('streamed colliders on the city (Review Focus 5)', () => {
  test('a car at 28 m/s along Bayview Avenue never drops below the level height and stops at the end of the avenue', async () => {
    // The car parked on the avenue's centre line at its west end, facing east.
    const zMid = (avenue.rect.minZ + avenue.rect.maxZ) / 2;
    const at = vec3(30, L1, zMid);
    const car: SavedVehicle = { tier: 'car', spot: { kind: 'parked', position: at, heading: EAST }, fuel: 1 };
    const h = await makeSim({ map, paged: true, spawn: vec3(at.x, L1, at.z + 2.5), yaw: EAST, garage: [SKATEBOARD, car] });
    expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'mounted', tier: 'car' });

    let minY = Infinity;
    let maxSpeed = 0;
    let maxChunks = 0;
    let stoppedAt: Vec3 | null = null;
    for (let i = 0; i < 1500; i++) {
      const s = h.sim.state;
      // Full throttle east until 1,150 m, then the brake: the car stops before the end of the avenue.
      const braking = s.position.x >= 1150;
      expect(respawned(h.tick({ forward: braking ? -1 : 1, yaw: EAST }))).toBe(false);
      minY = Math.min(minY, h.sim.state.position.y);
      maxSpeed = Math.max(maxSpeed, speed(h.sim.state));
      maxChunks = Math.max(maxChunks, h.pager!.loadedChunks().size);
      if (braking && speed(h.sim.state) < 0.5) {
        stoppedAt = { ...h.sim.state.position };
        break;
      }
    }
    expect(h.sim.state.riding).toBe('car');
    expect(maxSpeed).toBeGreaterThan(27.5); // top speed reached
    expect(minY).toBeGreaterThanOrEqual(L1 - 0.1);
    expect(stoppedAt).not.toBeNull();
    expect(stoppedAt!.x).toBeGreaterThanOrEqual(1150);
    expect(stoppedAt!.x).toBeLessThanOrEqual(avenue.rect.maxX);
    // Paging, not everything: a 150 m load radius keeps at most a 5 x 5 block of 100 m chunks.
    expect(maxChunks).toBeLessThanOrEqual(25);
    expect(h.pager!.loadedChunks().has(chunkOf(30, zMid, map.chunkSize))).toBe(false); // the start unloaded behind
  });

  test('after a teleport across the city the chunks around the new position are loaded before the next step', async () => {
    const hospital = map.hospitals[0]!;
    const h = await makeSim({ map, paged: true, spawn: hospital.spawn, yaw: hospital.spawnYaw });
    // Uptown Avenue (L3, y 38), about 1 km from Bayview General.
    const uptown = map.layout.roads.find((r) => r.name === 'Uptown Avenue')!;
    const far = vec3(900, uptown.y, (uptown.rect.minZ + uptown.rect.maxZ) / 2);
    expect(h.pager!.loadedChunks().has(chunkOf(far.x, far.z, map.chunkSize))).toBe(false);
    h.sim.teleport(far, vec3(0, 0, 0));
    h.pager!.update(h.sim.state.position); // what Game.teleport does
    expect(h.pager!.loadedChunks().has(chunkOf(far.x, far.z, map.chunkSize))).toBe(true);
    // The first step after it already stands on the new ground.
    const events = h.run(seconds(1));
    expect(respawned(events)).toBe(false);
    expect(h.sim.state.grounded).toBe(true);
    expect(h.sim.state.position.y).toBeCloseTo(uptown.y, 1);
    expect(h.pager!.loadedChunks().has(chunkOf(hospital.spawn.x, hospital.spawn.z, map.chunkSize))).toBe(false);
    expect(worldConfig.physics.loadRadius).toBeLessThan(worldConfig.physics.unloadRadius);
  });

  test('standing on the beach sand (y 1) does not respawn; walking off the Old Harbor quay into the marina does', async () => {
    const sand = map.layout.areas.find((a) => a.kind === 'sand' && a.rect.minX >= 590 && a.rect.maxX <= 610)!;
    const onSand = vec3((sand.rect.minX + sand.rect.maxX) / 2, sand.y, (sand.rect.minZ + sand.rect.maxZ) / 2);
    const beach = await makeSim({ map, paged: true, spawn: onSand, yaw: TOWARD_WATER });
    expect(beach.sim.state.grounded).toBe(true);
    expect(beach.sim.state.position.y).toBeCloseTo(1, 1);
    expect(respawned(beach.run(seconds(3)))).toBe(false);

    const quay = map.layout.areas.find((a) => a.kind === 'quay' && a.district === 'harbor')!;
    const marina = map.layout.areas.find((a) => a.kind === 'marina')!;
    // On the quay's edge above the marina, walking toward the water.
    const x = (marina.rect.minX + marina.rect.maxX) / 2;
    const harbor = await makeSim({ map, paged: true, spawn: vec3(x, quay.y, quay.rect.minZ + 3), yaw: TOWARD_WATER });
    expect(harbor.sim.state.grounded).toBe(true);
    let wet = false;
    for (let i = 0; i < seconds(10) && !wet; i++) wet = respawned(harbor.tick({ forward: 1, yaw: TOWARD_WATER }));
    expect(wet).toBe(true);
  });
});
