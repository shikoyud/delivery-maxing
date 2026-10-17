import * as THREE from 'three';
import { chunkOf, hasRuntimeModel, type CatalogIndex, type CityMap, type Lot, type Vec3 } from '@dm/shared';
import type { CityRenderConfig } from '../../clientConfig';
import { buildBlockMesh, lotBlockId } from './blockMeshes';
import type { ModelLoader, PieceModels } from './modelLoader';
import { lotTransform } from './placement';
import { buildRegionMeshes } from './regions';

/** The sun's shadow, so LOD0 buildings just out of view still cast into it (SP2's CityShadow, simplified). */
export interface CityShadow {
  /** Half side of the sun's shadow camera around the player (graphics.shadowExtent). */
  extent: number;
  /** Horizontal shadow length per metre of height (the sun's horizontal / vertical direction). */
  slope: number;
}

/** One InstancedMesh and the instances it currently draws (indices into CityView's instance arrays). */
interface Slot {
  mesh: THREE.InstancedMesh;
  active: Int32Array;
  next: Int32Array;
  n: number;
  /** LOD0: the first `shadowN` instances are inside the shadow camera; only they are drawn in the shadow pass. */
  shadowN: number;
}

interface Piece {
  id: string;
  /** Instance indices of this id's lots (a container stack is one instance per level) */
  instances: number[];
  lod0: Slot | null;
  /** Null when the model has no LOD1 file and city.lod1Fallback is `box` */
  lod1: Slot | null;
  /** Its lots draw as the model out to this radius once loaded: lodRadii[1], or lodRadii[0] for a box fallback */
  reach: number;
}

interface BlockState {
  mesh: THREE.Mesh;
  /** Every lot of the block and its index in the layout (rebuilds draw the boxes of those not swapped) */
  lots: Lot[];
  lotIndex: number[];
  /** Lot indices whose box the mesh leaves out now (their model draws instead), and the set wanted */
  swapped: Set<number>;
  want: Set<number>;
  /** The mesh's bounding box when it held every box (block culling does not move with rebuilds) */
  box: THREE.Box3;
  /** Within lodRadii[2] of the player (as of the last sort); a block with no box left is hidden either way */
  near: boolean;
  /** Whether the mesh has any box left */
  boxes: boolean;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
/** Float slack of the bounds check (m): the sphere is computed from float32 matrices. */
const BOUNDS_EPS = 1e-3;


/**
 * The city (city design §7.2–§7.3, SP2's CityView reshaped): Task 11's code-built regions and per-block placeholder
 * boxes, with the owner's pack models swapped in near the player.
 *
 * - Lots within loadAheadRadius (beyond lodRadii[1]) request their models; each loaded id draws as one InstancedMesh
 *   per LOD ring: its LOD0 model within lodRadii[0], its LOD1 model out to lodRadii[1]. A model without a LOD1 file
 *   stays a box in the LOD1 ring (city.lod1Fallback `box`, the budget default) or draws LOD0 there (`lod0`).
 * - A lot whose model is loaded and within its reach (above) leaves its block's merged boxes: the block mesh is rebuilt
 *   without it, at most one block per update (nearest first). Until its block is rebuilt a lot stays a box; once
 *   rebuilt it draws as a model until the block is rebuilt with it again (so a lot is never drawn twice or not at all).
 * - Blocks beyond lodRadii[2] are hidden; so are regions whose bounding sphere is (a level's ground slab is one solid
 *   in a single region, so its sphere, not the region's centre, decides).
 * - With a camera, instances outside its frustum are left out (LOD0 keeps those whose shadow may reach into view);
 *   after every change of an InstancedMesh's instances its count, matrices and bounding sphere are refreshed
 *   together (SP2 Review Focus 5). Only LOD0 casts shadows.
 * - Lots whose model is missing (no file, a 404, the packs not installed) stay boxes (Review Focus 1).
 */
export class CityView {
  readonly group = new THREE.Group();
  private readonly radii: [number, number, number];
  /** Per instance: world matrix, bounding sphere (cx, cy, cz, r), shadow-grown sphere, its lot index. */
  private readonly matrices: Float32Array;
  private readonly spheres: Float32Array;
  private readonly castSpheres: Float32Array;
  private readonly instanceLot: Int32Array;
  /** Per lot: horizontal centre, piece index, block index (−1: no block box, an open lot) */
  private readonly lotX: Float32Array;
  private readonly lotZ: Float32Array;
  private readonly lotPiece: Int32Array;
  private readonly lotBlock: Int32Array;
  private readonly lotDist: Float32Array;
  private readonly pieces: Piece[] = [];
  private readonly blocks: BlockState[] = [];
  private readonly regions: { group: THREE.Group; sphere: THREE.Sphere }[] = [];
  private readonly slots: Slot[] = [];
  /** Pieces requested and not yet resolved (polled each update) */
  private readonly pending = new Set<number>();
  private readonly loaded = new Set<number>();
  private readonly missing = new Set<number>();
  private last: { x: number; z: number; chunk: string } | null = null;
  private center: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private dirtyFill = true;
  private culled = false;

