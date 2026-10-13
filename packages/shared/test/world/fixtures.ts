import { vec3 } from '../../src/math/vec3';
import type { CityMap } from '../../src/world/cityTypes';
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

/**
 * A small street city for the thief sim (hub plaza at the origin, radius 30): a long main street east from the plaza
 * edge (p1, x 30) to n6 (x 420); a cross street at n3 (x 240) with a dead end south (c2) and a loop north through c1,
 * d1 and a diagonal back to n6; a ramp north from n6 rising 5 m over 60 m to r2, then a flat street east at y 5 (r3).
 * Thief spawns are set by each test.
 */
export const thiefCity = (spawns: CityMap['thiefSpawns'] = []): CityMap => {
  const node = (id: string, x: number, y: number, z: number, plaza = false) => ({ id, p: vec3(x, y, z), plaza });
  const edge = (a: string, b: string, halfWidth = 6) => ({ a, b, halfWidth, long: false });
  return {
    ...emptyMap(),
    size: 1200,
    kind: 'city',
    seed: 1,
    chunkSize: 100,
    districts: [{ district: 'downtown', rect: { minX: -600, minZ: -600, maxX: 600, maxZ: 600 } }],
    props: [],
    streets: {
      nodes: [
        node('hub', 0, 0, 0, true),
        node('p1', 30, 0, 0, true),
        node('n0', 60, 0, 0),
        node('n1', 120, 0, 0),
        node('n2', 180, 0, 0),
        node('n3', 240, 0, 0),
        node('n4', 300, 0, 0),
        node('n5', 360, 0, 0),
        node('n6', 420, 0, 0),
        node('c1', 240, 0, -80),
        node('c2', 240, 0, 80),
        node('d1', 360, 0, -80),
        node('r2', 420, 5, 60),
        node('r3', 480, 5, 60),
      ],
      edges: [
        edge('hub', 'p1', 10),
        edge('p1', 'n0', 10),
        edge('n0', 'n1'),
        edge('n1', 'n2'),
        edge('n2', 'n3'),
        edge('n3', 'n4'),
        edge('n4', 'n5'),
        edge('n5', 'n6'),
        edge('n3', 'c1'),
        edge('n3', 'c2'),
        edge('c1', 'd1'),
        edge('d1', 'n6'),
        edge('n6', 'r2'),
        edge('r2', 'r3'),
      ],
    },
    navLinks: [],
    thiefSpawns: spawns,
  };
};
