import { vec3 } from '../../src/math/vec3';
import type { GreyboxSource, Hospital, MapData, OrderRules } from '../../src/world/mapTypes';

export const testOrderRules = (): OrderRules => ({
  bands: { shortMax: 150, mediumMax: 350 },
  foodDropoff: { min: 80, max: 400 },
  packageDropoff: { min: 100, max: 650 },
  maxPickupDistance: 250,
});

export const testHospital = (id: string, center = vec3(0, 0, 0), name = id): Hospital => ({
  id,
  name,
  center,
  safeRadius: 18,
  spawn: vec3(center.x, center.y, center.z + 8),
  spawnYaw: 0,
});

export const emptyMap = (): MapData => ({
  size: 200,
  solids: [{ id: 'ground', kind: 'ground', center: vec3(0, -0.5, 0), size: vec3(200, 1, 200) }],
  pois: [],
  hospitals: [testHospital('h-test', vec3(0, 0, 0), 'Test Hospital')],
  orderRules: testOrderRules(),
});

export const greyboxFixture = (): GreyboxSource => ({
  ...emptyMap(),
  size: 400,
  solids: [{ id: 'crate', kind: 'prop', center: vec3(5, 1, 5), size: vec3(2, 2, 2) }],
  seed: 7,
  grid: { pitch: 50, roadWidth: 12, alleyWidth: 4 },
  districts: [{ district: 'downtown', rect: { minX: -200, minZ: -200, maxX: 200, maxZ: 200 }, heightMin: 10, heightMax: 40, fillChance: 0.8 }],
  reserved: [{ minX: -40, minZ: -40, maxX: 40, maxZ: 40 }],
  hospitalBlock: vec3(4, 3, 4),
});