  /** Builds the view over Task 11's block meshes (`buildBlockMeshes`), which it adds to its group and rebuilds. */
  static create(map: CityMap, cat: CatalogIndex, blocks: Map<string, THREE.Mesh>, cfg: CityRenderConfig, loader: ModelLoader, shadow?: CityShadow): CityView {
    return new CityView(map, cat, blocks, cfg, loader, shadow ?? null);
  }

  private constructor(
    private readonly map: CityMap,
    private readonly cat: CatalogIndex,
    blockMeshes: Map<string, THREE.Mesh>,
    private readonly cfg: CityRenderConfig,
    private readonly loader: ModelLoader,
    private readonly shadow: CityShadow | null,
  ) {
    const [r0, r1, r2] = cfg.lodRadii;
    if (cfg.lodRadii.length !== 3 || r0 === undefined || r1 === undefined || r2 === undefined) {
      throw new Error('city.lodRadii must hold three radii');
    }
    this.radii = [r0, r1, r2];
    this.group.name = 'city';
    const lots = map.layout.lots;
    const blockIds = new Set(map.layout.blocks.map((b) => b.id));

    const blockIndex = new Map<string, number>();
    const lotsByBlock = new Map<string, number[]>();
    lots.forEach((lot, i) => {
      const id = lotBlockId(lot, blockIds);
      const list = lotsByBlock.get(id);
      if (list) list.push(i);
      else lotsByBlock.set(id, [i]);
    });
    for (const [id, mesh] of blockMeshes) {
      mesh.geometry.computeBoundingBox();
      blockIndex.set(id, this.blocks.length);
      const lotIndex = lotsByBlock.get(id) ?? [];
      this.blocks.push({ mesh, lots: lotIndex.map((i) => lots[i]!), lotIndex, swapped: new Set(), want: new Set(), box: mesh.geometry.boundingBox!.clone(), near: false, boxes: true });
      this.group.add(mesh);
    }

    const n = lots.length;
    this.lotX = new Float32Array(n);
    this.lotZ = new Float32Array(n);
    this.lotPiece = new Int32Array(n).fill(-1);
    this.lotBlock = new Int32Array(n).fill(-1);
    this.lotDist = new Float32Array(n).fill(Infinity);
    const pieceIndex = new Map<string, number>();
    const inst: { lot: number; level: number }[] = [];
    lots.forEach((lot, i) => {
      this.lotX[i] = (lot.rect.minX + lot.rect.maxX) / 2;
      this.lotZ[i] = (lot.rect.minZ + lot.rect.maxZ) / 2;
      if (!lot.open) this.lotBlock[i] = blockIndex.get(lotBlockId(lot, blockIds)) ?? -1;
      const e = cat.get(lot.asset);
      if (!hasRuntimeModel(e)) return;
      let k = pieceIndex.get(e.id);
      if (k === undefined) {
        k = this.pieces.length;
        pieceIndex.set(e.id, k);
        this.pieces.push({ id: e.id, instances: [], lod0: null, lod1: null, reach: 0 });
      }
      this.lotPiece[i] = k;
      for (let level = 0; level < (lot.stack ?? 1); level++) {
        this.pieces[k]!.instances.push(inst.length);
        inst.push({ lot: i, level });
      }
    });

    const m = inst.length;
    this.matrices = new Float32Array(m * 16);
    this.spheres = new Float32Array(m * 4);
    this.castSpheres = new Float32Array(m * 4);
    this.instanceLot = new Int32Array(m);
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    inst.forEach(({ lot: i, level }, k) => {
      const lot = lots[i]!;
      const e = cat.get(lot.asset);
      const t = lotTransform(lot, e);
      pos.set(t.position.x, t.position.y + level * e.size.h, t.position.z);
      mat.compose(pos, q.setFromAxisAngle(Y_AXIS, t.rotY), one).toArray(this.matrices, k * 16);
      this.instanceLot[k] = i;
      const h = e.size.h;
      const r = 0.5 * Math.hypot(e.size.w, e.size.h, e.size.d);
      const cy = lot.y + level * h + h / 2;
      this.spheres.set([this.lotX[i]!, cy, this.lotZ[i]!, r], k * 4);
      // The shadow of the top (height above the ground ≈ (level + 1) h) runs `slope` per metre away from the sun.
      const reach = shadow ? (level + 1) * h * shadow.slope : 0;
      this.castSpheres.set([this.lotX[i]!, cy, this.lotZ[i]!, r + reach], k * 4);
    });

    for (const [, group] of buildRegionMeshes(map, cfg.renderRegion)) {
      const sphere = new THREE.Sphere();
      const box = new THREE.Box3();
      for (const child of group.children) box.union((child as THREE.Mesh).geometry.boundingBox!);
      box.getBoundingSphere(sphere);
      this.regions.push({ group, sphere });
      this.group.add(group);
    }
  }

