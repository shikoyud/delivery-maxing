import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parsePieceCatalog, vec3, worldConfig, type CityMap, type Prop, type Solid, type Vec3 } from '@dm/shared';
import piecesJson from '../../../map/pieces.json';
import { CityView, type PieceModels } from '../src/render/city/CityView';
import { clientConfig } from '../src/clientConfig';
import { paletteRow } from '../src/render/city/paletteMaterial';
import { regionOf } from '../src/render/city/regions';
import { toSun } from '../src/render/Renderer';

const pieces = parsePieceCatalog(piecesJson);
const cfg = clientConfig.city;
const [R0, R1, R2] = cfg.lodRadii as [number, number, number];
/** Relod step and chunk size the re-sort test moves by (city.relodDistance, world chunkSize). */
const D = cfg.relodDistance;
const CHUNK = worldConfig.chunkSize;

/** Props every 50 m along x (and a second row along z), two pieces, alternating palettes. */
function cityWith(props: Prop[], solids: Solid[] = []): CityMap {
  return { kind: 'city', size: 2000, chunkSize: CHUNK, props, solids } as unknown as CityMap;
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
        expect(Math.abs(p.x - 700)).toBeLessThanOrEqual(R0); // near the new centre, none left over from x = -800
        expect(m.boundingSphere!.containsPoint(p)).toBe(true);
        active++;
      }
    }
    expect(active).toBe(props.filter((p) => Math.abs(p.position.x - 700) <= R0).length);
    expect(before.flat().every((x) => Math.abs(x + 800) <= R0)).toBe(true);
    expect(view.stats().lod0).toBe(active);
  });

  it('sorts every prop within lodRadii[2] into one ring; instance counts and flags follow', () => {
    const props = lineProps();
    const view = new CityView(cityWith(props), pieces, models(), new THREE.Texture(), cfg);
    view.update(vec3(0, 0, 10));
    const s = view.stats();
    const within = (r: number): number => props.filter((p) => Math.abs(p.position.x) <= r).length;
    expect(s).toEqual({ lod0: within(R0), lod1: within(R1) - within(R0), lod2: within(R2) - within(R1) });
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
    expect(CHUNK).toBeGreaterThan(2 * D); // the moves below stay inside one chunk
    const one = (x: number): CityMap => cityWith([prop(0, vec3(x, 0, 10))]);
    // Moves within one chunk: a prop that a re-sort would bring into LOD0 stays in LOD1 until the move exceeds D.
    const x0 = CHUNK / 2 - 0.5 * D;
    const view = new CityView(one(x0 + R0 + 0.5 * D), pieces, models(), new THREE.Texture(), cfg);
    view.update(vec3(x0, 0, 10));
    expect(view.stats().lod0).toBe(0);
    view.update(vec3(x0 + 0.9 * D, 0, 10)); // now R0 - 0.4 D away, but no re-sort yet
    expect(view.stats().lod0).toBe(0);
    view.update(vec3(x0 + 1.1 * D, 0, 10)); // moved more than D since the last sort
    expect(view.stats().lod0).toBe(1);

    // A short move across a chunk border re-sorts.
    const x1 = CHUNK - 0.2 * D;
    const other = new CityView(one(x1 + R0 + 0.3 * D), pieces, models(), new THREE.Texture(), cfg);
    other.update(vec3(x1, 0, 10));
    expect(other.stats().lod0).toBe(0);
    other.update(vec3(CHUNK + 0.2 * D, 0, 10)); // 0.4 D, into the next chunk
    expect(other.stats().lod0).toBe(1);
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
    const farX = R2 + 150; // the far tile's nearest edge is R2 + 100 from the centre
    const view = new CityView(cityWith([], [ground('near', 50), ground('far', farX)]), pieces, models(), new THREE.Texture(), cfg);
    view.update(vec3(0, 0, 50));
    const regions = view.group.children.filter((c) => c.name.startsWith('region'));
    expect(regions.map((r) => [r.name, r.visible])).toEqual([
      [`region ${regionOf(50, 50, cfg.renderRegion)}`, true],
      [`region ${regionOf(farX, 50, cfg.renderRegion)}`, false],
    ]);
  });

  it('the shadow pass draws only the LOD0 instances inside the shadow camera, then the full list is restored', () => {
    const props = lineProps();
    // A shadow camera half as wide as the LOD0 ring, so part of the ring lies outside it.
    const extent = R0 / 2;
    // Light-space x of a prop at (x, ·, 10) is |x|·0.555 for this sun: beyond (extent + max radius + slack) / 0.555
    // nothing can be in the shadow camera (the largest test instance has a bounding radius under 13 m).
    const reach = (extent + 14) / 0.55;
    const view = new CityView(cityWith(props), pieces, models(), new THREE.Texture(), cfg, { toSun, extent });
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
      for (const x of shadowed) expect(Math.abs(x)).toBeLessThanOrEqual(reach);
      inShadow += shadowed.length;
    }
    const lod0 = view.stats().lod0;
    expect(inShadow).toBeGreaterThan(0);
    expect(inShadow).toBeLessThan(lod0); // the outer part of the LOD0 ring is outside the shadow camera
  });
});
