import { beforeAll, describe, expect, it } from 'vitest';
import { movementConfig, worldConfig } from '../../src/config';
import { emptyInput, type InputFrame } from '../../src/input/inputFrame';
import { vec3, type Vec3 } from '../../src/math/vec3';
import { PlayerSim } from '../../src/movement/PlayerSim';
import { createWorldFeatureState } from '../../src/movement/triggers';
import { NO_MODS } from '../../src/movement/types';
import { createPagedPhysicsWorld, type PagedPhysicsWorld } from '../../src/world/colliderPager';
import type { MapData, Solid } from '../../src/world/mapTypes';
import { initRapier, type Rapier } from '../../src/world/physicsWorld';
import { emptyMap } from './fixtures';

let rapier: Rapier;
beforeAll(async () => { rapier = await initRapier(); });

const { chunkSize, physics: radii } = worldConfig;
/** Facing +x: yaw 0 faces -z and positive yaw turns left. */
const FACE_EAST = -Math.PI / 2;
const STRIP_Z = 50;

/** A 1,000 m strip along +x (ground tiles 100 m long, top at y = 0, one chunk row) with a wall at x = 450. */
function stripMap(extra: Solid[] = [], checkpoints: MapData['checkpoints'] = []): MapData {
  const map = emptyMap();
  map.size = 2000;
  map.solids = [];
  for (let i = 0; i < 10; i++) {
    map.solids.push({ id: `tile${i}`, kind: 'ground', center: vec3(i * 100 + 50, -0.5, STRIP_Z), size: vec3(100, 1, 100) });
  }
  map.solids.push({ id: 'wall', kind: 'building', center: vec3(450, 10, STRIP_Z), size: vec3(2, 20, 20) });
  map.solids.push(...extra);
  map.checkpoints = checkpoints;
  map.hub.spawn = vec3(50, 0, STRIP_Z);
  return map;
}

const paged = (map: MapData): PagedPhysicsWorld => createPagedPhysicsWorld(rapier, map, chunkSize, radii);

/** Does a horizontal ray along +x at (from, 5, STRIP_Z) hit anything within 1,000 m? Returns the hit x or null. */
function rayEast(pw: PagedPhysicsWorld, fromX: number): number | null {
  const hit = pw.world.castRay(new rapier.Ray({ x: fromX, y: 5, z: STRIP_Z }, { x: 1, y: 0, z: 0 }), 1000, true);
  return hit ? fromX + hit.timeOfImpact : null;
}

function inputEast(sprintTap: boolean): InputFrame {
  const input = emptyInput();
  input.move = { x: 0, y: 1 };
  input.look = { yaw: FACE_EAST, pitch: 0 };
  input.sprint.pressed = sprintTap;
  input.sprint.held = sprintTap;
  return input;
}