  /**
   * Per frame, with the player at `center`: re-sorts lots by distance when it moved more than relodDistance or into
   * another chunk (requesting models, choosing which lots are models), takes in models that finished loading,
   * rebuilds at most one block, then (re)fills the instanced meshes. With `camera`, only instances inside its frustum
   * are drawn.
   */
  update(center: Vec3, camera?: THREE.Camera): void {
    this.center = center;
    const chunk = chunkOf(center.x, center.z, this.map.chunkSize);
    const relod =
      this.last === null || chunk !== this.last.chunk || Math.hypot(center.x - this.last.x, center.z - this.last.z) > this.cfg.relodDistance;
    if (relod) this.relod(center, chunk);
    this.poll();
    this.rebuildOne();
    if (camera) {
      camera.updateMatrixWorld();
      this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProj);
    }
    if (!this.dirtyFill && !camera && !this.culled) return;
    this.culled = camera !== undefined;
    this.dirtyFill = false;
    this.fill(camera ? this.frustum : null);
  }

  /** Instances drawn, block meshes shown, ids loaded and ids missing (of those requested). */
  stats(): { instances: number; blocks: number; models: number; missing: number } {
    let instances = 0;
    for (const s of this.slots) instances += s.mesh.count;
    let blocks = 0;
    for (const b of this.blocks) if (b.mesh.visible) blocks++;
    return { instances, blocks, models: this.loaded.size, missing: this.missing.size };
  }

  /** SP2 Review Focus 5: every InstancedMesh's bounding sphere contains the position of each instance it draws. */
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

