import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cityConfig, vec3, type AccessZone, type CityMap, type Lot, type Poi, type PoiRole } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { mapDebugColors } from '../src/render/palette';
import { lotLabel, lotRoles, MapDebugView, type LabelPainter } from '../src/ui/mapDebug';

const bands = cityConfig.orderRules.bands;
/** The view's radius in these tests (the fixture lots sit around it); config's own is only checked to be positive. */
const labelRadius = 80;

const rect = (x: number, z: number) => ({ minX: x - 5, minZ: z - 5, maxX: x + 5, maxZ: z + 5 });
const lot = (id: string, x: number, z: number): Lot =>
  ({ id, asset: 'box', rect: rect(x, z), y: 10, facing: 'S', level: 'L1', district: 'downtown', block: 'b', name: id, address: '', door: vec3(x, 10, z - 5), upperDoor: null, prop: false, open: false }) as Lot;
const poi = (lotId: string, roles: PoiRole[], x: number, z: number, upper = false): Poi =>
  ({ id: upper ? `${lotId}-upper` : lotId, lotId, position: vec3(x, 10, z), district: 'downtown', kind: 'door', name: lotId, roles, ...(upper ? { upper: true } : {}) }) as Poi;
const zone = (id: string, kind: AccessZone['kind'], x: number): AccessZone => ({ id, kind, rect: rect(x, 0), minY: 10, maxY: 10 });

// Along +x from the player at the origin: lots at 0, 50, 79 m (labelled) and 81, 400, 900 m (not).
const lots = [lot('lot-a', 0, 0), lot('lot-b', 50, 0), lot('lot-c', 79, 0), lot('lot-d', 81, 0), lot('lot-e', 400, 0), lot('lot-f', 900, 0)];
const pois = [
  poi('lot-a', ['foodPickup', 'dropoffFood'], 0, -5),
  poi('lot-a', ['dropoffFood'], 0, -5, true), // the upper door adds nothing new
  poi('lot-c', ['dropoffPackage'], 79, -5),
  poi('lot-d', ['packagePickup'], 81, -5),
  poi('lot-e', ['dropoffFood'], 400, -5),
  poi('lot-f', ['dropoffPackage'], 900, -5),
];
const city = {
  kind: 'city',
  size: 1200,
  chunkSize: 100,
  layout: { lots },
  pois,
  accessZones: [zone('z1', 'alley', 20), zone('z2', 'alley', 300), zone('z3', 'stairs', 40), zone('z4', 'path', 60)],
  orderRules: { bands },
} as unknown as CityMap;

describe('lot labels (Decision 7)', () => {
  it('roles per lot come from its POIs (door and upper door, no repeats); a lot without POIs has none', () => {
    const roles = lotRoles(city);
    expect(roles.get('lot-a')).toEqual(['foodPickup', 'dropoffFood']);
    expect(roles.get('lot-c')).toEqual(['dropoffPackage']);
    expect(roles.get('lot-b')).toBeUndefined();
  });

  it('a label is the lot id and its roles', () => {
    expect(lotLabel('lot-L1-4-1-7', ['foodPickup', 'dropoffFood'])).toBe('lot-L1-4-1-7 · foodPickup, dropoffFood');
    expect(lotLabel('lot-L1-0-1-0', [])).toBe('lot-L1-0-1-0');
  });
});

describe('MapDebugView', () => {
  const painted: string[] = [];
  const paint: LabelPainter = (text) => {
    painted.push(text);
    return { texture: new THREE.Texture(), aspect: 4 };
  };
  const build = (): { scene: THREE.Scene; view: MapDebugView } => {
    const scene = new THREE.Scene();
    return { scene, view: new MapDebugView(scene, city, { labelRadius }, paint) };
  };

  it('starts hidden in the scene and toggles with setVisible; update does nothing while hidden', () => {
    const { scene, view } = build();
    expect(scene.children).toContain(view.group);
    expect(view.visible).toBe(false);
    view.update(vec3(0, 10, 0), []);
    expect(view.debug().labels).toEqual([]);
    view.setVisible(true);
    expect(view.group.visible).toBe(true);
    view.setVisible(false);
    expect(view.debug().visible).toBe(false);
  });

  it(`labels lots within ${labelRadius} m with their id and roles; one beyond gets none`, () => {
    expect(clientConfig.city.labelRadius).toBeGreaterThan(0);
    const { view } = build();
    view.setVisible(true);
    view.update(vec3(0, 10, 0), []);
    // lot-d's rect centre is 81 m away: no label.
    expect(view.debug().labels).toEqual(['lot-a · foodPickup, dropoffFood', 'lot-b', 'lot-c · dropoffPackage']);
    // Moved 400 m east: only lot-e is near; the earlier labels are hidden, not repainted.
    view.update(vec3(400, 10, 0), []);
    expect(view.debug().labels).toEqual(['lot-e · dropoffFood']);
    const before = painted.length;
    view.update(vec3(0, 10, 0), []);
    view.update(vec3(0, 10, 0), []);
    expect(painted.length).toBe(before);
  });

  it('marks every lot with roles by its distance band from the player (city order bands)', () => {
    expect(bands).toEqual({ shortMax: 350, mediumMax: 800 });
    const { view } = build();
    view.setVisible(true);
    view.update(vec3(0, 10, 0), []);
    // From x = 0: lot-a, c, d short; e (400 m) medium; f (900 m) long. lot-b has no roles: no beam.
    expect(view.debug().beams).toBe(5);
    expect(view.debug().bands).toEqual({ short: 3, medium: 1, long: 1 });
    const beams = view.group.getObjectByName('map-debug-beams') as THREE.InstancedMesh;
    const c = new THREE.Color();
    const hex = (n: number): number => new THREE.Color(n).getHex();
    expect((beams.getColorAt(4, c), c.getHex())).toBe(hex(mapDebugColors.long));
    // From x = 900 the bands turn round.
    view.update(vec3(900, 10, 0), []);
    expect(view.debug().bands).toEqual({ short: 1, medium: 1, long: 3 });
    expect((beams.getColorAt(4, c), c.getHex())).toBe(hex(mapDebugColors.short));
  });

  it('draws the city chunk grid and tints exactly the physics-loaded chunks', () => {
    const { view } = build();
    view.setVisible(true);
    const grid = view.group.getObjectByName('map-debug-grid') as THREE.LineSegments;
    // 1200 m in 100 m chunks: 13 lines each way, two vertices per line.
    expect(grid.geometry.getAttribute('position').count).toBe(13 * 2 * 2);
    view.update(vec3(0, 10, 0), ['0,0', '1,0', '0,1']);
    expect(view.debug().chunks).toBe(3);
    const tints = view.group.getObjectByName('map-debug-chunks') as THREE.InstancedMesh;
    const corners: string[] = [];
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < tints.count; i++) {
      tints.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      corners.push(`${p.x},${p.z}`);
    }
    expect(corners.sort()).toEqual(['0,0', '0,100', '100,0']);
    view.update(vec3(0, 10, 0), ['5,5']);
    expect(view.debug().chunks).toBe(1);
  });

  it('outlines the access zones, coloured and counted by kind', () => {
    const { view } = build();
    expect(view.debug().zones).toEqual({ alley: 2, stairs: 1, path: 1 });
    const outlines = view.group.getObjectByName('map-debug-zones') as THREE.LineSegments;
    // Four edges per zone, two vertices each.
    expect(outlines.geometry.getAttribute('position').count).toBe(4 * 8);
    expect(outlines.geometry.getAttribute('color').count).toBe(4 * 8);
  });
});
