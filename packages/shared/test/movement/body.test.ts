import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { vec3 } from '../../src/math/vec3';
import { PlayerBody } from '../../src/movement/body';
import { createPhysicsWorld, initRapier } from '../../src/world/physicsWorld';
import type { MapData } from '../../src/world/mapTypes';

const map: MapData = {
  size: 100,
  solids: [{ id: 'floor', kind: 'ground', center: vec3(0, -0.5, 0), size: vec3(100, 1, 100) }],
  zipLines: [], jumpPads: [], boostOrbs: [], rails: [], checkpoints: [], pois: [],
  hub: {
    center: vec3(0, 0, 0), plazaRadius: 30, dropZoneRadius: 6, zoneHeight: 6,
    kiosk: vec3(0, 0, -8), kioskRange: 3, spawn: vec3(0, 0, 0), spawnYaw: 0,
  },
};

describe('PlayerBody.dispose', () => {
  it('removes the capsule and its character controller from the world', async () => {
    const physics = createPhysicsWorld(await initRapier(), map);
    const colliders = physics.world.colliders.len();
    const body = new PlayerBody(physics, cfg, vec3(0, 0, 0));
    expect(physics.world.colliders.len()).toBe(colliders + 1);
    const removed: unknown[] = [];
    const original = physics.world.removeCharacterController.bind(physics.world);
    physics.world.removeCharacterController = (c) => {
      removed.push(c);
      original(c);
    };
    body.dispose();
    expect(physics.world.colliders.len()).toBe(colliders);
    expect(removed).toHaveLength(1);
    // A new body in the same spot fits (nothing of the old one is left behind)
    expect(new PlayerBody(physics, cfg, vec3(0, 0, 0)).fitsAt(vec3(0, 0, 0), false)).toBe(true);
  });
});
