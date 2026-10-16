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

  it('a model of two materials is one geometry with two groups and a material per group', async () => {
    const textures: string[] = [];
    const { loader } = fakeLoader(() => model('tex:abc.jpg', 'flat'));
    const ml = new ModelLoader('packs/', loader, {
      loadTexture: (url) => {
        textures.push(url);
        return new THREE.Texture();
      },
    });
    ml.request('glass');
    await flush();
    const m = ml.get('glass') as PieceModels;
    expect(m.lod0.groups).toHaveLength(2);
    expect(Array.isArray(m.material) && m.material.length).toBe(2);
    expect(textures).toEqual(['packs/textures/abc.jpg']);
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
});
