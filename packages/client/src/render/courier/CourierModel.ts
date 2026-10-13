import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ordersConfig, type PlayerState, type Vec3 } from '@dm/shared';
import type { CourierConfig, CourierPoseName } from '../../clientConfig';
import { palette } from '../palette';
import { animFor, displayYaw, easeYaw, type CourierAnim, type CourierClip } from './animState';
import type { CourierDebug, CourierView } from './CourierView';

const CLIPS: readonly CourierClip[] = ['Idle', 'Walking', 'Running', 'Jump'];
const DEG = Math.PI / 180;

/** A clip with its own copies of every track's arrays (settleOnFeet and trimming edit them in place). */
function ownClip(source: THREE.AnimationClip): THREE.AnimationClip {
  const clip = source.clone();
  clip.tracks = clip.tracks.map((t) => {
    const c = t.clone(); // KeyframeTrack.clone shares the source's typed arrays
    c.times = c.times.slice();
    c.values = c.values.slice();
    return c;
  });
  return clip;
}

/** One pose's bone rotations, resolved to indices into the pose-bone list. */
interface PoseBones {
  bones: { index: number; r: number[] }[];
}

/** Finds a bone by its glTF name (GLTFLoader drops the dots and may add a _n suffix: "Foot.L" → "FootL"). */
function findBone(scene: THREE.Object3D, name: string): THREE.Bone {
  let exact: THREE.Bone | undefined;
  let suffixed: THREE.Bone | undefined;
  const re = new RegExp(`^${name}_\\d+$`);
  scene.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    if (o.name === name) exact ??= o as THREE.Bone;
    else if (re.test(o.name)) suffixed ??= o as THREE.Bone;
  });
  const bone = exact ?? suffixed;
  if (!bone) throw new Error(`courier model has no bone "${name}"`);
  return bone;
}

/** Hip and foot tracks are resampled this often (Hz) before their lowest point is settled onto the feet. */
const SETTLE_HZ = 60;

/** Replaces a track's keys with its own interpolated values at `times`. */
function resample(track: THREE.KeyframeTrack, times: readonly number[]): void {
  // createInterpolant is set per track at runtime (missing from the typings); it honours glTF cubic-spline tracks.
  const interp = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
  const n = track.getValueSize();
  const values = new Float32Array(times.length * n);
  times.forEach((t, i) => values.set(interp.evaluate(t), i * n));
  track.times = new Float32Array(times);
  track.values = values;
}

function depth(o: THREE.Object3D): number {
  let d = 0;
  for (let p = o.parent; p; p = p.parent) d++;
  return d;
}

/**
 * The animated courier: Quaternius "Robot Expressive" (CC0), scaled to courier.height and turned to the shared facing
 * convention. animFor picks a clip (cross-faded) and a procedural pose, which is layered over the clip as extra bone
 * rotations, a hip drop and a whole-body lean (blended over crossFade). The feet are separate IK bones in this rig, so
 * while a pose is on they are carried rigidly with the shins, and lifted back onto the floor if a pose swings one below
 * it. Packages ride on the back; a deck shows on the board.
 *
 * Hierarchy: root (feet, eased displayYaw) → body (pose lean and drop; the frame pose angles are given in) → figure (glTF
 * scene, scaled, turned 180° because the file faces +Z), plus the packages (in body) and the deck (in root).
 */
