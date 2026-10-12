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
import { ballInSolid, physicsSphereCast } from '../src/game/cameraQueries';

const map = expandGreybox(greybox as GreyboxSource);
let physics: PhysicsWorld;
let sim: PlayerSim;

beforeAll(async () => {
  physics = createPhysicsWorld(await initRapier(), map);
  sim = new PlayerSim(physics, map, movementConfig, { x: 98, y: 0, z: 0 }, 0);
});

const UP = { x: 0, y: 1, z: 0 };

describe('camera physics queries (greybox crouch tunnel: roof underside y 1.4, x 92..104, inner walls z ±2)', () => {
  it('sphere cast: the ball centre stops one radius short of the roof', () => {
    const cast = physicsSphereCast(physics, 0.3, sim.body.collider);
    expect(cast({ x: 98, y: 0.8, z: 0 }, UP, 5)).toBeCloseTo(0.3, 3);
    expect(cast({ x: 98, y: 0.8, z: 0 }, UP, 0.2)).toBeNull();
  });

  it('sphere cast: a grazing approach to a wall still stops the ball one radius from it', () => {
    const cast = physicsSphereCast(physics, 0.3, sim.body.collider);
    // From the tunnel axis toward the inner face z = 2 at a shallow angle (sin θ ≈ 0.27).
    const dir = { x: Math.cos(0.27), y: 0, z: Math.sin(0.27) };
    const d = cast({ x: 93, y: 0.8, z: 0 }, dir, 50)!;
    expect(2 - (0 + dir.z * d)).toBeCloseTo(0.3, 3);
  });

  it("ignores the courier's own capsule", () => {
    const cast = physicsSphereCast(physics, 0.1, sim.body.collider);
    // From beside the courier straight through its capsule to the far tunnel wall (inner face z = 2).
    expect(cast({ x: 98, y: 0.6, z: -1.5 }, { x: 0, y: 0, z: 1 }, 10)).toBeCloseTo(3.4, 3);
    expect(ballInSolid(physics, { x: 98, y: 0.9, z: 0 }, 0.1, sim.body.collider)).toBe(false);
    // Without the exclusion the capsule counts.
    expect(ballInSolid(physics, { x: 98, y: 0.9, z: 0 }, 0.1)).toBe(true);
  });

  it('ballInSolid: a ball poking into the roof is solid; one clear of it is not', () => {
    expect(ballInSolid(physics, { x: 98, y: 1.2, z: 0 }, 0.25, sim.body.collider)).toBe(true);
    expect(ballInSolid(physics, { x: 98, y: 1.1, z: 0 }, 0.25, sim.body.collider)).toBe(false);
  });
});
