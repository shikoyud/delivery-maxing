import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { movementConfig, type PieceCatalog, type ThiefMode, type ThiefState, type Vec3 } from '@dm/shared';
import { clientConfig, type ThievesRenderConfig } from '../../clientConfig';
import { cityAssetUrl } from '../../game/mapLoader';
import { palette } from '../palette';

/** The clips every c-thief model carries (checked by the tools catalog test). */
export type ThiefClip = 'Man_Idle' | 'Man_Walk' | 'Man_Run' | 'Man_Punch';
const CLIPS: readonly ThiefClip[] = ['Man_Idle', 'Man_Walk', 'Man_Run', 'Man_Punch'];

/**
 * A thief's clip and playback rate (pure). Precedence: Man_Punch while `catching` (punchSeconds after a catch), Man_Run
 * while chasing (rate speed / runSpeedForFullRun), Man_Walk on patrol or return above idleSpeed, else Man_Idle.
 */
export function thiefClip(
  mode: ThiefMode,
  speed: number,
  catching: boolean,
  cfg: ThievesRenderConfig = clientConfig.thieves,
): { clip: ThiefClip; timeScale: number } {
  if (catching) return { clip: 'Man_Punch', timeScale: 1 };
  if (mode === 'chase') return { clip: 'Man_Run', timeScale: speed / cfg.runSpeedForFullRun };
  if (speed > cfg.idleSpeed) return { clip: 'Man_Walk', timeScale: 1 };
  return { clip: 'Man_Idle', timeScale: 1 };
}

/** What the debug API reports about one drawn thief. */
export interface ThiefDebug {
  id: string;
  /** Within renderRadius of the player: in the scene and animating. */
  visible: boolean;
  /** The animated model (false: the capsule fallback). */
  loaded: boolean;
  /** The clip playing (null for the capsule). */
  clip: ThiefClip | null;
  /** Animation mixer time (s); advances only while the thief is visible. */
  time: number;
  /** The drawn yaw (the sim heading). */
  yaw: number;
}

/** One c-thief model, prepared for cloning: a single skinned mesh and its clips. */
interface Variant {
  scene: THREE.Object3D;
  clips: Map<ThiefClip, THREE.AnimationClip>;
}

/** One drawn thief: its root at the feet, and (for a model) its mixer. */
interface Figure {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  actions: Map<ThiefClip, THREE.AnimationAction>;
  clip: ThiefClip | null;
  /** Seconds of Man_Punch left after a catch. */
  punchLeft: number;
  /** Within renderRadius at the last update (in the scene). */
  visible: boolean;
  /** The next shown frame starts its clip without a cross-fade (first shown, or shown again after being hidden). */
  snap: boolean;
}

/** All thieves share one material: the model colours are baked into vertex colours (one draw call per thief). */
const sharedMaterial = (): THREE.Material => new THREE.MeshLambertMaterial({ vertexColors: true });

/**
 * Merges the model's skinned primitives (one per source material) into one skinned mesh whose vertex colours are the
 * source materials' colours, so each clone costs one draw call (plus its shadow) instead of one per material.
 */
function mergeSkinnedParts(scene: THREE.Object3D, material: THREE.Material, path: string): void {
  const parts: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) parts.push(o as THREE.SkinnedMesh);
  });
  const first = parts[0];
  if (!first) throw new Error(`${path}: no skinned mesh`);
  if (parts.some((p) => p.parent !== first.parent || p.skeleton.bones.length !== first.skeleton.bones.length)) {
    throw new Error(`${path}: skinned parts do not share one skin`);
  }
  const geometries = parts.map((p) => {
    if (Array.isArray(p.material)) throw new Error(`${path}: multi-material primitive`);
    const color = (p.material as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1);
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) {
      const a = p.geometry.getAttribute(name);
      if (!a) throw new Error(`${path}: a skinned part has no ${name}`);
      g.setAttribute(name, a);
    }
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setIndex(p.geometry.index);
    return g;
  });
  const merged = mergeGeometries(geometries);
  if (!merged) throw new Error(`${path}: the skinned parts' attributes differ`);
  const mesh = new THREE.SkinnedMesh(merged, material);
  mesh.name = `${first.name}-merged`;
  mesh.position.copy(first.position);
  mesh.quaternion.copy(first.quaternion);
  mesh.scale.copy(first.scale);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.bindMode = first.bindMode;
  mesh.bind(first.skeleton, first.bindMatrix);
  const parent = first.parent!;
  for (const p of parts) parent.remove(p);
  parent.add(mesh);
}

/** A loaded c-thief GLB as a variant: one merged skinned mesh, every clip present. */
function variantOf(gltf: GLTF, material: THREE.Material, path: string): Variant {
  const clips = new Map<ThiefClip, THREE.AnimationClip>();
  for (const name of CLIPS) {
    const clip = gltf.animations.find((a) => a.name === name);
    if (!clip) throw new Error(`${path}: no ${name} clip`);
    clips.set(name, clip);
  }
  mergeSkinnedParts(gltf.scene, material, path);
  // The model faces +z; heading 0 faces −Z (movement facing()).
  gltf.scene.rotation.y = Math.PI;
  return { scene: gltf.scene, clips };
}

/**
 * The street thieves (spec §7.3) as animated low-poly characters: one skinned clone per thief, alternating the c-thief
 * variants. Only thieves within renderRadius of the player are in the scene and have their mixer updated; the rest
 * cost nothing per frame. When the models fail to load, every thief is a dark capsule (one warning).
 */
export class ThiefView {
  readonly group = new THREE.Group();
  private readonly figures = new Map<string, Figure>();
  private capsuleMesh: THREE.Mesh | null = null;

