import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { expandGreybox, hospitalBlockId, type GreyboxSource } from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { buildHospitalMeshes } from '../src/render/hospitalMeshes';

const map = expandGreybox(greybox as GreyboxSource);

describe('buildHospitalMeshes', () => {
  it('one cross block and one ring per hospital', () => {
    const g = buildHospitalMeshes(map);
    const blocks = g.getObjectByName('hospital-blocks') as THREE.InstancedMesh;
    const rings = g.getObjectByName('hospital-rings') as THREE.InstancedMesh;
    expect(map.hospitals.length).toBeGreaterThan(0);
    expect(blocks.count).toBe(map.hospitals.length);
    expect(rings.count).toBe(map.hospitals.length);
    map.hospitals.forEach((h, i) => {
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const s = new THREE.Vector3();
      blocks.getMatrixAt(i, m);
      m.decompose(p, new THREE.Quaternion(), s);
      expect([p.x, p.z]).toEqual([h.center.x, h.center.z]);
      rings.getMatrixAt(i, m);
      m.decompose(p, new THREE.Quaternion(), s);
      expect([p.x, p.z]).toEqual([h.center.x, h.center.z]);
      // The ring's outer edge is the safe radius.
      expect(s.x).toBeCloseTo(h.safeRadius, 9);
      expect(s.z).toBeCloseTo(h.safeRadius, 9);
    });
    // Red cross and white block share one mesh (vertex colours): two draw calls for every hospital together.
    expect(g.children).toHaveLength(2);
    expect(() => buildHospitalMeshes({ ...map, hospitals: [] })).not.toThrow();
  });

  it('draws the white block to the size of the hospital solid (render and physics agree)', () => {
    const blocks = buildHospitalMeshes(map).getObjectByName('hospital-blocks') as THREE.InstancedMesh;
    const solid = map.solids.find((s) => s.id === hospitalBlockId(map.hospitals[0]!))!;
    expect(solid.size).toEqual((greybox as GreyboxSource).hospitalBlock);
    blocks.geometry.computeBoundingBox();
    const box = blocks.geometry.boundingBox!;
    // The red crosses sit just proud of the block faces (by less than 0.1 m).
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y - solid.size.y).toBeGreaterThanOrEqual(0);
    expect(box.max.y - solid.size.y).toBeLessThan(0.1);
    expect(box.max.x - solid.size.x / 2).toBeGreaterThanOrEqual(0);
    expect(box.max.x - solid.size.x / 2).toBeLessThan(0.1);
    expect(box.max.z - solid.size.z / 2).toBeLessThan(0.1);
  });
});
