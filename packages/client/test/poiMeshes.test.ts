import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { expandGreybox, ordersConfig, vec3, type GreyboxSource, type MapData, type Poi } from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { buildPoiMeshes } from '../src/render/poiMeshes';
import { palette } from '../src/render/palette';

const map = expandGreybox(greybox as GreyboxSource);

const poi = (id: string, roles: Poi['roles'], x: number): Poi => ({
  id,
  position: vec3(x, 0, 0),
  district: 'downtown',
  kind: 'door',
  name: `Test ${id}`,
  roles,
});

const testMap: MapData = {
  ...map,
  pois: [
    poi('food', ['foodPickup'], 0),
    poi('pkg', ['packagePickup'], 10),
    poi('drop', ['dropoffFood', 'dropoffPackage'], 20),
    poi('both', ['dropoffFood', 'packagePickup', 'foodPickup'], 30),
  ],
};

const markersOf = (g: THREE.Group): THREE.InstancedMesh => g.getObjectByName('poi-markers') as THREE.InstancedMesh;
const colorOf = (m: THREE.InstancedMesh, i: number): number => {
  const c = new THREE.Color();
  m.getColorAt(i, c);
  return c.getHex();
};
const yOf = (m: THREE.InstancedMesh, i: number): number => {
  const mat = new THREE.Matrix4();
  m.getMatrixAt(i, mat);
  return new THREE.Vector3().setFromMatrixPosition(mat).y;
};
const hex = (n: number): number => new THREE.Color(n).getHex();

describe('buildPoiMeshes', () => {
  it('one marker per POI, coloured by its first pickup role or dropoff', () => {
    const pm = buildPoiMeshes(testMap, ordersConfig.zones.poiRadius);
    const m = markersOf(pm.group);
    expect(m.count).toBe(4);
    expect(colorOf(m, 0)).toBe(hex(palette.poiFood));
    expect(colorOf(m, 1)).toBe(hex(palette.poiPackage));
    expect(colorOf(m, 2)).toBe(hex(palette.poiDrop));
    // The first pickup role wins over a dropoff role listed before it.
    expect(colorOf(m, 3)).toBe(hex(palette.poiPackage));
    // The real map draws every POI.
    expect(markersOf(buildPoiMeshes(map, ordersConfig.zones.poiRadius).group).count).toBe(map.pois.length);
    expect(() => buildPoiMeshes({ ...map, pois: [] }, 3)).not.toThrow();
  });

  it('setTargets raises only the targeted markers', () => {
    const pm = buildPoiMeshes(testMap, 3);
    const m = markersOf(pm.group);
    const rest = [0, 1, 2, 3].map((i) => yOf(m, i));
    pm.setTargets(new Set(['pkg', 'drop']));
    expect(yOf(m, 0)).toBe(rest[0]);
    expect(yOf(m, 1)).toBeGreaterThan(rest[1]!);
    expect(yOf(m, 2)).toBeGreaterThan(rest[2]!);
    expect(yOf(m, 3)).toBe(rest[3]);
    pm.setTargets(new Set());
    expect([0, 1, 2, 3].map((i) => yOf(m, i))).toEqual(rest);
  });

  it('setHighlight brightens one marker and keeps the role colour of the others', () => {
    const pm = buildPoiMeshes(testMap, 3);
    const m = markersOf(pm.group);
    pm.setHighlight('food');
    expect(colorOf(m, 0)).not.toBe(hex(palette.poiFood));
    expect(colorOf(m, 1)).toBe(hex(palette.poiPackage));
    pm.setHighlight(null);
    expect(colorOf(m, 0)).toBe(hex(palette.poiFood));
  });
});
