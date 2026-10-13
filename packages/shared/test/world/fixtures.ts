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

/**
 * Streets on two levels (no plaza nodes; the hub plaza at the origin is far away): a lower street at y 0 along x
 * (L0 x 100 → L2 x 300, half-width 6, strip z −6…6); an upper street at y 6 beside it (U0 x 100 → U1 x 180 at
 * z 12.1, strip z 6.1…18.1: a 0.1 m gap, less than a chase step); and a bridge at y 6 crossing over the lower street at x 200 (B0 z −40 → B1 z 40, half-width 4).
 */
export const levelsCity = (spawns: CityMap['thiefSpawns'] = []): CityMap => {
  const city = thiefCity(spawns);
  const node = (id: string, x: number, y: number, z: number) => ({ id, p: vec3(x, y, z), plaza: false });
  const edge = (a: string, b: string, halfWidth = 6) => ({ a, b, halfWidth, long: false });
  city.streets = {
    nodes: [node('L0', 100, 0, 0), node('L1', 200, 0, 0), node('L2', 300, 0, 0), node('U0', 100, 6, 12.1), node('U1', 180, 6, 12.1), node('B0', 200, 6, -40), node('B1', 200, 6, 40)],
    edges: [edge('L0', 'L1'), edge('L1', 'L2'), edge('U0', 'U1'), edge('B0', 'B1', 4)],
  };
  return city;
};

/**
 * Sloped streets beyond junctions (no plaza nodes): a straight uniform 1-in-5 slope split in two at M (S0 x 100, y 0 →
 * M x 200, y 20 → S1 x 300, y 40, along z 0); and a flat street running on straight into a 0.3 ramp and on flat at its
 * top, as the hillside's steep streets do (F0 x 100 → F1 x 150 at y 0 → F2 x 200 at y 15 → F3 x 250, along z 60);
 * the same with a hillside-steep 0.4 ramp (G0 x 100 → G1 x 150 at y 0 → G2 x 200 at y 20 → G3 x 250, along z 120);
 * and a terrace: a lower street (T0 x 100 → T1 x 200 at y 0, z 200), a 0.4 ramp north from T1 up to T2 (x 200, y 4,
 * z 210), and the terrace street back west above the lower one (T2 → T3 x 140, z 210; its strip overlaps the lower's).
 */
export const slopesCity = (spawns: CityMap['thiefSpawns'] = []): CityMap => {
  const city = thiefCity(spawns);
  const node = (id: string, x: number, y: number, z: number) => ({ id, p: vec3(x, y, z), plaza: false });
  const edge = (a: string, b: string) => ({ a, b, halfWidth: 6, long: false });
  city.streets = {
    nodes: [
      node('S0', 100, 0, 0), node('M', 200, 20, 0), node('S1', 300, 40, 0),
      node('F0', 100, 0, 60), node('F1', 150, 0, 60), node('F2', 200, 15, 60), node('F3', 250, 15, 60),
      node('G0', 100, 0, 120), node('G1', 150, 0, 120), node('G2', 200, 20, 120), node('G3', 250, 20, 120),
      node('T0', 100, 0, 200), node('T1', 200, 0, 200), node('T2', 200, 4, 210), node('T3', 140, 4, 210),
    ],
    edges: [
      edge('S0', 'M'), edge('M', 'S1'),
      edge('F0', 'F1'), edge('F1', 'F2'), edge('F2', 'F3'),
      edge('G0', 'G1'), edge('G1', 'G2'), edge('G2', 'G3'),
      edge('T0', 'T1'), edge('T1', 'T2'), edge('T2', 'T3'),
    ],
  };
  return city;
};