export class CourierModel implements CourierView {
  readonly root = new THREE.Group();
  /** The glTF scene: the robot alone. */
  readonly figure: THREE.Object3D;
  /** One box per carried package. */
  readonly packages: THREE.InstancedMesh;
  /** Skateboard deck and wheels, shown while on the board. */
  readonly deck = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Record<CourierClip, THREE.AnimationAction>;
  private clip: CourierClip = 'Idle';
  private pose: CourierAnim['pose'] = 'none';
  private readonly weights = new Map<CourierPoseName, number>();
  private readonly poseNames: CourierPoseName[];
  /** Bones the poses rotate, parents first, with each one's blended rotation this frame (degrees). */
  private readonly poseBones: { name: string; bone: THREE.Bone; sum: number[] }[];
  private readonly poseSpecs = new Map<CourierPoseName, PoseBones>();
  /** Bones a pose may move (hips, feet, pose bones) and their pre-pose local transforms, restored before the mixer runs. */
  private readonly posed: THREE.Object3D[];
  private readonly savedPos: THREE.Vector3[];
  private readonly savedQuat: THREE.Quaternion[];
  private posedSaved = false;
  // Scratch objects: applyPose runs every frame and allocates nothing.
  private readonly footInShin = [new THREE.Matrix4(), new THREE.Matrix4()];
  private readonly m4 = new THREE.Matrix4();
  private readonly inv = new THREE.Matrix4();
  private readonly frameQ = new THREE.Quaternion();
  private readonly frameInv = new THREE.Quaternion();
  private readonly parentQ = new THREE.Quaternion();
  private readonly parentInv = new THREE.Quaternion();
  private readonly delta = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly hips: THREE.Bone;
  /** Per leg: shin and foot bones, the foot's mesh and that mesh's local bounding-box corners (for the floor clamp). */
  private readonly legs: { shin: THREE.Bone; foot: THREE.Bone; mesh: THREE.Object3D; corners: THREE.Vector3[] }[];
  private readonly torso: THREE.Bone;
  /** Torso bone → body frame at rest, inverted: carries the packages with the torso. */
  private readonly packagesRest = new THREE.Matrix4();
  private readonly materials = new Set<THREE.Material>();
  /** Height of the deck top above the feet; the figure stands on it while on the board. */
  readonly deckTop: number;
  private snapNext = true;
  private packageCount = 0;

