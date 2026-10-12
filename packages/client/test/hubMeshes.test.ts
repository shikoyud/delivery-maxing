import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { expandGreybox, ordersConfig, vec3, type GreyboxSource } from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { buildHubMeshes } from '../src/render/hubMeshes';
import { palette } from '../src/render/palette';
import { buildWaypoints } from '../src/render/waypoints';

const map = expandGreybox(greybox as GreyboxSource);

describe('buildHubMeshes', () => {
  it('draws every POI with two instanced meshes and highlights current targets', () => {
    const hub = buildHubMeshes(map, ordersConfig.zones.poiRadius);
    const posts = hub.group.getObjectByName('poi-posts') as THREE.InstancedMesh;
    expect(posts.count).toBe(map.pois.length);
    expect(hub.group.children).toHaveLength(4); // decals, kiosk, posts, rings
    const colorOf = (i: number): number => {
      const c = new THREE.Color();
      posts.getColorAt(i, c);
      return c.getHex();
    };
    const target = map.pois[1]!.id;
    hub.setTargets(new Set([target]));
    expect(hub.isTarget(target)).toBe(true);
    expect(colorOf(1)).toBe(new THREE.Color(palette.poiTarget).getHex());
    expect(colorOf(0)).toBe(new THREE.Color(palette.poiIdle).getHex());
    hub.setTargets(new Set());
    expect(colorOf(1)).toBe(new THREE.Color(palette.poiIdle).getHex());
  });

  it('copes with any number of POIs, including none', () => {
    const many = { ...map, pois: Array.from({ length: 25 }, (_, i) => ({ ...map.pois[0]!, id: `p${i}`, position: vec3(i * 10, 0, 0) })) };
    expect((buildHubMeshes(many, 3).group.getObjectByName('poi-posts') as THREE.InstancedMesh).count).toBe(25);
    expect(() => buildHubMeshes({ ...map, pois: [] }, 3)).not.toThrow();
  });
});

describe('buildWaypoints', () => {
  it('shows one beam per target, capped at the slot count', () => {
    const w = buildWaypoints(2, 1);
    expect(w.mesh.count).toBe(0);
    w.update([vec3(1, 0, 2)], 0);
    expect(w.mesh.count).toBe(1);
    w.update([vec3(1, 0, 2), vec3(3, 0, 4), vec3(5, 0, 6)], 0);
    expect(w.mesh.count).toBe(2);
  });
});
