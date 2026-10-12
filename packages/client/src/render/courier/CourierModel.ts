import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ordersConfig, type PlayerState, type Vec3 } from '@dm/shared';
import type { CourierConfig, CourierPoseName } from '../../clientConfig';
import { palette } from '../palette';
import { animFor, easeYaw, type CourierAnim, type CourierClip } from './animState';
import type { CourierDebug, CourierView } from './CourierView';

const CLIPS: readonly CourierClip[] = ['Idle', 'Walking', 'Running', 'Jump'];
const DEG = Math.PI / 180;

/** A bone's local position and rotation, saved before a pose is layered over the clip and restored before the next mixer update. */
interface Saved {
  bone: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
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

/** Linear interpolation of a keyframed scalar at `t` (clamped to the first and last key). */
function sample(times: ArrayLike<number>, values: readonly number[], t: number): number {
  const n = times.length;
  if (t <= times[0]!) return values[0]!;
  for (let i = 1; i < n; i++) {
    if (t <= times[i]!) {
      const a = times[i - 1]!;
      const u = (t - a) / (times[i]! - a || 1);
      return values[i - 1]! + (values[i]! - values[i - 1]!) * u;
    }
  }
  return values[n - 1]!;
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
 * while a pose is on they are carried rigidly with the shins. Packages ride on the back; a deck shows on the board.
 *
 * Hierarchy: root (feet, eased yaw) → body (pose lean and drop; the frame pose angles are given in) → figure (glTF
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
  /** Bones the poses rotate, parents first, with the bone object for each config name. */
  private readonly poseBones: { name: string; bone: THREE.Bone }[];
  private readonly hips: THREE.Bone;
  private readonly legs: { shin: THREE.Bone; foot: THREE.Bone }[];
  private readonly torso: THREE.Bone;
  /** Torso bone → body frame at rest, inverted: carries the packages with the torso. */
  private readonly packagesRest = new THREE.Matrix4();
  private readonly materials = new Set<THREE.Material>();
  private saved: Saved[] = [];
  private readonly deckTop: number;
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
    const actions = {} as Record<CourierClip, THREE.AnimationAction>;
    for (const name of CLIPS) {
      const source = gltf.animations.find((a) => a.name === name);
      if (!source) throw new Error(`courier model has no "${name}" clip`);
      if (name !== 'Jump') {
        actions[name] = this.mixer.clipAction(source);
        continue;
      }
      // Jump: the airborne part only (its hop is taken out below), played once from take-off and then held.
      const [from, to] = cfg.airClip as [number, number];
      const air = source.clone();
      air.tracks = air.tracks.map((t) => {
        const c = t.clone(); // shares the source's arrays: copy them, since shift and settleOnFeet edit in place
        c.times = c.times.slice();
        c.values = c.values.slice();
        return c.trim(from, to).shift(-from);
      });
      air.resetDuration();
      const action = this.mixer.clipAction(air);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      actions[name] = action;
    }
    this.actions = actions;

    this.hips = findBone(this.figure, 'Body');
    this.torso = findBone(this.figure, 'Torso');
    this.legs = (['L', 'R'] as const).map((s) => ({ shin: findBone(this.figure, `LowerLeg${s}`), foot: findBone(this.figure, `Foot${s}`) }));
    this.poseNames = Object.keys(cfg.poses) as CourierPoseName[];
    for (const p of this.poseNames) this.weights.set(p, 0);
    const boneNames = new Set(this.poseNames.flatMap((p) => Object.keys(cfg.poses[p].bones)));
    this.poseBones = [...boneNames]
      .map((name) => ({ name, bone: findBone(this.figure, name) }))
      .sort((a, b) => depth(a.bone) - depth(b.bone));

    // Scale to courier.height from the idle pose, feet on the root.
    this.actions.Idle.play();
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.figure, true);
    const s = cfg.height / (box.max.y - box.min.y);
    this.figure.scale.setScalar(s);
    this.figure.position.y = -box.min.y * s;
    this.root.updateMatrixWorld(true);
    this.settleOnFeet(this.actions.Jump);
    this.actions.Jump.stop();
    this.actions.Idle.reset().play();
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);

