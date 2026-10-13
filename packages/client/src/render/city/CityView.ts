import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { chunkOf, type CityMap, type PieceCatalog, type Vec3 } from '@dm/shared';
import type { CityRenderConfig } from '../../clientConfig';
import { cityAssetUrl, paletteAtlasUrl } from '../../game/mapLoader';
import { assignLods, type LodRings } from './lodRings';
import { createPaletteMaterial, paletteRow, PALETTE_ROWS } from './paletteMaterial';
import { buildRegionMeshes } from './regions';
import { shadowCameraTest, type ShadowCameraTest, type SunShadow } from '../shadowCamera';

/** A piece's two model levels; a piece without a LOD1 model draws its LOD0 model in the LOD1 ring. */
export interface PieceModels {
  lod0: THREE.BufferGeometry;
  lod1: THREE.BufferGeometry | null;
}

/**
 * The shadow-casting sun (see SunShadow). LOD0 instances just out of view still draw when their shadow may fall into
 * view, and the shadow pass draws only the LOD0 instances inside the shadow camera.
 */
export type CityShadow = SunShadow;

/** One InstancedMesh and the props it currently draws (indices into city.props, in instance order). */
interface Slot {
  mesh: THREE.InstancedMesh;
  /** Per-instance atlas row (LOD0/LOD1) or null for the LOD2 boxes (which carry instanceColor). */
  palette: THREE.InstancedBufferAttribute | null;
  active: Int32Array;
  /** The next frame's list, built by fill() and compared against `active`. */
  next: Int32Array;
  n: number;
  /** LOD0: the first `shadowN` instances lie inside the shadow camera; only they are drawn in the shadow pass. */
  shadowN: number;
}

const DEG = Math.PI / 180;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
/** Float slack of the bounds check (m): the sphere is computed from float32 matrices. */
const BOUNDS_EPS = 1e-3;

/** The single mesh of a runtime building/part GLB (identity transforms, one primitive). */
function singleGeometry(scene: THREE.Object3D, path: string): THREE.BufferGeometry {
  const meshes: THREE.Mesh[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  if (meshes.length !== 1) throw new Error(`${path}: expected one mesh, found ${meshes.length}`);
  const mesh = meshes[0]!;
  if (!mesh.matrixWorld.equals(new THREE.Matrix4())) throw new Error(`${path}: the mesh node has a transform`);
  return mesh.geometry;
}

/** A geometry drawing the same vertices as `src` with its own attribute set (so it can carry its own aPalette). */
function sharedGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setIndex(src.index);
  for (const [name, attr] of Object.entries(src.attributes)) {
    if (name !== 'aPalette') g.setAttribute(name, attr);
  }
  return g;
}

/**
 * The generated city's buildings and code-built geometry.
 *
 * - Buildings are instanced per piece and LOD ring: LOD0 and LOD1 InstancedMeshes per piece (capacity = that piece's
 *   prop count) sharing one palette-atlas material, plus one InstancedMesh of tinted boxes for LOD2.
 * - `update(center)` re-sorts the props into rings (horizontal distance from the player) when the centre moved more
 *   than relodDistance or into another chunk. Props beyond lodRadii[2] and render regions beyond it are not drawn.
 * - Given the camera, `update` also leaves out instances outside its frustum (LOD0 keeps those whose shadow may reach
 *   into view), so one InstancedMesh draws only what can be seen.
 * - After any change of an InstancedMesh's instances, its count, instanceMatrix, aPalette and bounding sphere are
 *   refreshed together (Review Focus 5: stale bounds would cull on-screen buildings).
 * - Only LOD0 casts shadows.
 */
