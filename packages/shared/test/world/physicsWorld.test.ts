import { beforeAll, describe, expect, it } from 'vitest';
import { createPhysicsWorld, initRapier, type Rapier } from '../../src/world/physicsWorld';
import { vec3 } from '../../src/math/vec3';
import { emptyMap } from './fixtures';

let rapier: Rapier;
beforeAll(async () => { rapier = await initRapier(); });

describe('physics world', () => {
  it('memoises init', async () => {
    expect(await initRapier()).toBe(rapier);
  });

  it('a ray cast down at (10, 50, 10) hits the ground at y = 0', () => {
    const pw = createPhysicsWorld(rapier, emptyMap());
    const hit = pw.world.castRay(new rapier.Ray({ x: 10, y: 50, z: 10 }, { x: 0, y: -1, z: 0 }), 100, true);
    expect(hit).not.toBeNull();
    expect(50 - hit!.timeOfImpact).toBeCloseTo(0, 5);
  });

  it('a box rotated 15 degrees about X has its top surface where the rotation puts it', () => {
    const map = emptyMap();
    map.solids.push({ id: 'ramp', kind: 'ramp', center: vec3(0, 5, 50), size: vec3(10, 1, 20), rotationDeg: vec3(15, 0, 0) });
    const pw = createPhysicsWorld(rapier, map);
    const z = 52;
    const hit = pw.world.castRay(new rapier.Ray({ x: 0, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true);
    const a = (15 * Math.PI) / 180;
    // top plane: local y = 0.5 -> world y = 5 + (z-50)*(-sin a... ) derived from rotation about X
    const expected = 5 + (0.5 - (z - 50) * Math.sin(a)) / Math.cos(a);
    expect(50 - hit!.timeOfImpact).toBeCloseTo(expected, 4);
  });
});