  /** Loads every c-thief model (sorted by piece id); never rejects: a failure falls back to capsules with one warning. */
  static async load(pieces: PieceCatalog, cfg: ThievesRenderConfig = clientConfig.thieves): Promise<ThiefView> {
    const paths = Object.values(pieces)
      .filter((p) => p.kind === 'character' && p.id.startsWith('c-thief-'))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => p.lod0);
    try {
      if (paths.length === 0) throw new Error('the piece catalog has no c-thief models');
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const models = await Promise.all(paths.map(async (path) => ({ path, gltf: await loader.loadAsync(cityAssetUrl(path)) })));
      return ThiefView.fromModels(models, cfg);
    } catch (err) {
      console.warn(`Thief models unavailable (${paths.join(', ')}); showing capsules instead.`, err instanceof Error ? err.message : err);
      return new ThiefView(null, cfg);
    }
  }

  /** The view over loaded c-thief GLBs (`path` names a model in errors). Throws when a model lacks a clip or one skin. */
  static fromModels(models: { path: string; gltf: GLTF }[], cfg: ThievesRenderConfig = clientConfig.thieves): ThiefView {
    const material = sharedMaterial();
    return new ThiefView(models.map((m) => variantOf(m.gltf, material, m.path)), cfg);
  }

  /** `variants`: the prepared models, or null for the capsule fallback. */
  private constructor(
    private readonly variants: Variant[] | null,
    private readonly cfg: ThievesRenderConfig,
  ) {
    this.group.name = 'thieves';
  }

  /** Whether the thieves are the animated models (false: the capsule fallback). */
  get loaded(): boolean {
    return this.variants !== null;
  }

  /** A thief caught the courier: it plays Man_Punch for punchSeconds. */
  caught(thiefId: string): void {
    const f = this.figures.get(thiefId);
    if (f) f.punchLeft = this.cfg.punchSeconds;
  }

  /**
   * Per frame: `thieves` at their drawn (interpolated) positions, `center` the player's feet, `dt` the frame time (s).
   * Thieves beyond renderRadius (horizontal) leave the scene and their mixers stop.
   */
  update(dt: number, thieves: readonly ThiefState[], center: Vec3): void {
    const r2 = this.cfg.renderRadius ** 2;
    for (const [i, t] of thieves.entries()) {
      const f = this.figures.get(t.id) ?? this.createFigure(t.id, i);
      const catching = f.punchLeft > 0;
      f.punchLeft = Math.max(0, f.punchLeft - Math.max(0, dt));
      const visible = (t.position.x - center.x) ** 2 + (t.position.z - center.z) ** 2 <= r2;
      if (visible !== f.visible) {
        if (visible) this.group.add(f.root);
        else this.group.remove(f.root);
        f.visible = visible;
        f.snap = true;
      }
      if (!visible) continue;
      f.root.position.set(t.position.x, t.position.y, t.position.z);
      f.root.rotation.y = t.heading;
      if (!f.mixer) continue;
      const { clip, timeScale } = thiefClip(t.mode, t.speed, catching, this.cfg);
      this.play(f, clip, timeScale);
      f.mixer.update(Math.max(0, dt));
    }
  }

  debug(): ThiefDebug[] {
    return [...this.figures].map(([id, f]) => ({
      id,
      visible: f.visible,
      loaded: f.mixer !== null,
      clip: f.clip,
      time: f.mixer?.time ?? 0,
      yaw: f.root.rotation.y,
    }));
  }

  /** The `index`-th thief's figure: variant index mod the variant count, or a capsule. Not in the scene until visible. */
  private createFigure(id: string, index: number): Figure {
    const variant = this.variants?.[index % this.variants.length];
    const root = new THREE.Group();
    root.name = `thief-${id}`;
    const f: Figure = { root, mixer: null, actions: new Map(), clip: null, punchLeft: 0, visible: false, snap: true };
    if (variant) {
      const model = cloneSkinned(variant.scene);
      root.add(model);
      f.mixer = new THREE.AnimationMixer(model);
      for (const [name, clip] of variant.clips) f.actions.set(name, f.mixer.clipAction(clip));
    } else {
      root.add(this.capsule());
    }
    this.figures.set(id, f);
    return f;
  }

  /** Starts `clip` at `timeScale`: cross-faded from the previous clip, or at once after a snap. */
  private play(f: Figure, clip: ThiefClip, timeScale: number): void {
    const next = f.actions.get(clip)!;
    if (clip !== f.clip || f.snap) {
      const prev = f.clip !== null ? f.actions.get(f.clip)! : null;
      if (f.snap || !prev || this.cfg.crossFade <= 0) f.mixer!.stopAllAction();
      next.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(1).play();
      if (!f.snap && prev && prev !== next && this.cfg.crossFade > 0) next.crossFadeFrom(prev, this.cfg.crossFade, false);
      f.clip = clip;
      f.snap = false;
    } else {
      next.setEffectiveTimeScale(timeScale);
    }
  }

  /** The fallback body: a dark capsule as big as the courier's movement capsule, standing on the feet. */
  private capsule(): THREE.Mesh {
    if (!this.capsuleMesh) {
      const { radius, height } = movementConfig.capsule;
      const geometry = new THREE.CapsuleGeometry(radius, height - 2 * radius, 6, 12).translate(0, height / 2, 0);
      this.capsuleMesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: palette.thief }));
      this.capsuleMesh.castShadow = true;
      this.capsuleMesh.receiveShadow = false;
    }
    return this.capsuleMesh.clone(); // shares the geometry and material
  }
}