describe('collider pager', () => {
  it('a ray at the far wall misses until update() near it, then hits', () => {
    const pw = paged(stripMap());
    pw.update(vec3(50, 1, STRIP_Z));
    expect(rayEast(pw, 200)).toBeNull();
    pw.update(vec3(400, 1, STRIP_Z));
    expect(rayEast(pw, 400)).toBeCloseTo(449, 3);
  });

  it('hysteresis: a chunk at 180 m stays loaded, one at 230 m unloads', () => {
    const pw = paged(stripMap());
    pw.update(vec3(150, 1, STRIP_Z));
    expect(pw.loadedChunks().has('3,0')).toBe(true); // 150 m: inside loadRadius
    pw.update(vec3(120, 1, STRIP_Z));
    expect(pw.loadedChunks().has('3,0')).toBe(true); // 180 m: between load (150) and unload (220)
    pw.update(vec3(70, 1, STRIP_Z));
    expect(pw.loadedChunks().has('3,0')).toBe(false); // 230 m: beyond unloadRadius
    expect(pw.loadedChunks().has('2,0')).toBe(true); // 130 m
  });

  it('a chunk first seen at 180 m does not load (load needs loadRadius)', () => {
    const pw = paged(stripMap());
    pw.update(vec3(120, 1, STRIP_Z));
    expect(pw.loadedChunks().has('3,0')).toBe(false); // 180 m: hysteresis keeps a loaded chunk, it does not load a new one
  });

  it('a solid spanning two chunks exists while either chunk is loaded', () => {
    // 20 m wide beam centred on the x = 300 chunk edge: touches chunks 2 and 3.
    const pw = paged(stripMap([{ id: 'beam', kind: 'prop', center: vec3(300, 30, STRIP_Z), size: vec3(20, 2, 4) }]));
    const beamAt = () =>
      pw.world.castRay(new rapier.Ray({ x: 300, y: 60, z: STRIP_Z }, { x: 0, y: -1, z: 0 }), 100, true);
    pw.update(vec3(-100, 1, STRIP_Z)); // chunk 2 (200..300) is 300 m away, chunk 3 400 m: neither loaded
    expect(pw.loadedChunks().has('2,0')).toBe(false);
    expect(beamAt()).toBeNull();
    pw.update(vec3(60, 1, STRIP_Z)); // chunk 2 at 140 m loads; chunk 3 at 240 m does not
    expect(pw.loadedChunks().has('3,0')).toBe(false);
    expect(beamAt()).not.toBeNull();
    pw.update(vec3(500, 1, STRIP_Z)); // chunk 3 at 0 m loaded; chunk 2 at 200 m stays (hysteresis)
    expect(beamAt()).not.toBeNull();
    pw.update(vec3(640, 1, STRIP_Z)); // chunk 3 at 340 m unloads; chunk 2 already unloaded
    expect(pw.loadedChunks().has('3,0')).toBe(false);
    expect(beamAt()).toBeNull();
  });

  it('a spanning solid is created once and survives while only one of its chunks unloads', () => {
    const pw = paged(stripMap([{ id: 'beam', kind: 'prop', center: vec3(300, 30, STRIP_Z), size: vec3(20, 2, 4) }]));
    pw.update(vec3(300, 1, STRIP_Z)); // both chunks loaded
    pw.update(vec3(560, 1, STRIP_Z)); // chunk 2: 260 m away -> unloaded; chunk 3: 160 m -> still loaded
    expect(pw.loadedChunks().has('2,0')).toBe(false);
    expect(pw.loadedChunks().has('3,0')).toBe(true);
    const beam = pw.world.castRay(new rapier.Ray({ x: 300, y: 60, z: STRIP_Z }, { x: 0, y: -1, z: 0 }), 100, true);
    expect(beam).not.toBeNull();
  });

  it('surfaceOf reports chute for a paged chute collider', () => {
    const pw = paged(stripMap([
      { id: 'chute', kind: 'chute', center: vec3(450, 3, 90), size: vec3(4, 1, 10), surface: 'chute' },
    ]));
    pw.update(vec3(450, 1, STRIP_Z));
    const down = (x: number, z: number) =>
      pw.world.castRay(new rapier.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true)!.collider;
    expect(pw.surfaceOf(down(450, 90))).toBe('chute');
    expect(pw.surfaceOf(down(420, 30))).toBe('default');
  });

  it('update() reports whether anything changed and loadAll() loads everything for good', () => {
    const pw = paged(stripMap());
    expect(pw.update(vec3(50, 1, STRIP_Z))).toBe(true);
    expect(pw.update(vec3(50, 1, STRIP_Z))).toBe(false);
    pw.loadAll();
    expect(rayEast(pw, 200)).toBeCloseTo(449, 3);
    const loaded = pw.loadedChunks().size;
    expect(pw.update(vec3(9000, 1, 9000))).toBe(false);
    expect(pw.loadedChunks().size).toBe(loaded);
    expect(rayEast(pw, 200)).toBeCloseTo(449, 3);
  });

  it('never removes colliders it did not create', () => {
    const pw = paged(stripMap());
    const body = pw.world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(0, 100, 0));
    const mine = pw.world.createCollider(rapier.ColliderDesc.ball(1), body);
    pw.update(vec3(50, 1, STRIP_Z));
    pw.update(vec3(900, 1, STRIP_Z));
    pw.update(vec3(5000, 1, 5000));
    expect(pw.world.getCollider(mine.handle)).not.toBeNull();
  });
});

