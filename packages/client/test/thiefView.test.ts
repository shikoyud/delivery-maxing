import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { PieceCatalog, ThiefMode, ThiefState, Vec3 } from '@dm/shared';
import piecesJson from '../../../map/pieces.json';
import { clientConfig } from '../src/clientConfig';
import { ThiefView } from '../src/render/thieves/ThiefView';

const cfg = clientConfig.thieves;
const pieces = piecesJson as unknown as PieceCatalog;
const thiefPaths = ['c-thief-casual', 'c-thief-longsleeve'].map((id) => pieces[id]!.lod0);

async function view(): Promise<ThiefView> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const models = await Promise.all(
    thiefPaths.map(async (path) => {
      const glb = readFileSync(new URL(`../../../assets/${path}`, import.meta.url));
      return { path, gltf: await loader.parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer, '') };
    }),
  );
  return ThiefView.fromModels(models);
}

function thief(id: string, position: Vec3, over: Partial<{ mode: ThiefMode; heading: number; speed: number }> = {}): ThiefState {
  return { id, position, heading: over.heading ?? 0, speed: over.speed ?? 2.2, mode: over.mode ?? 'patrol', chaseTime: 0, aboveTime: 0, route: [], prevNode: null };
}

const meshesOf = (o: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh);
  });
  return out;
};

const rootOf = (v: ThiefView, id: string): THREE.Object3D => v.group.getObjectByName(`thief-${id}`)!;
const near = { x: 0, y: 0, z: 0 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ThiefView', () => {
  it('draws each thief as one skinned mesh about 1.8 m tall standing on its feet', async () => {
    const v = await view();
    v.update(0, [thief('a', { x: 5, y: 2, z: -3 })], near);
    const root = rootOf(v, 'a');
    const meshes = meshesOf(root);
    expect(meshes).toHaveLength(1);
    expect((meshes[0] as THREE.SkinnedMesh).isSkinnedMesh).toBe(true);
    expect(Array.isArray(meshes[0]!.material)).toBe(false);
    v.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    expect(box.max.y - box.min.y).toBeCloseTo(1.8, 1);
    expect(box.min.y).toBeCloseTo(2, 1);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(5, 0);
  });

  it('faces −Z at heading 0 and turns left with positive heading (the eyes lead)', async () => {
    const v = await view();
    // From the centre of the head (every vertex above HEAD_Y) to the eyes (the darkest vertex colour, Eyes material).
    const HEAD_Y = 1.55;
    const eyes = (heading: number): THREE.Vector3 => {
      v.update(0, [thief('a', near, { heading })], near);
      v.group.updateMatrixWorld(true);
      const mesh = meshesOf(rootOf(v, 'a'))[0] as THREE.SkinnedMesh;
      const color = mesh.geometry.getAttribute('color');
      const p = new THREE.Vector3();
      const eye = new THREE.Vector3();
      const head = new THREE.Vector3();
      let ne = 0;
      let nh = 0;
      for (let i = 0; i < color.count; i++) {
        mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld);
        if (p.y < HEAD_Y) continue;
        head.add(p);
        nh++;
        if (color.getX(i) > 0.025) continue;
        eye.add(p);
        ne++;
      }
      expect(ne).toBeGreaterThan(0);
      return eye.divideScalar(ne).sub(head.divideScalar(nh));
    };
    const ahead0 = eyes(0);
    expect(ahead0.z).toBeLessThan(-0.02);
    expect(Math.abs(ahead0.x)).toBeLessThan(0.01);
    const ahead90 = eyes(Math.PI / 2);
    expect(ahead90.x).toBeLessThan(-0.02); // heading +90° faces −X (facing())
    expect(Math.abs(ahead90.z)).toBeLessThan(0.01);
  });

  it('alternates the two variants and shares their geometry and the one material', async () => {
    const v = await view();
    v.update(0, ['a', 'b', 'c'].map((id) => thief(id, near)), near);
    const [a, b, c] = ['a', 'b', 'c'].map((id) => meshesOf(rootOf(v, id))[0]!);
    expect(a!.geometry).not.toBe(b!.geometry);
    expect(c!.geometry).toBe(a!.geometry);
    expect(a!.material).toBe(b!.material);
    expect((a as THREE.SkinnedMesh).skeleton).not.toBe((c as THREE.SkinnedMesh).skeleton);
  });

  it('only thieves within renderRadius are in the scene and animate', async () => {
    const v = await view();
    const far = { x: cfg.renderRadius + 1, y: 0, z: 0 };
    const inside = { x: 0, y: 0, z: cfg.renderRadius - 1 };
    const states = [thief('near', inside), thief('far', far)];
    v.update(0.1, states, near);
    v.update(0.1, states, near);
    const d = new Map(v.debug().map((x) => [x.id, x]));
    expect(d.get('near')).toMatchObject({ visible: true, loaded: true, clip: 'Man_Walk' });
    expect(d.get('near')!.time).toBeGreaterThan(0);
    expect(d.get('far')).toMatchObject({ visible: false, time: 0 });
    expect(v.group.children.map((c) => c.name)).toEqual(['thief-near']);
    // The player walks over: the far thief joins the scene and starts animating; the near one leaves and freezes.
    const t = v.debug().find((x) => x.id === 'near')!.time;
    v.update(0.1, states, { x: 2 * cfg.renderRadius, y: 0, z: 0 });
    v.update(0.1, states, { x: 2 * cfg.renderRadius, y: 0, z: 0 });
    const e = new Map(v.debug().map((x) => [x.id, x]));
    expect(e.get('far')!.visible).toBe(true);
    expect(e.get('far')!.time).toBeGreaterThan(0);
    expect(e.get('near')).toMatchObject({ visible: false, time: t });
    expect(v.group.children.map((c) => c.name)).toEqual(['thief-far']);
  });

  it('plays thiefClip: run while chasing, punch for punchSeconds after a catch, then the mode clip again', async () => {
    const v = await view();
    const chasing = [thief('a', near, { mode: 'chase', speed: 7 })];
    v.update(0.05, chasing, near);
    expect(v.debug()[0]!.clip).toBe('Man_Run');
    v.caught('a');
    const returning = [thief('a', near, { mode: 'return', speed: 3.5 })];
    v.update(0.05, returning, near);
    expect(v.debug()[0]!.clip).toBe('Man_Punch');
    v.update(cfg.punchSeconds, returning, near);
    expect(v.debug()[0]!.clip).toBe('Man_Punch');
    v.update(0.05, returning, near);
    expect(v.debug()[0]!.clip).toBe('Man_Walk');
  });

  it('falls back to dark capsules with one warning when the models cannot load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken: PieceCatalog = {
      'c-thief-missing': { ...pieces['c-thief-casual']!, id: 'c-thief-missing', lod0: 'city/characters/missing.glb' },
    };
    const v = await ThiefView.load(broken);
    expect(v.loaded).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/^Thief models unavailable/);
    v.update(0.1, [thief('a', { x: 1, y: 0, z: 1 }), thief('b', { x: 2, y: 0, z: 1 })], near);
    const [a, b] = ['a', 'b'].map((id) => meshesOf(rootOf(v, id)));
    expect(a).toHaveLength(1);
    expect(a![0]!.geometry).toBeInstanceOf(THREE.CapsuleGeometry);
    expect(b![0]!.geometry).toBe(a![0]!.geometry);
    expect(v.debug()[0]).toMatchObject({ loaded: false, clip: null, visible: true });
  });
});
