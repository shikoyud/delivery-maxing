import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ModelLoader, type PieceModels } from '../src/render/city/modelLoader';

/** A GLTFLoader stand-in: `serve(url)` gives the scene for a URL, or throws (a 404, a parse failure). */
function fakeLoader(serve: (url: string) => THREE.Object3D) {
  const urls: string[] = [];
  const loader = {
    loadAsync: vi.fn(async (url: string) => {
      urls.push(url);
      return { scene: serve(url) };
    }),
  };
  return { loader: loader as unknown as GLTFLoader, urls };
}

/** What the importer writes: one mesh node whose primitives are `tex:<file>` or `flat` materials. */
function model(...materials: string[]): THREE.Object3D {
  const group = new THREE.Group();
  materials.forEach((name, i) => {
    const g = new THREE.BoxGeometry(1, 1, 1).translate(i * 2, 0.5, 0);
    group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name })));
  });
  return group;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.restoreAllMocks());

describe('ModelLoader', () => {
  it('a 404 marks the id missing after one request and warns once; two requests fetch once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { loader, urls } = fakeLoader(() => {
      throw new Error('HTTP 404');
    });
    const ml = new ModelLoader('packs/', loader);
    ml.request('mega/Bakery_01');
    ml.request('mega/Bakery_01');
    expect(ml.get('mega/Bakery_01')).toBe('loading');
    await flush();
    expect(ml.get('mega/Bakery_01')).toBe('missing');
    ml.request('mega/Bakery_01');
    await flush();
    expect(urls).toEqual(['packs/mega/Bakery_01.glb']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('model missing: mega/Bakery_01');
    expect(ml.stats()).toEqual({ loaded: 0, missing: 1, loading: 0 });
  });

  it('an id never requested is neither loading nor loaded', () => {
    const { loader } = fakeLoader(() => model('flat'));
    expect(new ModelLoader('packs/', loader).get('x')).toBe('missing');
  });

  it('loads LOD0 and, when the manifest lists one, LOD1; one shared material per material name', async () => {
    const { loader, urls } = fakeLoader(() => model('flat'));
    const ml = new ModelLoader('packs/', loader, { manifest: { version: 1, models: { a: { lod1: true }, b: { lod1: false } } } });
    ml.request('a');
    ml.request('b');
    await flush();
    await flush();
    const a = ml.get('a') as PieceModels;
    const b = ml.get('b') as PieceModels;
    expect(a.lod0).toBeInstanceOf(THREE.BufferGeometry);
    expect(a.lod1).toBeInstanceOf(THREE.BufferGeometry);
    expect(b.lod1).toBeNull();
    expect(a.material).toBe(b.material);
    expect(a.material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(urls.sort()).toEqual(['packs/a.glb', 'packs/a.lod1.glb', 'packs/b.glb']);
  });

  it('a textured model with glass is one geometry, no groups, one folded material (RGBA colours, A = 1 untextured)', async () => {
    const textures: string[] = [];
    const { loader } = fakeLoader(() => model('tex:abc.jpg', 'flat'));
    const ml = new ModelLoader('packs/', loader, {
      loadTexture: (url) => {
        textures.push(url);
        return new THREE.Texture();
      },
    });
    ml.request('glass');
    ml.request('glass2');
    await flush();
    const m = ml.get('glass') as PieceModels;
    expect(m.lod0.groups).toHaveLength(0);
    expect(Array.isArray(m.material)).toBe(false);
    const mat = m.material as THREE.MeshLambertMaterial;
    expect(mat.map).toBeInstanceOf(THREE.Texture);
    expect(mat.vertexColors).toBe(true);
    const col = m.lod0.getAttribute('color');
    expect(col.itemSize).toBe(4);
    // 24 vertices per box: the textured box first (A = 0), then the glass (A = 1)
    expect([col.getW(0), col.getW(23), col.getW(24), col.getW(47)]).toEqual([0, 0, 1, 1]);
    expect((ml.get('glass2') as PieceModels).material).toBe(mat);
    expect(textures).toEqual(['packs/textures/abc.jpg']);
  });

  it("a folded model's LOD1 that lost its glass still carries RGBA colours", async () => {
    const { loader } = fakeLoader((url) => (url.endsWith('.lod1.glb') ? model('tex:abc.jpg') : model('tex:abc.jpg', 'flat')));
    const ml = new ModelLoader('packs/', loader, { manifest: { version: 1, models: { g: { lod1: true } } }, loadTexture: () => new THREE.Texture() });
    ml.request('g');
    await flush();
    await flush();
    const m = ml.get('g') as PieceModels;
    expect(m.lod1!.getAttribute('color').itemSize).toBe(4);
    expect(m.lod1!.getAttribute('color').getW(0)).toBe(0);
  });

  it('ids the manifest lacks are missing without a fetch (one warning each); no manifest at all warns once in all', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { loader, urls } = fakeLoader(() => model('flat'));
    const listed = new ModelLoader('packs/', loader, { manifest: { version: 1, models: {} } });
    listed.request('gone');
    listed.request('gone');
    expect(listed.get('gone')).toBe('missing');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockClear();
    const none = new ModelLoader('packs/', loader, { manifest: null });
    for (const id of ['a', 'b', 'c']) none.request(id);
    expect(none.get('a')).toBe('missing');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/not installed/);
    expect(urls).toEqual([]);
  });

  it("a LOD1 left with one of LOD0's two materials gets a group for it (else the InstancedMesh would draw nothing)", async () => {
    // two textures (no fold): one geometry with a group per material; LOD1 kept only the second texture
    const { loader } = fakeLoader((url) => (url.endsWith('.lod1.glb') ? model('tex:b.jpg') : model('tex:a.jpg', 'tex:b.jpg')));
    const ml = new ModelLoader('packs/', loader, {
      manifest: { version: 1, models: { glass: { lod1: true } } },
      loadTexture: () => new THREE.Texture(),
    });
    ml.request('glass');
    await flush();
    await flush();
    const m = ml.get('glass') as PieceModels;
    expect(Array.isArray(m.material)).toBe(true);
    const mats = m.material as THREE.Material[];
    expect(m.lod1!.groups).toHaveLength(1);
    const g = m.lod1!.groups[0]!;
    expect(mats[g.materialIndex!]!.name).toBe('tex:b.jpg');
    expect(g.start).toBe(0);
    expect(g.count).toBeGreaterThanOrEqual(m.lod1!.index!.count);
  });

  it('a listed LOD1 that fails to load warns once and draws LOD0 in its place', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { loader } = fakeLoader((url) => {
      if (url.endsWith('.lod1.glb')) throw new Error('HTTP 404');
      return model('flat');
    });
    const ml = new ModelLoader('packs/', loader, { manifest: { version: 1, models: { a: { lod1: true } } } });
    ml.request('a');
    await flush();
    await flush();
    const m = ml.get('a') as PieceModels;
    expect(m.lod0).toBeInstanceOf(THREE.BufferGeometry);
    expect(m.lod1).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('model LOD1 missing: a');
  });
});