describe('PlayerSim on a paged world', () => {
  it('sprinting 900 m across the strip with update() before each step never drops below y = -0.05', () => {
    const map = stripMap();
    const pw = paged(map);
    const start = vec3(50, 0, 5); // along the strip's edge, clear of the wall at z 40..60
    pw.update(start);
    const sim = new PlayerSim(pw, map, movementConfig, start, FACE_EAST);
    const world = createWorldFeatureState(map);
    let minY = Infinity;
    let time = 0;
    for (let tick = 0; tick < 5000 && sim.state.position.x < 950; tick++) {
      pw.update(sim.state.position);
      sim.step(inputEast(tick === 0), NO_MODS, world, time);
      time += sim.dt;
      minY = Math.min(minY, sim.state.position.y);
    }
    expect(sim.state.position.x).toBeGreaterThanOrEqual(950);
    expect(minY).toBeGreaterThanOrEqual(-0.05);
  });

  it('without update() the player falls through unloaded ground (the contract matters)', () => {
    const map = stripMap();
    const pw = paged(map);
    pw.update(vec3(50, 1, STRIP_Z));
    const sim = new PlayerSim(pw, map, movementConfig, vec3(50, 0, STRIP_Z), FACE_EAST);
    sim.teleport(vec3(850, 0.5, STRIP_Z)); // 800 m away: nothing is loaded there
    const world = createWorldFeatureState(map);
    for (let i = 0; i < 10; i++) sim.step(emptyInput(), NO_MODS, world, i / 30);
    expect(sim.state.position.y).toBeLessThan(-0.05);
  });

  it('Review Focus 1: respawn to a checkpoint 900 m away, then update(); grounded within 3 ticks and y >= -0.05', () => {
    const far: Vec3 = vec3(950, 0, STRIP_Z);
    const map = stripMap([], [{ id: 'far', position: far }]);
    const pw = paged(map);
    const start = vec3(50, 0, STRIP_Z);
    pw.update(start);
    const sim = new PlayerSim(pw, map, movementConfig, start, FACE_EAST);
    const world = createWorldFeatureState(map);
    let time = 0;
    const tick = (): ReturnType<PlayerSim['step']> => {
      pw.update(sim.state.position);
      const events = sim.step(emptyInput(), NO_MODS, world, time);
      time += sim.dt;
      return events;
    };
    for (let i = 0; i < 5 && !sim.state.grounded; i++) tick();
    expect(sim.state.grounded).toBe(true);

    // Fall out of the world: the next step respawns at the far checkpoint, whose chunks are not loaded yet.
    sim.teleport(vec3(50, movementConfig.fall.outOfBoundsY - 5, STRIP_Z));
    const events = tick();
    expect(events).toContainEqual({ kind: 'respawned', checkpointId: 'far' });
    expect(sim.state.position.x).toBeCloseTo(950, 3);
    expect(pw.loadedChunks().has('9,0')).toBe(false);

    let groundedAfter = -1;
    for (let i = 1; i <= 3; i++) {
      tick(); // update(sim.state.position) first, as Game will
      expect(sim.state.position.y).toBeGreaterThanOrEqual(-0.05);
      if (sim.state.grounded) { groundedAfter = i; break; }
    }
    expect(groundedAfter).toBeGreaterThan(0);
    expect(pw.loadedChunks().has('9,0')).toBe(true);
  });
});