export class CityView {
  readonly group = new THREE.Group();
  private readonly radii: [number, number, number];
  private readonly pieceOf: Int32Array;
  private readonly matrices: Float32Array;
  private readonly boxMatrices: Float32Array;
  private readonly rows: Float32Array;
  private readonly colors: Float32Array;
  /** Bounding sphere per prop (cx, cy, cz, r) and the same grown to cover its ground shadow (LOD0 culling). */
  private readonly spheres: Float32Array;
  private readonly castSpheres: Float32Array;
  private readonly lod0: Slot[] = [];
  private readonly lod1: Slot[] = [];
  private readonly lod2: Slot;
  private readonly slots: Slot[];
  private readonly regions: { group: THREE.Group; box: THREE.Box3 }[] = [];
  private rings: LodRings = { lod0: [], lod1: [], lod2: [] };
  private last: { x: number; z: number; chunk: string } | null = null;
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private culled = false;
  /** The shadow-camera test (null without a shadow-casting sun) and the per-prop "inside the shadow camera" flags of the last fill. */
  private readonly shadow: ShadowCameraTest | null;
  private readonly inShadow: Uint8Array;
  private center: Vec3 = { x: 0, y: 0, z: 0 };

  /** Loads every model the city's props use (LOD0 and LOD1 GLBs) and the palette atlas, then builds the view. */
  static async load(city: CityMap, pieces: PieceCatalog, cfg: CityRenderConfig, shadow?: CityShadow): Promise<CityView> {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const geometryOf = async (path: string): Promise<THREE.BufferGeometry> =>
      singleGeometry((await loader.loadAsync(cityAssetUrl(path))).scene, path);
    const used = [...new Set(city.props.map((p) => p.piece))];
    const [atlas, models] = await Promise.all([
      new THREE.TextureLoader().loadAsync(paletteAtlasUrl),
      Promise.all(
        used.map(async (id) => {
          const e = pieces[id]!;
          const [lod0, lod1] = await Promise.all([geometryOf(e.lod0), e.lod1 ? geometryOf(e.lod1) : null]);
          return [id, { lod0, lod1 }] as const;
        }),
      ),
    ]);
    return new CityView(city, pieces, new Map(models), atlas, cfg, shadow);
  }

  constructor(
    private readonly city: CityMap,
    pieces: PieceCatalog,
    models: ReadonlyMap<string, PieceModels>,
    atlas: THREE.Texture,
    private readonly cfg: CityRenderConfig,
    shadow?: CityShadow,
  ) {
    const [r0, r1, r2] = cfg.lodRadii;
    if (cfg.lodRadii.length !== 3 || r0 === undefined || r1 === undefined || r2 === undefined) {
      throw new Error('city.lodRadii must hold three radii');
    }
    this.radii = [r0, r1, r2];
    this.group.name = 'city';
    const props = city.props;
    const n = props.length;
    this.pieceOf = new Int32Array(n);
    this.matrices = new Float32Array(n * 16);
    this.boxMatrices = new Float32Array(n * 16);
    this.rows = new Float32Array(n);
    this.colors = new Float32Array(n * 3);
    this.spheres = new Float32Array(n * 4);
    this.castSpheres = new Float32Array(n * 4);
    this.inShadow = new Uint8Array(n);
    this.shadow = shadow ? shadowCameraTest(shadow) : null;

    const pieceIds = [...new Set(props.map((p) => p.piece))];
    const pieceIndex = new Map(pieceIds.map((id, i) => [id, i]));
    const capacity = new Array<number>(pieceIds.length).fill(0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    props.forEach((p, i) => {
      const e = pieces[p.piece];
      if (!e) throw new Error(`prop ${p.id}: unknown piece ${p.piece}`);
      const k = pieceIndex.get(p.piece)!;
      this.pieceOf[i] = k;
      capacity[k]!++;
      pos.set(p.position.x, p.position.y, p.position.z);
      q.setFromAxisAngle(Y_AXIS, p.rotY * DEG);
      m.compose(pos, q, scl.setScalar(p.scale)).toArray(this.matrices, i * 16);
      m.compose(pos, q, scl.set(e.size.x * p.scale, e.size.y * p.scale, e.size.z * p.scale)).toArray(this.boxMatrices, i * 16);
      this.rows[i] = paletteRow(p.palette);
      this.colors.set(e.avgColor, i * 3);
      const h = e.size.y * p.scale;
      const r = 0.5 * Math.hypot(e.size.x, e.size.y, e.size.z) * p.scale;
      this.spheres.set([p.position.x, p.position.y + h / 2, p.position.z, r], i * 4);
      // The shadow of the top (height h) lands h / toSun.y along -toSun horizontally: grow the sphere to cover it.
      const ox = shadow ? (-shadow.toSun.x * h) / shadow.toSun.y : 0;
      const oz = shadow ? (-shadow.toSun.z * h) / shadow.toSun.y : 0;
      this.castSpheres.set([p.position.x + ox / 2, p.position.y + h / 2, p.position.z + oz / 2, r + Math.hypot(ox, oz) / 2], i * 4);
    });

    const material = createPaletteMaterial(atlas, PALETTE_ROWS);
    const slot = (geometry: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string, withPalette: boolean): Slot => {
      const palette = withPalette ? new THREE.InstancedBufferAttribute(new Float32Array(cap), 1) : null;
      if (palette) {
        palette.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('aPalette', palette);
      }
      const mesh = new THREE.InstancedMesh(geometry, mat, cap);
      const s: Slot = { mesh, palette, active: new Int32Array(cap), next: new Int32Array(cap), n: 0, shadowN: 0 };
      mesh.name = name;
      // The shadow pass draws only the leading instances that lie inside the shadow camera (fill() orders them first).
      mesh.onBeforeShadow = () => {
        mesh.count = s.shadowN;
      };
      mesh.onAfterShadow = () => {
        mesh.count = s.n;
      };
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      this.group.add(mesh);
      return s;
    };
    pieceIds.forEach((id, k) => {
      const model = models.get(id);
      if (!model) throw new Error(`no model loaded for piece ${id}`);
      const s0 = slot(model.lod0, material, capacity[k]!, `city-lod0 ${id}`, true);
      s0.mesh.castShadow = true;
      s0.mesh.receiveShadow = true;
      const s1 = slot(model.lod1 ?? sharedGeometry(model.lod0), material, capacity[k]!, `city-lod1 ${id}`, true);
      s1.mesh.receiveShadow = true;
      this.lod0.push(s0);
      this.lod1.push(s1);
    });
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.lod2 = slot(box, new THREE.MeshLambertMaterial(), Math.max(n, 1), 'city-lod2', false);
    this.lod2.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(n, 1) * 3), 3);
    this.lod2.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.slots = [...this.lod0, ...this.lod1, this.lod2];

