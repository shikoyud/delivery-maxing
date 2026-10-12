import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parsePieceCatalog, vec3, type CityMap, type Prop, type Solid, type Vec3 } from '@dm/shared';
import piecesJson from '../../../map/pieces.json';
import { CityView, type PieceModels } from '../src/render/city/CityView';
import { paletteRow } from '../src/render/city/paletteMaterial';
import { toSun } from '../src/render/Renderer';

const pieces = parsePieceCatalog(piecesJson);
const cfg = { lodRadii: [160, 400, 700], relodDistance: 25, renderRegion: 250 };

/** Props every 50 m along x (and a second row along z), two pieces, alternating palettes. */
function cityWith(props: Prop[], solids: Solid[] = []): CityMap {
  return { kind: 'city', size: 2000, chunkSize: 100, props, solids } as unknown as CityMap;
}
const prop = (i: number, p: Vec3): Prop => ({
  id: `p${i}`,
  piece: i % 2 ? 'b-4story' : 'b-1story',
  position: p,
  rotY: ([0, 90, 180, 270] as const)[i % 4]!,
  scale: 1 + (i % 3) * 0.2,
  palette: i % 3 === 0 ? null : 'Texture_Blue',
});
const lineProps = (): Prop[] => {
  const out: Prop[] = [];
  for (let x = -950; x <= 950; x += 50) out.push(prop(out.length, vec3(x, 0, 10)));
  return out;
};
/** Stand-in models: unit boxes with the base at y = 0 (the real GLBs are loaded in the browser). */
function models(): Map<string, PieceModels> {
  const box = (): THREE.BufferGeometry => new THREE.BoxGeometry(6, 10, 6).translate(0, 5, 0);
  return new Map([
    ['b-1story', { lod0: box(), lod1: box() }],
    ['b-4story', { lod0: box(), lod1: null }],
  ]);
}
const lod0Meshes = (v: CityView): THREE.InstancedMesh[] =>
  v.group.children.filter((c): c is THREE.InstancedMesh => c.name.startsWith('city-lod0'));

function activePositions(m: THREE.InstancedMesh): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const mat = new THREE.Matrix4();
  for (let i = 0; i < m.count; i++) {
    m.getMatrixAt(i, mat);
    out.push(new THREE.Vector3().setFromMatrixPosition(mat));
  }
  return out;
}

