import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { vec3, type CityLayout, type MapData, type Road, type Solid } from '@dm/shared';
import { areaTiers, buildRegionMeshes, cutIntervals, regionOf } from '../src/render/city/regions';
import { cityPalette, kindColor } from '../src/render/palette';

describe('regionOf', () => {
  it('(249.9, 0) and (250, 0) fall in different 250 m regions', () => {
    expect(regionOf(249.9, 0, 250)).not.toBe(regionOf(250, 0, 250));
    expect(regionOf(0, 0, 250)).toBe(regionOf(249.9, 249.9, 250));
    expect(regionOf(-0.1, 0, 250)).not.toBe(regionOf(0, 0, 250));
  });
});

describe('buildRegionMeshes', () => {
  const solid = (id: string, kind: Solid['kind'], x: number, z: number): Solid => ({
    id,
    kind,
    center: vec3(x, 0.5, z),
    size: vec3(10, 1, 10),
  });
  const map = {
    kind: 'greybox',
    size: 1000,
    solids: [
      solid('g1', 'ground', 10, 10),
      solid('t1', 'terrain', 20, 20),
      solid('p1', 'parapet', 30, 30),
      solid('b1', 'building', 40, 40),
      solid('pr1', 'prop', 45, 45),
      solid('g2', 'ground', 300, 10),
      solid('b2', 'building', 310, 10),
    ],
  } as unknown as MapData;

  const vertexCount = (m: THREE.Mesh): number => m.geometry.getAttribute('position').count;
  const solidsOf = (g: THREE.Group): THREE.Mesh => g.children.find((c) => c.name === 'region-solids') as THREE.Mesh;

  it('merges the non-lot solids per region into one mesh per depth layer (solids, terrain, ground); buildings and props are the blocks', () => {
    const regions = buildRegionMeshes(map, 250);
    expect([...regions.keys()].sort()).toEqual([regionOf(10, 10, 250), regionOf(300, 10, 250)].sort());
    const a = regions.get(regionOf(10, 10, 250))!;
    const meshes = a.children as THREE.Mesh[];
    expect(meshes.map((m) => m.name).sort()).toEqual(['region-ground', 'region-solids', 'region-terrain']);
    const solids = solidsOf(a);
    expect(vertexCount(solids)).toBe(24); // the parapet; the building and the prop are not region geometry
    expect(solids.geometry.getAttribute('color')).toBeDefined();
    expect(solids.castShadow).toBe(true);
    const terrain = meshes.find((m) => m.name === 'region-terrain')!;
    expect(vertexCount(terrain)).toBe(24);
    expect(terrain.castShadow).toBe(true);
    const ground = meshes.find((m) => m.name === 'region-ground')!;
    expect(vertexCount(ground)).toBe(24);
    expect(ground.castShadow).toBe(false);
    // depth layers: the ground is pushed back furthest, then the terrain lying on it, then the solids on both
    const units = (m: THREE.Mesh) => (m.material as THREE.Material).polygonOffsetUnits;
    expect(units(ground)).toBeGreaterThan(units(terrain));
    expect(units(terrain)).toBeGreaterThan(units(solids));
    // the second region has only ground (its building is a block): no empty solids mesh
    expect(regions.get(regionOf(300, 10, 250))!.children.map((c) => c.name)).toEqual(['region-ground']);
  });

  it('a road solid is asphalt with a lighter sidewalk strip along each long side; ramps and stairs the same', () => {
    for (const kind of ['road', 'ramp', 'stairs'] as const) {
      const m = { ...map, solids: [{ ...solid('r', kind, 10, 10), size: vec3(6, 1, 40) }] } as MapData;
      const mesh = solidsOf(buildRegionMeshes(m, 250).get(regionOf(10, 10, 250))!);
      expect(vertexCount(mesh)).toBe(3 * 24);
      mesh.geometry.computeBoundingBox();
      expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(0.02, 5); // drawn a road lift above its collider
      const color = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const asphalt = new THREE.Color().fromBufferAttribute(color, 0);
      const strip = new THREE.Color().fromBufferAttribute(color, 24);
      const l = (c: THREE.Color) => c.getHSL({ h: 0, s: 0, l: 0 }).l;
      expect(l(strip)).toBeGreaterThan(l(asphalt) + 0.1);
      // the strips run along z (the long side) on top of the deck
      mesh.geometry.computeBoundingBox();
      expect(mesh.geometry.boundingBox!.max.y).toBeGreaterThan(1);
    }
  });

  it('water is a flat blue and terrain green-grey', () => {
    const water = new THREE.Color(kindColor.water).getHSL({ h: 0, s: 0, l: 0 });
    expect(water.h).toBeGreaterThan(0.5);
    expect(water.h).toBeLessThan(0.65);
    const terrain = new THREE.Color(kindColor.terrain).getHSL({ h: 0, s: 0, l: 0 });
    expect(terrain.h).toBeGreaterThan(0.2);
    expect(terrain.h).toBeLessThan(0.45);
    expect(terrain.s).toBeLessThan(0.35);
  });

  it('city: the layout streets (no solids of their own) are drawn on the ground as asphalt with sidewalk strips', () => {
    const road: Road = { id: 'road-1', kind: 'street', rect: { minX: 0, maxX: 100, minZ: 0, maxZ: 12 }, y: 10, name: 'Elm Street' };
    const layout = { roads: [road], areas: [] } as unknown as CityLayout;
    const city = { ...map, kind: 'city', layout, solids: [] } as unknown as MapData;
    const regions = buildRegionMeshes(city, 250);
    const mesh = regions.get(regionOf(50, 6, 250))!.children.find((c) => c.name === 'region-streets') as THREE.Mesh;
    expect(vertexCount(mesh)).toBe(3 * 24);
    expect((mesh.material as THREE.Material).polygonOffsetUnits).toBeLessThan(0); // nearest depth layer: over the decks that cross it
    mesh.geometry.computeBoundingBox();
    const b = mesh.geometry.boundingBox!;
    expect(b.min.y).toBeGreaterThanOrEqual(10);
    expect(b.max.y).toBeLessThan(10.2);
    expect([b.min.x, b.max.x, b.min.z, b.max.z]).toEqual([0, 100, 0, 12]);
  });

  it('cutIntervals removes the cuts from the range and drops slivers', () => {
    expect(cutIntervals(0, 100, [])).toEqual([[0, 100]]);
    expect(cutIntervals(0, 100, [[40, 52]])).toEqual([[0, 40], [52, 100]]);
    expect(cutIntervals(0, 100, [[-10, 12], [90, 120], [40, 52], [45, 60]])).toEqual([[12, 40], [60, 90]]);
    expect(cutIntervals(0, 100, [[0.02, 100]])).toEqual([]); // a 2 cm sliver is not a kerb
  });

  it('city: the sidewalk strips stop at a crossing street, so no kerb runs across the intersection', () => {
    const road = (id: string, rect: [number, number, number, number], y = 10): Road =>
      ({ id, kind: 'street', rect: { minX: rect[0], maxX: rect[1], minZ: rect[2], maxZ: rect[3] }, y, name: id }) as Road;
    const top = road('top', [0, 300, 148, 160]);
    const cross = road('cross', [114, 126, 0, 160]); // ends inside the top street
    const other = road('other', [50, 62, 0, 100], 24); // another level: no cut
    const layout = { roads: [top, cross, other], areas: [] } as unknown as CityLayout;
    const city = { ...map, kind: 'city', layout, solids: [] } as unknown as MapData;
    const regions = buildRegionMeshes(city, 1000);
    const mesh = regions.get(regionOf(150, 154, 1000))!.children.find((c) => c.name === 'region-streets') as THREE.Mesh;
    // top: deck + 2 strips each cut once into 2 → 5 boxes; cross: deck + 2 strips shortened at their far end → 3; other: 3
    expect(vertexCount(mesh)).toBe((5 + 3 + 3) * 24);
    const pos = mesh.geometry.getAttribute('position');
    const col = mesh.geometry.getAttribute('color');
    const kerb = new THREE.Color(cityPalette.sidewalk);
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(col.getX(i) - kerb.r) > 1e-3 || Math.abs(pos.getY(i) - 10) > 1) continue;
      const [x, z] = [pos.getX(i), pos.getZ(i)];
      // no kerb vertex strictly inside the intersection (114..126 × 148..160)
      expect(x > 114.01 && x < 125.99 && z > 148.01 && z < 159.99).toBe(false);
    }
  });

  it('city: areas lying on a larger area at the same height are drawn a lift step above it, so nothing fights (the quay, its rail and yard)', () => {
    const area = (id: string, kind: string, rect: [number, number, number, number], y = 2) =>
      ({ id, kind, rect: { minX: rect[0], maxX: rect[1], minZ: rect[2], maxZ: rect[3] }, y }) as unknown as CityLayout['areas'][number];
    const quay = area('quay', 'quay', [0, 380, 110, 255]);
    const rail = area('rail', 'rail', [0, 340, 236, 246]);
    const yard = area('yard', 'containerYard', [20, 200, 120, 184]);
    const gas = area('gas', 'gasLot', [348, 366, 228, 243]);
    const park = area('park', 'park', [500, 560, 120, 184]); // beside, not on, the quay
    const upper = area('upper', 'plaza', [0, 380, 110, 255], 10); // same rect, another terrace
    const tiers = new Map(areaTiers([rail, gas, quay, park, yard, upper]).map(([a, t]) => [a.id, t]));
    expect(tiers.get('quay')).toBe(0);
    expect(tiers.get('park')).toBe(0);
    expect(tiers.get('upper')).toBe(0);
    expect(tiers.get('rail')).toBe(1);
    expect(tiers.get('yard')).toBe(1);
    expect(tiers.get('gas')).toBe(1);

    const layout = { roads: [], areas: [quay, rail] } as unknown as CityLayout;
    const city = { ...map, kind: 'city', layout, solids: [] } as unknown as MapData;
    const mesh = buildRegionMeshes(city, 250).get(regionOf(190, 182, 250))!.children.find((c) => c.name === 'region-flats-1') as THREE.Mesh; // the rail is tier 1
    const quayMesh = buildRegionMeshes(city, 250).get(regionOf(190, 182, 250))!.children.find((c) => c.name === 'region-flats-0') as THREE.Mesh;
    expect((quayMesh.material as THREE.Material).polygonOffsetUnits).toBeGreaterThan((mesh.material as THREE.Material).polygonOffsetUnits);
    expect((mesh.material as THREE.Material).polygonOffset).toBe(true); // flats sit in their own depth layer, between ground and solids
    const pos = mesh.geometry.getAttribute('position');
    const tops = new Set<number>();
    for (let i = 0; i < pos.count; i++) tops.add(Math.round(pos.getY(i) * 1000));
    const qpos = quayMesh.geometry.getAttribute('position');
    for (let i = 0; i < qpos.count; i++) tops.add(Math.round(qpos.getY(i) * 1000));
    // two slabs, four distinct heights: the rail's bottom (2.004) sits a lift step above the quay's top (2.003)
    expect([...tops].sort((a, b) => a - b)).toEqual([2001, 2003, 2004, 2006]);
  });
});
