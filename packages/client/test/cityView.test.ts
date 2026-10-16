import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CatalogIndex, parseCatalog, vec3, type CityLayout, type CityMap, type Lot, type Solid, type Vec3 } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { buildBlockMeshes } from '../src/render/city/blockMeshes';
import { CityView } from '../src/render/city/CityView';
import { ModelLoader } from '../src/render/city/modelLoader';

const cfg = clientConfig.city;
const [R0, R1, R2] = cfg.lodRadii as [number, number, number];
const PIZZA = 'mega/Pizza_01';
const OFFICE = 'mega/Office_01';
const cat = new CatalogIndex(
  parseCatalog({
    version: 1,
    packs: {},
    entries: [
      { id: PIZZA, file: 'x.glb', category: 'food', size: { w: 7, h: 8, d: 7 }, pivot: { x: 0, z: 0, minY: 0 }, use: 'placed' },
      { id: OFFICE, file: 'y.glb', category: 'office', size: { w: 7, h: 8, d: 7 }, use: 'placed' },
    ],
  }),
);

let n = 0;
const lot = (block: string, asset: string, x: number, z: number): Lot => ({
  id: `lot-${n++}`, asset, rect: { minX: x, maxX: x + 7, minZ: z, maxZ: z + 7 }, y: 10, facing: 'N', level: 'L1',
  district: 'market', block, name: '', address: '', door: null, upperDoor: null, prop: false, open: false,
});

// Nine blocks along +x every 200 m (block k spans x 200k..200k + 40): two pizzerias and two offices each.
const BLOCKS = 9;
const lots: Lot[] = [];
const blocks = [];
for (let k = 0; k < BLOCKS; k++) {
  const x = 200 * k;
  blocks.push({ id: `b${k}`, rect: { minX: x, maxX: x + 40, minZ: 0, maxZ: 10 }, level: 'L1', district: 'market', alley: false });
  lots.push(lot(`b${k}`, PIZZA, x, 0), lot(`b${k}`, OFFICE, x + 10, 0), lot(`b${k}`, PIZZA, x + 20, 0), lot(`b${k}`, OFFICE, x + 30, 0));
}
const solid = (id: string, kind: Solid['kind'], c: Vec3, s: Vec3): Solid => ({ id, kind, center: c, size: s });
const layout = { blocks, lots, roads: [], areas: [] } as unknown as CityLayout;
const map = {
  kind: 'city',
  layout,
  size: 1800,
  chunkSize: 100,
  // One level ground slab whose centre (and so its region) is 1,500 m away but which runs under the player, and a
  // small parapet out there.
  solids: [solid('ground-L1', 'ground', vec3(1500, 9, 0), vec3(3200, 2, 40)), solid('far', 'parapet', vec3(1760, 10.5, 0), vec3(4, 1, 4))],
} as unknown as CityMap;

const flush = () => new Promise((r) => setTimeout(r, 0));
const origin = vec3(0, 10, 0);
const tris = (m: THREE.Mesh): number => (m.geometry.index ? m.geometry.index.count : (m.geometry.getAttribute('position')?.count ?? 0)) / 3;

/** A loader serving `ids` as a 1 m box, every other id a 404. */
function loaderFor(ids: string[]): ModelLoader {
  const gltf = {
    loadAsync: async (url: string) => {
      if (!ids.some((id) => url === `packs/${id}.glb`)) throw new Error('HTTP 404');
      return { scene: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: 'flat' })) };
    },
  } as unknown as GLTFLoader;
  const quiet = console.warn;
  console.warn = () => undefined;
  const ml = new ModelLoader('packs/', gltf);
  queueMicrotask(() => (console.warn = quiet));
  return ml;
}

/** Runs updates (with model loads settling between them) until nothing changes. */
async function settle(view: CityView, at: Vec3, camera?: THREE.Camera): Promise<void> {
  for (let i = 0; i < 40; i++) {
    view.update(at, camera);
    await flush();
  }
}

const allInstanced = (view: CityView): THREE.InstancedMesh[] => {
  const out: THREE.InstancedMesh[] = [];
  view.group.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o as THREE.InstancedMesh);
  });
  return out;
};

