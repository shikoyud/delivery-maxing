import { vec3 } from '../../src/math/vec3';
import type { GreyboxSource, MapData } from '../../src/world/mapTypes';

export const emptyMap = (): MapData => ({
  size: 200,
  solids: [{ id: 'ground', kind: 'ground', center: vec3(0, -0.5, 0), size: vec3(200, 1, 200) }],
  zipLines: [], jumpPads: [], boostOrbs: [], rails: [], checkpoints: [], pois: [],
  hub: {
    center: vec3(0, 0, 0), plazaRadius: 30, dropZoneRadius: 6, zoneHeight: 6,
    kiosk: vec3(0, 0, -8), kioskRange: 3, spawn: vec3(0, 0, 5), spawnYaw: 0,
  },
});

export const greyboxFixture = (): GreyboxSource => ({
  ...emptyMap(),
  size: 400,
  solids: [{ id: 'crate', kind: 'prop', center: vec3(5, 1, 5), size: vec3(2, 2, 2) }],
  zipLines: [{ id: 'z1', a: vec3(0, 10, 0), b: vec3(20, 5, 0) }],
  checkpoints: [{ id: 'c1', position: vec3(100, 0, 50) }],
  seed: 7,
  grid: { pitch: 50, roadWidth: 12, alleyWidth: 4 },
  districts: [{ district: 'downtown', rect: { minX: -200, minZ: -200, maxX: 200, maxZ: 200 }, heightMin: 10, heightMax: 40, fillChance: 0.8 }],
  reserved: [{ minX: -40, minZ: -40, maxX: 40, maxZ: 40 }],
});
