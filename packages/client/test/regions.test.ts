import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { vec3, type MapData, type Solid } from '@dm/shared';
import { buildRegionMeshes, regionOf } from '../src/render/city/regions';

describe('regionOf', () => {
  it('(249.9, 0) and (250, 0) fall in different 250 m regions', () => {
    expect(regionOf(249.9, 0, 250)).not.toBe(regionOf(250, 0, 250));
    expect(regionOf(0, 0, 250)).toBe(regionOf(249.9, 249.9, 250));
    expect(regionOf(-0.1, 0, 250)).not.toBe(regionOf(0, 0, 250));
  });
});

describe('buildRegionMeshes', () => {
  const solid = (id: string, kind: Solid['kind'], x: number, z: number, hidden?: boolean): Solid => ({
    id,
    kind,
    center: vec3(x, 0.5, z),
    size: vec3(10, 1, 10),
    ...(hidden ? { hidden } : {}),
  });
  const map = {
    size: 1000,
    solids: [
      solid('g1', 'ground', 10, 10),
      solid('r1', 'road', 20, 20),
      solid('s1', 'sidewalk', 30, 30),
      solid('b1', 'building', 40, 40, true),
      solid('g2', 'ground', 300, 10),
      solid('b2', 'building', 310, 10, true),
    ],
  } as unknown as MapData;

  it('merges the drawn solids per region into one solids mesh plus one ground mesh, skipping hidden solids', () => {
    const regions = buildRegionMeshes(map, 250);
    expect([...regions.keys()].sort()).toEqual([regionOf(10, 10, 250), regionOf(300, 10, 250)].sort());
    const a = regions.get(regionOf(10, 10, 250))!;
    const meshes = a.children as THREE.Mesh[];
    expect(meshes.map((m) => m.name).sort()).toEqual(['region-ground', 'region-solids']);
    const solids = meshes.find((m) => m.name === 'region-solids')!;
    expect(solids.geometry.getAttribute('position').count).toBe(2 * 24); // road + sidewalk; the hidden building is skipped
    expect(solids.geometry.getAttribute('color')).toBeDefined();
    expect(solids.castShadow).toBe(true);
    const ground = meshes.find((m) => m.name === 'region-ground')!;
    expect(ground.geometry.getAttribute('position').count).toBe(24);
    expect(ground.castShadow).toBe(false);
    // the second region has only ground (its building is hidden): no empty solids mesh
    expect(regions.get(regionOf(300, 10, 250))!.children.map((c) => c.name)).toEqual(['region-ground']);
  });
});