  private relod(center: Vec3, chunk: string): void {
    this.last = { x: center.x, z: center.z, chunk };
    const [, r1, r2] = this.radii;
    const ask = Math.max(r1, this.cfg.loadAheadRadius);
    const lots = this.map.layout.lots;
    for (let i = 0; i < lots.length; i++) {
      const d = Math.hypot(this.lotX[i]! - center.x, this.lotZ[i]! - center.z);
      this.lotDist[i] = d;
      const k = this.lotPiece[i]!;
      if (k >= 0 && d <= ask && !this.loaded.has(k) && !this.missing.has(k) && !this.pending.has(k)) {
        this.loader.request(this.pieces[k]!.id);
        this.pending.add(k);
      }
    }
    for (const b of this.blocks) {
      b.near = horizontalDistance(b.box, center) <= r2;
      b.mesh.visible = b.near && b.boxes;
    }
    for (const r of this.regions) {
      const dx = r.sphere.center.x - center.x;
      const dz = r.sphere.center.z - center.z;
      r.group.visible = Math.hypot(dx, dz) - r.sphere.radius <= r2;
    }
    this.retarget();
    this.dirtyFill = true;
  }

  /** Whether lot `i` should be its model now: loaded and within its piece's reach. */
  private isModel(i: number): boolean {
    const k = this.lotPiece[i]!;
    return k >= 0 && this.loaded.has(k) && this.lotDist[i]! <= this.pieces[k]!.reach;
  }

  /** Which lots should be models now (isModel), per block. */
  private retarget(): void {
    for (const b of this.blocks) b.want.clear();
    const lots = this.map.layout.lots;
    for (let i = 0; i < lots.length; i++) {
      const b = this.lotBlock[i]!;
      if (b >= 0 && this.isModel(i)) this.blocks[b]!.want.add(i);
    }
  }

  /** Takes in models that finished loading since the last update. */
  private poll(): void {
    let changed = false;
    for (const k of this.pending) {
      const piece = this.pieces[k]!;
      const got = this.loader.get(piece.id);
      if (got === 'loading') continue;
      this.pending.delete(k);
      if (got === 'missing') {
        this.missing.add(k);
        continue;
      }
      this.loaded.add(k);
      this.addSlots(piece, got);
      changed = true;
    }
    if (changed) {
      this.retarget();
      this.dirtyFill = true;
    }
  }

  private addSlots(piece: Piece, models: PieceModels): void {
    const cap = Math.max(piece.instances.length, 1);
    const slot = (geometry: THREE.BufferGeometry, name: string): Slot => {
      const mesh = new THREE.InstancedMesh(geometry, models.material, cap);
      const s: Slot = { mesh, active: new Int32Array(cap), next: new Int32Array(cap), n: 0, shadowN: 0 };
      mesh.name = name;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      this.group.add(mesh);
      this.slots.push(s);
      return s;
    };
    piece.lod0 = slot(models.lod0, `city-lod0 ${piece.id}`);
    piece.lod0.mesh.castShadow = true;
    piece.lod0.mesh.receiveShadow = true;
    const s0 = piece.lod0;
    // The shadow pass draws only the leading instances that lie inside the shadow camera (fill() orders them first).
    s0.mesh.onBeforeShadow = () => {
      s0.mesh.count = s0.shadowN;
    };
    s0.mesh.onAfterShadow = () => {
      s0.mesh.count = s0.n;
    };
    const lod1 = models.lod1 ?? (this.cfg.lod1Fallback === 'lod0' ? models.lod0 : null);
    piece.reach = lod1 ? this.radii[1] : this.radii[0];
    if (lod1) {
      piece.lod1 = slot(lod1, `city-lod1 ${piece.id}`);
      piece.lod1.mesh.receiveShadow = true;
    }
  }

