import { beforeAll, describe, expect, it } from 'vitest';
import {
  createPhysicsWorld,
  expandGreybox,
  initRapier,
  movementConfig,
  PlayerSim,
  type GreyboxSource,
  type PhysicsWorld,
} from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { physicsRayCast, pointInSolid } from '../src/game/cameraQueries';

const map = expandGreybox(greybox as GreyboxSource);
let physics: PhysicsWorld;

beforeAll(async () => {
  physics = createPhysicsWorld(await initRapier(), map);
});

describe('camera physics queries (greybox crouch tunnel: roof underside at y 1.4, x 92..104)', () => {
  it('a ray up from a crouched pivot in the tunnel hits the roof', () => {
    const cast = physicsRayCast(physics);
    expect(cast({ x: 98, y: 0.8, z: 0 }, { x: 0, y: 1, z: 0 }, 5)).toBeCloseTo(0.6, 3);
    expect(cast({ x: 98, y: 0.8, z: 0 }, { x: 0, y: 1, z: 0 }, 0.5)).toBeNull();
  });

  it('points inside the roof are solid; the open air below it is not', () => {
    expect(pointInSolid(physics, { x: 98, y: 1.6, z: 0 })).toBe(true);
    expect(pointInSolid(physics, { x: 98, y: 1.2, z: 0 })).toBe(false);
  });

  it("ignores the courier's own capsule", () => {
    const sim = new PlayerSim(physics, map, movementConfig, { x: 98, y: 0, z: 0 }, 0);
    const cast = physicsRayCast(physics);
    // From beside the courier straight through its capsule to the far tunnel wall (inner face z = 2).
    expect(cast({ x: 98, y: 0.6, z: -1.5 }, { x: 0, y: 0, z: 1 }, 10)).toBeCloseTo(3.5, 3);
    expect(pointInSolid(physics, { x: 98, y: 0.9, z: 0 })).toBe(false);
    expect(sim.state.position.x).toBe(98);
  });
});