describe('CityView', () => {
  it('with every model missing, every block mesh is visible within lodRadii[2] and hidden beyond', async () => {
    const meshes = buildBlockMeshes(map, cat);
    const view = CityView.create(map, cat, meshes, cfg, new ModelLoader('packs/', {} as GLTFLoader, { manifest: null }));
    await settle(view, origin);
    for (let k = 0; k < BLOCKS; k++) {
      expect(meshes.get(`b${k}`)!.visible, `b${k}`).toBe(200 * k <= R2);
      expect(tris(meshes.get(`b${k}`)!)).toBe(4 * 12);
    }
    expect(allInstanced(view).every((m) => m.count === 0)).toBe(true);
    expect(view.stats()).toMatchObject({ instances: 0, models: 0, missing: 2 });
    expect(view.stats().blocks).toBe([...meshes.values()].filter((m) => m.visible).length);
  });

  it('regions are culled by their bounding sphere: the long ground slab stays, the far parapet goes', async () => {
    const view = CityView.create(map, cat, buildBlockMeshes(map, cat), cfg, new ModelLoader('packs/', {} as GLTFLoader, { manifest: null }));
    await settle(view, origin);
    const regions = view.group.children.filter((c) => c.name.startsWith('region '));
    const ground = regions.find((r) => r.children.some((c) => c.name === 'region-ground'))!;
    const far = regions.find((r) => r.children.some((c) => c.name === 'region-solids'))!;
    expect(ground.visible).toBe(true);
    expect(far.visible).toBe(false);
  });

  it('a loaded id is instanced within lodRadii[1] (LOD0 / LOD1 by distance) and its blocks are rebuilt without it', async () => {
    const meshes = buildBlockMeshes(map, cat);
    const view = CityView.create(map, cat, meshes, cfg, loaderFor([PIZZA]));
    await settle(view, origin);
    const near = lots.filter((l) => l.asset === PIZZA && Math.hypot((l.rect.minX + l.rect.maxX) / 2, 3.5) <= R1);
    expect(near.length).toBe(4);
    const inst = allInstanced(view);
    const total = inst.reduce((s, m) => s + m.count, 0);
    expect(total).toBe(near.length);
    const lod0 = inst.find((m) => m.name === `city-lod0 ${PIZZA}`)!;
    expect(lod0.count).toBe(near.filter((l) => Math.hypot((l.rect.minX + l.rect.maxX) / 2, 3.5) <= R0).length);
    expect(lod0.castShadow).toBe(true);
    // blocks 0 and 1 hold those lots: rebuilt with the offices only; block 2 (400 m) still has its pizza boxes
    expect(tris(meshes.get('b0')!)).toBe(2 * 12);
    expect(tris(meshes.get('b1')!)).toBe(2 * 12);
    expect(tris(meshes.get('b2')!)).toBe(4 * 12);
    expect(view.stats()).toMatchObject({ instances: 4, models: 1, missing: 1 });

    // walking away: the lots go back to boxes and the instances go
    await settle(view, vec3(1600, 10, 0));
    expect(tris(meshes.get('b0')!)).toBe(4 * 12);
    expect(tris(meshes.get('b8')!)).toBe(2 * 12);
    expect(tris(meshes.get('b7')!)).toBe(2 * 12); // 160–200 m back
    expect(tris(meshes.get('b6')!)).toBe(4 * 12);
    expect(view.stats().instances).toBe(4);
  });

  it('rebuilds at most one block per frame', async () => {
    const meshes = buildBlockMeshes(map, cat);
    const view = CityView.create(map, cat, meshes, cfg, loaderFor([PIZZA]));
    view.update(origin);
    await flush();
    view.update(origin);
    const rebuilt = () => [...meshes.values()].filter((m) => tris(m) === 2 * 12).length;
    expect(rebuilt()).toBe(1);
    view.update(origin);
    expect(rebuilt()).toBe(2);
  });

  it('every InstancedMesh bounding sphere holds all its instances after a 1,500 m teleport (SP2 Review Focus 5)', async () => {
    const view = CityView.create(map, cat, buildBlockMeshes(map, cat), cfg, loaderFor([PIZZA, OFFICE]));
    const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.1, 1000);
    const look = (p: Vec3, x: number) => {
      camera.position.set(p.x - 5, p.y + 5, p.z + 20);
      camera.lookAt(x, p.y, 0);
      camera.updateMatrixWorld();
    };
    look(origin, 100);
    await settle(view, origin, camera);
    expect(view.stats().instances).toBeGreaterThan(0);
    expect(view.boundsOk()).toBe(true);
    const far = vec3(1500, 10, 0);
    look(far, 1600);
    view.update(far, camera);
    expect(view.boundsOk()).toBe(true);
    await settle(view, far, camera);
    expect(view.boundsOk()).toBe(true);
    for (const m of allInstanced(view)) {
      if (m.count === 0) continue;
      const a = m.instanceMatrix.array;
      for (let k = 0; k < m.count; k++) {
        const p = new THREE.Vector3(a[k * 16 + 12], a[k * 16 + 13], a[k * 16 + 14]);
        expect(m.boundingSphere!.distanceToPoint(p)).toBeLessThanOrEqual(1e-3);
      }
    }
  });

  it('instances outside the camera frustum are not drawn', async () => {
    const view = CityView.create(map, cat, buildBlockMeshes(map, cat), cfg, loaderFor([PIZZA]));
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 20, 300);
    camera.lookAt(0, 20, 1000); // looking away from every lot
    camera.updateMatrixWorld();
    await settle(view, origin, camera);
    expect(view.stats().instances).toBe(0);
    expect(view.stats().models).toBe(1);
  });
});