describe('CityView', () => {
  it('Review Focus 5: after a 1,500 m move every LOD0 mesh bounding sphere contains all its active instances', () => {
    const props = lineProps();
    const view = new CityView(cityWith(props), pieces, models(), new THREE.Texture(), cfg);
    view.update(vec3(-800, 0, 10));
    const before = lod0Meshes(view).map((m) => activePositions(m).map((p) => p.x));
    view.update(vec3(700, 0, 10));
    expect(view.boundsOk()).toBe(true);
    let active = 0;
    for (const m of lod0Meshes(view)) {
      expect(m.boundingSphere).not.toBeNull();
      for (const p of activePositions(m)) {
        expect(p.x).toBeGreaterThan(500); // near the new centre, none left over from x = -800
        expect(m.boundingSphere!.containsPoint(p)).toBe(true);
        active++;
      }
    }
    expect(active).toBe(props.filter((p) => Math.abs(p.position.x - 700) <= 160).length);
    expect(before.flat().every((x) => x < -600)).toBe(true);
    expect(view.stats().lod0).toBe(active);
  });

  it('sorts every prop within lodRadii[2] into one ring; instance counts and flags follow', () => {
    const props = lineProps();
    const view = new CityView(cityWith(props), pieces, models(), new THREE.Texture(), cfg);
    view.update(vec3(0, 0, 10));
    const s = view.stats();
    const within = (r: number): number => props.filter((p) => Math.abs(p.position.x) <= r).length;
    expect(s).toEqual({ lod0: within(160), lod1: within(400) - within(160), lod2: within(700) - within(400) });
    const meshes = view.group.children.filter((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh);
    const byRing = (prefix: string): number => meshes.filter((m) => m.name.startsWith(prefix)).reduce((n, m) => n + m.count, 0);
    expect([byRing('city-lod0'), byRing('city-lod1'), byRing('city-lod2')]).toEqual([s.lod0, s.lod1, s.lod2]);
    for (const m of meshes) {
      expect(m.castShadow).toBe(m.name.startsWith('city-lod0'));
      expect(m.visible).toBe(m.count > 0);
    }
  });

  it('writes each active instance its palette atlas row', () => {
    const props = lineProps();
    const view = new CityView(cityWith(props), pieces, models(), new THREE.Texture(), cfg);
    view.update(vec3(0, 0, 10));
    for (const m of lod0Meshes(view)) {
      const rows = m.geometry.getAttribute('aPalette') as THREE.InstancedBufferAttribute;
      const mat = new THREE.Matrix4();
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, mat);
        const x = new THREE.Vector3().setFromMatrixPosition(mat).x;
        const p = props.find((q) => Math.abs(q.position.x - x) < 1e-3)!;
        expect(rows.getX(i)).toBe(paletteRow(p.palette));
      }
    }
  });

  it('re-sorts only after moving more than relodDistance or into another chunk', () => {
    const props = lineProps();
    const view = new CityView(cityWith(props), pieces, models(), new THREE.Texture(), cfg);
    view.update(vec3(10, 0, 10));
    const s0 = view.stats();
    view.update(vec3(34, 0, 10)); // 24 m, same chunk: the rings stay although x = -150 is now beyond 160 m
    expect(view.stats()).toEqual(s0);
    view.update(vec3(36, 0, 10)); // 26 m from the last sort
    expect(view.stats().lod0).toBe(s0.lod0 - 1);

    const other = new CityView(cityWith(props), pieces, models(), new THREE.Texture(), cfg);
    other.update(vec3(95, 0, 10));
    const s1 = other.stats();
    other.update(vec3(111, 0, 10)); // 16 m, but into chunk (1,0): x = -50 drops out of LOD0
    expect(other.stats().lod0).toBe(s1.lod0 - 1);
  });

  it('draws only instances inside the camera frustum when given a camera, with bounds still tight', () => {
    const props = lineProps();
    const view = new CityView(cityWith(props), pieces, models(), new THREE.Texture(), cfg);
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 5, 10);
    cam.lookAt(500, 5, 10); // looking down +x
    view.update(vec3(0, 0, 10), cam);
    for (const m of lod0Meshes(view)) for (const p of activePositions(m)) expect(p.x).toBeGreaterThan(-10);
    expect(view.boundsOk()).toBe(true);
    cam.lookAt(-500, 5, 10); // turn around: the same ring, the other half drawn
    view.update(vec3(0, 0, 10), cam);
    for (const m of lod0Meshes(view)) for (const p of activePositions(m)) expect(p.x).toBeLessThan(10);
    expect(view.boundsOk()).toBe(true);
  });

  it('hides render regions beyond lodRadii[2]', () => {
    const ground = (id: string, x: number): Solid => ({ id, kind: 'ground', center: vec3(x, -0.5, 50), size: vec3(100, 1, 100) });
    const view = new CityView(cityWith([], [ground('near', 50), ground('far', 950)]), pieces, models(), new THREE.Texture(), cfg);
    view.update(vec3(0, 0, 50));
    const regions = view.group.children.filter((c) => c.name.startsWith('region'));
    expect(regions.map((r) => [r.name, r.visible])).toEqual([
      ['region 0,0', true],
      ['region 3,0', false],
    ]);
  });

  it('the shadow pass draws only the LOD0 instances inside the shadow camera, then the full list is restored', () => {
    const props = lineProps();
    const view = new CityView(cityWith(props), pieces, models(), new THREE.Texture(), cfg, { toSun, extent: 80 });
    view.update(vec3(0, 0, 10));
    let inShadow = 0;
    for (const m of lod0Meshes(view)) {
      const all = activePositions(m).map((p) => p.x);
      const full = m.count;
      const args = [{} as THREE.WebGLRenderer, new THREE.Scene(), new THREE.Camera(), new THREE.Camera(), m.geometry, m.material as THREE.Material, {} as THREE.Group] as const;
      m.onBeforeShadow(...args);
      const shadowed = activePositions(m).map((p) => p.x);
      m.onAfterShadow(...args);
      expect(m.count).toBe(full);
      expect(shadowed).toEqual(all.slice(0, shadowed.length)); // the shadow casters lead the list
      for (const x of shadowed) expect(Math.abs(x)).toBeLessThanOrEqual(120);
      inShadow += shadowed.length;
    }
    const lod0 = view.stats().lod0;
    expect(inShadow).toBeGreaterThan(0);
    expect(inShadow).toBeLessThan(lod0); // x = ±150 is LOD0 but outside the 80 m shadow camera
  });
});
