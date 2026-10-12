import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { expandGreybox, vec3, type GreyboxSource, type Solid } from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { buildGreyboxMeshes, solidColor } from '../src/render/greyboxMeshes';

describe('buildGreyboxMeshes', () => {
  it('merges all static solids into one mesh per kind', () => {
    const map = expandGreybox(greybox as GreyboxSource);
    map.solids.push({ id: 'ramp-1', kind: 'ramp', center: vec3(0, 1, 0), size: vec3(4, 1, 8), rotationDeg: vec3(15, 0, 0) });
    const group = buildGreyboxMeshes(map);
    const kinds = new Set(map.solids.map((s) => s.kind));
    expect(group.children).toHaveLength(kinds.size);
    const buildings = group.children.find((c) => c.name === 'greybox-building') as THREE.Mesh;
    const count = map.solids.filter((s) => s.kind === 'building').length;
    expect(buildings.geometry.getAttribute('position').count).toBe(count * 24);
    expect(buildings.geometry.getAttribute('color')).toBeDefined();
  });

  it('tints solids by a stable hash of their id', () => {
    const s = (id: string): Solid => ({ id, kind: 'building', center: vec3(0, 0, 0), size: vec3(1, 1, 1) });
    expect(solidColor(s('b-1-2-3')).getHex()).toBe(solidColor(s('b-1-2-3')).getHex());
    const distinct = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => solidColor(s(id)).getHex()));
    expect(distinct.size).toBeGreaterThan(1);
  });
});