  /** Rebuilds the nearest block whose swapped lots differ from the wanted ones. */
  private rebuildOne(): void {
    let best: BlockState | null = null;
    let bestD = Infinity;
    for (const b of this.blocks) {
      if (sameSet(b.swapped, b.want)) continue;
      const d = horizontalDistance(b.box, this.center);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (!best) return;
    const want = best.want;
    const keep = best.lots.filter((_, j) => !want.has(best.lotIndex[j]!));
    const blockId = best.mesh.userData.blockId as string;
    const rebuilt = buildBlockMesh(blockId, keep, this.cat, best.mesh.material as THREE.Material);
    best.mesh.geometry.dispose();
    best.mesh.geometry = rebuilt ? rebuilt.geometry : new THREE.BufferGeometry();
    best.boxes = rebuilt !== null;
    best.mesh.visible = best.near && best.boxes;
    best.swapped = new Set(best.want);
    this.dirtyFill = true;
  }

  private fill(frustum: THREE.Frustum | null): void {
    for (const s of this.slots) s.n = 0;
    const r0 = this.radii[0];
    const draws = (lot: number): boolean => {
      const b = this.lotBlock[lot]!;
      // a box lot draws as a model once its block left it out; an open lot (no box) whenever it is within reach
      return b >= 0 ? this.blocks[b]!.swapped.has(lot) : this.isModel(lot);
    };
    for (const k of this.loaded) {
      const piece = this.pieces[k]!;
      const s0 = piece.lod0!;
      const s1 = piece.lod1;
      // Instances in the LOD1 ring of a piece without a LOD1 slot are lots whose block has not been rebuilt with
      // their box yet: they draw LOD0 until it is (never twice, never not at all).
      const inLod0 = (lot: number): boolean => this.lotDist[lot]! <= r0 || s1 === null;
      // LOD0 inside the shadow camera first (culled with their shadow), then the rest of LOD0, and LOD1.
      for (let pass = 0; pass < 2; pass++) {
        for (const i of piece.instances) {
          const lot = this.instanceLot[i]!;
          if (!draws(lot) || !inLod0(lot)) continue;
          const inShadow = this.insideShadowCamera(i);
          if (pass === 0 && inShadow && inView(frustum, this.castSpheres, i)) s0.next[s0.n++] = i;
          else if (pass === 1 && !inShadow && inView(frustum, this.spheres, i)) s0.next[s0.n++] = i;
        }
        if (pass === 0) s0.shadowN = s0.n;
      }
      // a mesh with nothing inside the shadow camera stays out of the shadow pass (an empty draw still costs a call)
      s0.mesh.castShadow = s0.shadowN > 0;
      if (s1) {
        for (const i of piece.instances) {
          const lot = this.instanceLot[i]!;
          if (draws(lot) && !inLod0(lot) && inView(frustum, this.spheres, i)) s1.next[s1.n++] = i;
        }
        this.commit(s1);
      }
      this.commit(s0);
    }
  }

  /** Whether instance `i`'s sphere reaches into the sun's shadow camera (a square around the player); all do without one. */
  private insideShadowCamera(i: number): boolean {
    if (!this.shadow) return true;
    const s = this.castSpheres;
    const e = this.shadow.extent + s[i * 4 + 3]!;
    return Math.abs(s[i * 4]! - this.center.x) <= e && Math.abs(s[i * 4 + 2]! - this.center.z) <= e;
  }

  /** Applies a slot's new instance list if it differs from the one drawn. */
  private commit(s: Slot): void {
    const mesh = s.mesh;
    if (s.n === mesh.count) {
      let same = true;
      for (let k = 0; k < s.n && same; k++) same = s.next[k] === s.active[k];
      if (same) return;
    }
    const m = mesh.instanceMatrix.array as Float32Array;
    for (let k = 0; k < s.n; k++) {
      const i = s.next[k]!;
      s.active[k] = i;
      m.set(this.matrices.subarray(i * 16, i * 16 + 16), k * 16);
    }
    mesh.count = s.n;
    mesh.visible = s.n > 0;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, s.n * 16);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
}

/** Whether instance `i`'s sphere (cx, cy, cz, r at i*4) touches the frustum; everything is in view without one. */
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

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