  static async load(url: string, cfg: CourierConfig): Promise<CourierModel | null> {
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      return new CourierModel(gltf, cfg);
    } catch (err) {
      console.warn(`Courier model unavailable (${url}); showing the capsule instead.`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  constructor(
    gltf: GLTF,
    private readonly cfg: CourierConfig,
  ) {
    this.figure = gltf.scene;
    this.figure.rotation.y = Math.PI;
    this.root.name = 'courier';
    this.root.add(this.body);
    this.body.add(this.figure);

    this.figure.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      const own = (m: THREE.Material): THREE.Material => {
        const c = m.clone();
        // Fictional courier colours: the file's orange body becomes the courier teal (no orange on black, spec §16).
        if (c.name === 'Main' && 'color' in c) (c as THREE.MeshStandardMaterial).color.setHex(palette.teal);
        this.materials.add(c);
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    });

    this.mixer = new THREE.AnimationMixer(this.figure);
    const clips = {} as Record<CourierClip, THREE.AnimationClip>;
    for (const name of CLIPS) {
      const source = gltf.animations.find((a) => a.name === name);
      if (!source) throw new Error(`courier model has no "${name}" clip`);
      const clip = ownClip(source);
      if (name === 'Jump') {
        // The airborne part only (its hop is taken out below), played once from take-off and then held.
        const [from, to] = cfg.airClip as [number, number];
        for (const t of clip.tracks) t.trim(from, to).shift(-from);
        clip.resetDuration();
      }
      clips[name] = clip;
    }

    this.hips = findBone(this.figure, 'Body');
    this.torso = findBone(this.figure, 'Torso');
    this.legs = (['L', 'R'] as const).map((side) => {
      const foot = findBone(this.figure, `Foot${side}`);
      const mesh = foot.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
      if (!mesh) throw new Error(`courier model has no mesh on Foot${side}`);
      mesh.geometry.computeBoundingBox();
      const { min, max } = mesh.geometry.boundingBox!;
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
        (k) => new THREE.Vector3(k & 1 ? max.x : min.x, k & 2 ? max.y : min.y, k & 4 ? max.z : min.z),
      );
      return { shin: findBone(this.figure, `LowerLeg${side}`), foot, mesh, corners };
    });
    this.poseNames = Object.keys(cfg.poses) as CourierPoseName[];
    for (const p of this.poseNames) this.weights.set(p, 0);
    const boneNames = new Set(this.poseNames.flatMap((p) => Object.keys(cfg.poses[p].bones)));
    this.poseBones = [...boneNames]
      .map((name) => ({ name, bone: findBone(this.figure, name), sum: [0, 0, 0] }))
      .sort((a, b) => depth(a.bone) - depth(b.bone));
    for (const p of this.poseNames) {
      const bones = Object.entries(cfg.poses[p].bones).map(([name, r]) => ({ index: this.poseBones.findIndex((b) => b.name === name), r }));
      this.poseSpecs.set(p, { bones });
    }
    this.posed = [this.hips, ...this.legs.map((l) => l.foot), ...this.poseBones.map((b) => b.bone)];
    this.savedPos = this.posed.map(() => new THREE.Vector3());
    this.savedQuat = this.posed.map(() => new THREE.Quaternion());

    // Scale to courier.height from the idle pose, feet on the root.
    const idle = this.mixer.clipAction(clips.Idle);
    idle.play();
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.figure, true);
    const s = cfg.height / (box.max.y - box.min.y);
    this.figure.scale.setScalar(s);
    this.figure.position.y = -box.min.y * s;
    this.root.updateMatrixWorld(true);
    // The sim's collider does the moving: these clips keep their lowest point on the feet (no baked hop, no toes or
    // hands through the floor).
    this.actions = {
      Idle: idle,
      Walking: this.settleOnFeet(clips.Walking),
      Running: this.settleOnFeet(clips.Running),
      Jump: this.settleOnFeet(clips.Jump),
    };
    this.actions.Jump.setLoop(THREE.LoopOnce, 1);
    this.actions.Jump.clampWhenFinished = true;
    this.mixer.stopAllAction();
    idle.reset().play();
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);

    this.packages = this.buildPackages();
    this.body.add(this.packages);
    this.deckTop = this.buildDeck();
    this.root.add(this.deck);
  }

  /**
   * Takes a clip's baked hop out and keeps it out of the floor: the hip and foot position tracks (the feet are separate
   * IK bones here) are resampled at SETTLE_HZ, then at each sample the hips and feet are moved up or down together so
   * the figure's lowest point sits on the feet. Returns the clip's action.
   */
  private settleOnFeet(clip: THREE.AnimationClip): THREE.AnimationAction {
    const track = (name: string): THREE.KeyframeTrack | undefined => clip.tracks.find((t) => t.name === `${name}.position`);
    const hips = track('Body');
    if (!hips) return this.mixer.clipAction(clip);
    const moved = [hips, track('FootL'), track('FootR')].filter((t): t is THREE.KeyframeTrack => t !== undefined);
    const grid: number[] = [];
    for (let t = 0; t < clip.duration; t += 1 / SETTLE_HZ) grid.push(t);
    grid.push(clip.duration);
    // Before the action exists: its interpolants bind to the track arrays when it is created.
    for (const t of moved) resample(t, grid);
    const action = this.mixer.clipAction(clip);
    this.mixer.stopAllAction();
    action.reset().play();
    const scale = this.hips.parent!.getWorldScale(new THREE.Vector3()).y;
    const lows = grid.map((t) => {
      action.time = t;
      this.mixer.update(0);
      this.root.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(this.figure, true).min.y;
    });
    // In place: the action's interpolants hold these arrays.
    for (const t of moved) lows.forEach((low, i) => (t.values[i * 3 + 1]! -= low / scale));
    action.stop();
    return action;
  }

  /** A bone by glTF name (tests and tuning). */
  bone(name: string): THREE.Bone {
    return findBone(this.figure, name);
  }

  update(dt: number, state: PlayerState, feet: Vec3, speed: number): void {
    const anim = animFor(state, speed, this.cfg);
    const snap = this.snapNext;
    this.snapNext = false;
    this.root.position.set(feet.x, feet.y, feet.z);
    const yaw = displayYaw(state, this.cfg);
    this.root.rotation.y = snap ? yaw : easeYaw(this.root.rotation.y, yaw, dt, this.cfg.turnEaseRate);
    this.playClip(anim.clip, anim.timeScale, snap);
    this.pose = anim.pose;
    const step = this.cfg.crossFade > 0 ? Math.max(0, dt) / this.cfg.crossFade : Infinity;
    for (const p of this.poseNames) {
      const target = anim.pose === p ? 1 : 0;
      const w = this.weights.get(p) ?? 0;
      this.weights.set(p, snap ? target : w < target ? Math.min(target, w + step) : Math.max(target, w - step));
    }
    this.deck.visible = state.onBoard;

    this.restore();
    this.mixer.update(Math.max(0, dt));
    this.applyPose(state.onBoard ? this.deckTop : 0);
    this.followTorso();
  }

  setHidden(hidden: boolean): void {
    // Not drawn into the colour or depth buffers, but still into the shadow map (its own depth material).
    for (const m of this.materials) {
      m.colorWrite = !hidden;
      m.depthWrite = !hidden;
    }
  }

  setPackages(n: number): void {
    this.packageCount = n;
    const shown = Math.max(0, Math.min(n, this.packages.instanceMatrix.count));
    this.packages.count = shown;
    this.packages.visible = shown > 0;
  }

  snap(): void {
    this.snapNext = true;
  }

  debug(): CourierDebug {
    return { loaded: true, clip: this.clip, pose: this.pose, time: this.mixer.time, yaw: this.root.rotation.y, packages: this.packageCount };
  }

  private playClip(clip: CourierClip, timeScale: number, snap: boolean): void {
    const next = this.actions[clip];
    if (clip !== this.clip || snap) {
      const prev = this.actions[this.clip];
      next.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(1).play();
      if (snap) {
        for (const a of Object.values(this.actions)) if (a !== next) a.stop();
      } else if (prev !== next) {
        next.crossFadeFrom(prev, this.cfg.crossFade, false);
      }
      this.clip = clip;
    } else {
      next.setEffectiveTimeScale(timeScale);
    }
  }

  /** Puts back the bones the last pose moved, so the mixer (which only writes animated tracks) starts clean. */
  private restore(): void {
    if (!this.posedSaved) return;
    this.posed.forEach((b, i) => {
      b.position.copy(this.savedPos[i]!);
      b.quaternion.copy(this.savedQuat[i]!);
    });
    this.posedSaved = false;
  }

  /** Layers the blended poses over the clip; `raise` lifts the whole body (onto the deck). */
  private applyPose(raise: number): void {
    let drop = 0;
    let hipDrop = 0;
    let lx = 0;
    let ly = 0;
    let lz = 0;
    let any = false;
    for (const b of this.poseBones) b.sum.fill(0);
    for (const p of this.poseNames) {
      const w = this.weights.get(p) ?? 0;
      if (w <= 0) continue;
      any = true;
      const spec = this.cfg.poses[p];
      drop += w * spec.drop;
      hipDrop += w * spec.hipDrop;
      lx += w * (spec.body[0] ?? 0);
      ly += w * (spec.body[1] ?? 0);
      lz += w * (spec.body[2] ?? 0);
      for (const { index, r } of this.poseSpecs.get(p)!.bones) {
        const sum = this.poseBones[index]!.sum;
        for (let i = 0; i < 3; i++) sum[i]! += w * (r[i] ?? 0);
      }
    }
    this.body.position.set(0, raise - drop, 0);
    this.body.rotation.set(lx * DEG, ly * DEG, lz * DEG);
    if (!any) return;

    this.posed.forEach((b, i) => {
      this.savedPos[i]!.copy(b.position);
      this.savedQuat[i]!.copy(b.quaternion);
    });
    this.posedSaved = true;

    // The feet are IK targets parented beside the legs: carry them with the shins through the pose.
    this.legs.forEach(({ shin, foot }, i) => {
      shin.updateWorldMatrix(true, false);
      foot.updateWorldMatrix(true, false);
      this.footInShin[i]!.copy(shin.matrixWorld).invert().multiply(foot.matrixWorld);
    });

    this.body.getWorldQuaternion(this.frameQ);
    this.frameInv.copy(this.frameQ).invert();
    if (hipDrop !== 0) {
      this.hips.getWorldPosition(this.v).add(this.v2.set(0, -hipDrop, 0).applyQuaternion(this.frameQ));
      this.hips.position.copy(this.hips.parent!.worldToLocal(this.v));
    }
    for (const { bone, sum } of this.poseBones) {
      if (sum[0] === 0 && sum[1] === 0 && sum[2] === 0) continue;
      // Parent orientation in the body frame (Qp); the delta is about body axes: q' = Qp⁻¹ · Δ · Qp · q.
      bone.parent!.getWorldQuaternion(this.parentQ).premultiply(this.frameInv);
      this.delta.setFromEuler(this.euler.set(sum[0]! * DEG, sum[1]! * DEG, sum[2]! * DEG));
      this.parentInv.copy(this.parentQ).invert();
      bone.quaternion.premultiply(this.parentInv.multiply(this.delta).multiply(this.parentQ));
    }
    this.legs.forEach(({ shin, foot }, i) => {
      shin.updateWorldMatrix(true, false);
      foot.parent!.updateWorldMatrix(true, false);
      this.m4.multiplyMatrices(shin.matrixWorld, this.footInShin[i]!);
      this.m4.premultiply(this.inv.copy(foot.parent!.matrixWorld).invert());
      this.m4.decompose(foot.position, foot.quaternion, this.v);
    });
    // A pose may swing a foot below the floor (a bent knee over a walking stride): lift that foot back onto it.
    const floor = this.root.position.y + raise;
    for (const { foot, mesh, corners } of this.legs) {
      mesh.updateWorldMatrix(true, false);
      let lowest = Infinity;
      for (const c of corners) lowest = Math.min(lowest, this.v.copy(c).applyMatrix4(mesh.matrixWorld).y);
      if (lowest >= floor) continue;
      foot.getWorldPosition(this.v).y += floor - lowest;
      foot.position.copy(foot.parent!.worldToLocal(this.v));
    }
  }

  /** Keeps the packages on the torso as it bends and bobs. */
  private followTorso(): void {
    this.torso.updateWorldMatrix(true, false); // brings the body's world matrix up to date too
    const m = this.packages.matrix;
    m.copy(this.body.matrixWorld).invert().multiply(this.torso.matrixWorld).multiply(this.packagesRest);
    this.packages.matrixWorldNeedsUpdate = true;
  }

  /** Boxes in `columns` up the back, placed in the body frame at rest and then carried by the torso bone. */
  private buildPackages(): THREE.InstancedMesh {
    const { size, gap, columns } = this.cfg.packages;
    const max = ordersConfig.backpack.maxSlots;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshLambertMaterial({ color: palette.parcel }),
      max,
    );
    mesh.name = 'courier-packages';
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false; // the box set grows and shrinks with count
    mesh.matrixAutoUpdate = false;
    this.materials.add(mesh.material as THREE.Material);
    // The back: behind the torso shell, from its lower edge upward.
    const shell = new THREE.Box3();
    const torsoMesh = this.figure.getObjectByName('Torso');
    if (!torsoMesh) throw new Error('courier model has no "Torso" mesh');
    const toBody = this.body.matrixWorld.clone().invert();
    torsoMesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const g = (o as THREE.Mesh).geometry;
        g.computeBoundingBox();
        shell.union(g.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toBody, o.matrixWorld)));
      }
    });
    const pitch = size + gap;
    const m = new THREE.Matrix4();
    for (let i = 0; i < max; i++) {
      const col = i % columns;
      const row = Math.floor(i / columns);
      m.makeTranslation((col - (columns - 1) / 2) * pitch, shell.min.y + row * pitch + size / 2, shell.max.z + size / 2 + gap);
      mesh.setMatrixAt(i, m);
    }
    // Torso bone at rest in the body frame, inverted, so followTorso maps body-frame placements onto the moving torso.
    this.packagesRest.copy(toBody.multiply(this.torso.matrixWorld)).invert();
    mesh.count = 0;
    mesh.visible = false;
    return mesh;
  }

  /** A deck on wheels along the courier's heading; returns the deck top height (the feet stand on it). */
  private buildDeck(): number {
    const { length, width, thickness, wheelGap } = this.cfg.deck;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, length), new THREE.MeshLambertMaterial({ color: palette.coral }));
    deck.position.y = wheelGap + thickness / 2;
    const r = wheelGap / 2;
    const wheels: THREE.BufferGeometry[] = [];
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        const w = new THREE.CylinderGeometry(r, r, r, 10).rotateZ(Math.PI / 2);
        wheels.push(w.translate((x * (width - r)) / 2, r, z * (length / 2 - width / 2)));
      }
    }
    const wheelMesh = new THREE.Mesh(mergeGeometries(wheels), new THREE.MeshLambertMaterial({ color: palette.wheel }));
    for (const m of [deck, wheelMesh]) {
      m.castShadow = true;
      m.receiveShadow = false;
      this.materials.add(m.material);
      this.deck.add(m);
    }
    this.deck.name = 'courier-deck';
    this.deck.visible = false;
    return wheelGap + thickness;
  }
}
