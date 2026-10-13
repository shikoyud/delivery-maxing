import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { expandGreybox, ordersConfig, vec3, type GreyboxSource } from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { buildHubMeshes, type PoiMarkerOptions } from '../src/render/hubMeshes';
import { palette } from '../src/render/palette';
import { toSun } from '../src/render/Renderer';
import { buildWaypoints, slotColor } from '../src/render/waypoints';

const map = expandGreybox(greybox as GreyboxSource);
/** Draws every greybox POI (the greybox is 600 m across) and casts no shadows. */
const ALL: PoiMarkerOptions = { drawRadius: 10_000, shadow: null };
const origin = vec3(0, 0, 0);
const postsOf = (g: THREE.Group): THREE.InstancedMesh => g.getObjectByName('poi-posts') as THREE.InstancedMesh;
const ringsOf = (g: THREE.Group): THREE.InstancedMesh => g.getObjectByName('poi-rings') as THREE.InstancedMesh;
/** World x of each instance an InstancedMesh draws, in instance order. */
const drawnX = (m: THREE.InstancedMesh): number[] => {
  const out: number[] = [];
  const mat = new THREE.Matrix4();
  for (let i = 0; i < m.count; i++) {
    m.getMatrixAt(i, mat);
    out.push(new THREE.Vector3().setFromMatrixPosition(mat).x);
  }
  return out;
};
/** A row of POIs along +x, one every `step` m from x = 0. */
const rowOf = (n: number, step: number): typeof map => ({
  ...map,
  pois: Array.from({ length: n }, (_, i) => ({ ...map.pois[0]!, id: `p${i}`, position: vec3(i * step, 0, 0) })),
});

describe('buildHubMeshes', () => {
  it('draws every POI with two instanced meshes and highlights current targets', () => {
    const hub = buildHubMeshes(map, ordersConfig.zones.poiRadius, ALL);
    hub.update(origin);
    const posts = postsOf(hub.group);
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
    const many = buildHubMeshes(rowOf(25, 10), 3, ALL);
    many.update(origin);
    expect(postsOf(many.group).count).toBe(25);
    const none = buildHubMeshes({ ...map, pois: [] }, 3, ALL);
    expect(() => none.update(origin)).not.toThrow();
  });

  it('draws only the POIs within drawRadius of the player, plus current targets (Task 19 carried item a)', () => {
    const hub = buildHubMeshes(rowOf(10, 100), 3, { drawRadius: 250, shadow: null });
    const posts = postsOf(hub.group);
    const rings = ringsOf(hub.group);
    hub.update(vec3(0, 0, 0));
    expect(drawnX(posts).sort((a, b) => a - b)).toEqual([0, 100, 200]);
    expect(drawnX(rings).sort((a, b) => a - b)).toEqual([0, 100, 200]);
    hub.update(vec3(600, 0, 0));
    expect(drawnX(posts).sort((a, b) => a - b)).toEqual([400, 500, 600, 700, 800]);
    // A current target is drawn wherever it is, in its target colour.
    hub.setTargets(new Set(['p0']));
    expect(drawnX(posts).sort((a, b) => a - b)).toEqual([0, 400, 500, 600, 700, 800]);
    const at = drawnX(posts).indexOf(0);
    const c = new THREE.Color();
    posts.getColorAt(at, c);
    expect(c.getHex()).toBe(new THREE.Color(palette.poiTarget).getHex());
    posts.getColorAt(drawnX(posts).indexOf(600), c);
    expect(c.getHex()).toBe(new THREE.Color(palette.poiIdle).getHex());
  });

  it('only posts inside the shadow camera cast shadows: they lead the list and the shadow pass draws them alone', () => {
    const extent = 80;
    const hub = buildHubMeshes(rowOf(10, 50), 3, { drawRadius: 1000, shadow: { toSun, extent } });
    const posts = postsOf(hub.group);
    expect(posts.castShadow).toBe(true);
    expect(ringsOf(hub.group).castShadow).toBe(false);
    hub.update(origin);
    const all = drawnX(posts);
    expect(all).toHaveLength(10);
    const args = [{} as THREE.WebGLRenderer, new THREE.Scene(), new THREE.Camera(), new THREE.Camera(), posts.geometry, posts.material as THREE.Material, {} as THREE.Group] as const;
    posts.onBeforeShadow(...args);
    const shadowed = drawnX(posts);
    posts.onAfterShadow(...args);
    expect(posts.count).toBe(10);
    expect(shadowed).toEqual(all.slice(0, shadowed.length));
    // For this sun a post at (x, 0, 0) sits at light-space (~0.55·x, ~0.73·x): inside ±80 m up to x ≈ 105 m.
    expect(shadowed).toContain(0);
    expect(shadowed).toContain(100);
    expect(shadowed).not.toContain(250);
    expect(shadowed).not.toContain(450);
  });

  it('casts no post shadows without a shadow-casting sun', () => {
    const hub = buildHubMeshes(rowOf(3, 10), 3, ALL);
    expect(postsOf(hub.group).castShadow).toBe(false);
  });
});

describe('buildWaypoints', () => {
  it('shows one beam per target, capped at the slot count', () => {
    const w = buildWaypoints(2, 1);
    expect(w.mesh.count).toBe(0);
    w.update([vec3(1, 0, 2)], [0], 0);
    expect(w.mesh.count).toBe(1);
    w.update([vec3(1, 0, 2), vec3(3, 0, 4), vec3(5, 0, 6)], [0, 1, 2], 0);
    expect(w.mesh.count).toBe(2);
  });

  it('colours each beam by its order colour index, not its list position (R29d)', () => {
    const w = buildWaypoints(3, 1);
    w.update([vec3(1, 0, 2), vec3(3, 0, 4)], [2, 0], 0);
    const c = new THREE.Color();
    w.mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(new THREE.Color(slotColor(2)).getHex());
    w.mesh.getColorAt(1, c);
    expect(c.getHex()).toBe(new THREE.Color(slotColor(0)).getHex());
  });
});