    for (const [, group] of buildRegionMeshes(city, cfg.renderRegion)) {
      const box3 = new THREE.Box3();
      for (const child of group.children) box3.union((child as THREE.Mesh).geometry.boundingBox!);
      this.regions.push({ group, box: box3 });
      this.group.add(group);
    }
  }

  /**
   * Re-sorts the rings when the player at `center` moved more than relodDistance or into another chunk since the last
   * sort, then (re)fills the instanced meshes. With `camera`, only instances inside its frustum are drawn.
   */
  update(center: Vec3, camera?: THREE.Camera): void {
    const chunk = chunkOf(center.x, center.z, this.city.chunkSize);
    const relod =
      this.last === null ||
      chunk !== this.last.chunk ||
      Math.hypot(center.x - this.last.x, center.z - this.last.z) > this.cfg.relodDistance;
    if (relod) {
      this.rings = assignLods(this.city.props, center, this.radii);
      this.last = { x: center.x, z: center.z, chunk };
      for (const r of this.regions) r.group.visible = horizontalDistance(r.box, center) <= this.radii[2];
    }
    this.center = center;
    if (camera) {
      camera.updateMatrixWorld();
      this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProj);
    }
    // Without a camera the instance lists only change when the rings do.
    if (!relod && !camera && !this.culled) return;
    this.culled = camera !== undefined;
    this.fill(camera ? this.frustum : null);
  }

  /** Props per ring after the last sort. */
  stats(): { lod0: number; lod1: number; lod2: number } {
    return { lod0: this.rings.lod0.length, lod1: this.rings.lod1.length, lod2: this.rings.lod2.length };
  }

  /** Review Focus 5: every InstancedMesh's bounding sphere contains the position of each instance it draws. */
  boundsOk(): boolean {
    for (const s of this.slots) {
      if (s.mesh.count === 0) continue;
      const sphere = s.mesh.boundingSphere;
      if (!sphere) return false;
      const a = s.mesh.instanceMatrix.array;
      for (let k = 0; k < s.mesh.count; k++) {
        const d = Math.hypot(a[k * 16 + 12]! - sphere.center.x, a[k * 16 + 13]! - sphere.center.y, a[k * 16 + 14]! - sphere.center.z);
        if (d > sphere.radius + BOUNDS_EPS) return false;
      }
    }
    return true;
  }

  private fill(frustum: THREE.Frustum | null): void {
    for (const s of this.slots) s.n = 0;
    const push = (s: Slot, i: number): void => {
      s.next[s.n++] = i;
    };
    // LOD0: instances inside the shadow camera first (culled with their shadow, so off-screen casters still cast),
    // then the rest (culled by their own sphere: their shadow is outside the shadow map anyway).
    const lod0 = this.rings.lod0;
    for (const i of lod0) this.inShadow[i] = this.insideShadowCamera(i) ? 1 : 0;
    for (const i of lod0) if (this.inShadow[i] && inView(frustum, this.castSpheres, i)) push(this.lod0[this.pieceOf[i]!]!, i);
    for (const s of this.lod0) s.shadowN = s.n;
    for (const i of lod0) if (!this.inShadow[i] && inView(frustum, this.spheres, i)) push(this.lod0[this.pieceOf[i]!]!, i);
    for (const i of this.rings.lod1) if (inView(frustum, this.spheres, i)) push(this.lod1[this.pieceOf[i]!]!, i);
    for (const i of this.rings.lod2) if (inView(frustum, this.spheres, i)) push(this.lod2, i);
    for (const s of this.lod0) this.commit(s, this.matrices);
    for (const s of this.lod1) this.commit(s, this.matrices);
    this.commit(this.lod2, this.boxMatrices);
  }

  /** Whether prop `i`'s sphere reaches into the sun's shadow camera (centred on the player's ground point). */
  private insideShadowCamera(i: number): boolean {
    const s = this.spheres;
    return this.shadow !== null && this.shadow(this.center, s[i * 4]!, s[i * 4 + 1]!, s[i * 4 + 2]!, s[i * 4 + 3]!);
  }

  /** Applies a slot's new instance list if it differs from the one drawn. */
  private commit(s: Slot, matrices: Float32Array): void {
    const mesh = s.mesh;
    if (s.n === mesh.count) {
      let same = true;
      for (let k = 0; k < s.n && same; k++) same = s.next[k] === s.active[k];
      if (same) return;
    }
    const m = mesh.instanceMatrix.array as Float32Array;
    const colors = s.palette ? null : (mesh.instanceColor!.array as Float32Array);
    for (let k = 0; k < s.n; k++) {
      const i = s.next[k]!;
      s.active[k] = i;
      m.set(matrices.subarray(i * 16, i * 16 + 16), k * 16);
      if (s.palette) s.palette.array[k] = this.rows[i]!;
      else colors!.set(this.colors.subarray(i * 3, i * 3 + 3), k * 3);
    }
    mesh.count = s.n;
    mesh.visible = s.n > 0;
    for (const [attr, size] of [
      [mesh.instanceMatrix, 16],
      [s.palette ?? mesh.instanceColor!, s.palette ? 1 : 3],
    ] as const) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, s.n * size);
      attr.needsUpdate = true;
    }
    mesh.computeBoundingSphere();
  }
}

/** Whether prop `i`'s sphere (cx, cy, cz, r at i*4) touches the frustum; everything is in view without one. */
function inView(frustum: THREE.Frustum | null, spheres: Float32Array, i: number): boolean {
  if (!frustum) return true;
  const x = spheres[i * 4]!;
  const y = spheres[i * 4 + 1]!;
  const z = spheres[i * 4 + 2]!;
  const r = spheres[i * 4 + 3]!;
  for (const p of frustum.planes) {
    if (p.normal.x * x + p.normal.y * y + p.normal.z * z + p.constant < -r) return false;
  }
  return true;
}

/** Horizontal distance from `p` to the nearest point of `box` (0 inside it). */
function horizontalDistance(box: THREE.Box3, p: Vec3): number {
  const dx = Math.max(box.min.x - p.x, 0, p.x - box.max.x);
  const dz = Math.max(box.min.z - p.z, 0, p.z - box.max.z);
  return Math.hypot(dx, dz);
}