    this.packages = this.buildPackages();
    this.body.add(this.packages);
    this.deckTop = this.buildDeck();
    this.root.add(this.deck);
  }

  /**
   * Takes a clip's baked hop out: at each key, lowers the hips and the feet (separate IK bones here) together so the
   * figure's lowest point sits on the feet. The sim's collider does the real jumping, and the figure stays on it.
   */
  private settleOnFeet(action: THREE.AnimationAction): void {
    const clip = action.getClip();
    const track = (name: string): THREE.KeyframeTrack | undefined => clip.tracks.find((t) => t.name === `${name}.position`);
    const hips = track('Body');
    if (!hips) return;
    const moved = [hips, track('FootL'), track('FootR')].filter((t): t is THREE.KeyframeTrack => t !== undefined);
    this.mixer.stopAllAction();
    action.reset().play();
    const scale = this.hips.parent!.getWorldScale(new THREE.Vector3()).y;
    const lows = Array.from(hips.times, (t) => {
      action.time = t;
      this.mixer.update(0);
      this.root.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(this.figure, true).min.y;
    });
    // In place: the action's interpolants already hold these arrays (the Jump copies made in the constructor).
    for (const t of moved) {
      for (let i = 0; i < t.times.length; i++) t.values[i * 3 + 1]! -= sample(hips.times, lows, t.times[i]!) / scale;
    }
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
    this.root.rotation.y = snap ? state.heading : easeYaw(this.root.rotation.y, state.heading, dt, this.cfg.turnEaseRate);
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
    return { loaded: true, clip: this.clip, pose: this.pose, time: this.mixer.time, packages: this.packageCount };
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
    for (const s of this.saved) {
      s.bone.position.copy(s.position);
      s.bone.quaternion.copy(s.quaternion);
    }
    this.saved = [];
  }

  private save(bone: THREE.Object3D): void {
    this.saved.push({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() });
  }

  /** Layers the blended poses over the clip; `raise` lifts the whole body (onto the deck). */
  private applyPose(raise: number): void {
    let drop = 0;
    let hipDrop = 0;
    const lean = [0, 0, 0];
    const rot = new Map<string, number[]>();
    let any = false;
    for (const p of this.poseNames) {
      const w = this.weights.get(p) ?? 0;
      if (w <= 0) continue;
      any = true;
      const spec = this.cfg.poses[p];
      drop += w * spec.drop;
      hipDrop += w * spec.hipDrop;
      for (let i = 0; i < 3; i++) lean[i]! += w * (spec.body[i] ?? 0);
      for (const [name, r] of Object.entries(spec.bones)) {
        const acc = rot.get(name) ?? [0, 0, 0];
        for (let i = 0; i < 3; i++) acc[i]! += w * (r[i] ?? 0);
        rot.set(name, acc);
      }
    }
    this.body.position.set(0, raise - drop, 0);
    this.body.rotation.set(lean[0]! * DEG, lean[1]! * DEG, lean[2]! * DEG);
    this.root.updateMatrixWorld(true);
    if (!any) return;

    // The feet are IK targets parented beside the legs: carry them with the shins through the pose.
    const footInShin = this.legs.map(({ shin, foot }) => shin.matrixWorld.clone().invert().multiply(foot.matrixWorld));
    for (const { foot } of this.legs) this.save(foot);
    this.save(this.hips);

    const frame = this.body.getWorldQuaternion(new THREE.Quaternion());
    if (hipDrop !== 0) {
      const p = this.hips.getWorldPosition(new THREE.Vector3());
      p.add(new THREE.Vector3(0, -hipDrop, 0).applyQuaternion(frame));
      this.hips.position.copy(this.hips.parent!.worldToLocal(p));
    }
    const frameInv = frame.clone().invert();
    const parentQ = new THREE.Quaternion();
    const delta = new THREE.Quaternion();
    const euler = new THREE.Euler();
    for (const { name, bone } of this.poseBones) {
      const r = rot.get(name);
      if (!r || (r[0] === 0 && r[1] === 0 && r[2] === 0)) continue;
      this.save(bone);
      // Parent orientation in the body frame (Qp); the delta is about body axes: q' = Qp⁻¹ · Δ · Qp · q.
      bone.parent!.getWorldQuaternion(parentQ).premultiply(frameInv);
      delta.setFromEuler(euler.set(r[0]! * DEG, r[1]! * DEG, r[2]! * DEG));
      const m = parentQ.clone().invert().multiply(delta).multiply(parentQ);
      bone.quaternion.premultiply(m);
    }
    const world = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    this.legs.forEach(({ shin, foot }, i) => {
      shin.updateWorldMatrix(true, false);
      foot.parent!.updateWorldMatrix(true, false);
      world.multiplyMatrices(shin.matrixWorld, footInShin[i]!);
      world.premultiply(foot.parent!.matrixWorld.clone().invert());
      world.decompose(foot.position, foot.quaternion, scale);
    });
    this.root.updateMatrixWorld(true);
  }

  /** Keeps the packages on the torso as it bends and bobs. */
  private followTorso(): void {
    const m = this.packages.matrix;
    m.copy(this.body.matrixWorld).invert().multiply(this.torso.matrixWorld).multiply(this.packagesRest);
    this.packages.matrixWorldNeedsUpdate = true;
    this.packages.updateMatrixWorld(true);
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
    const wheelMesh = new THREE.Mesh(mergeGeometries(wheels), new THREE.MeshLambertMaterial({ color: palette.rail }));
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
