import type { Document } from '@gltf-transform/core';

type M4 = number[];

/** Column-major 4×4 product a · b. */
function mul(a: M4, b: M4): M4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
  }
  return out;
}

const apply = (m: M4, v: number[]): [number, number, number] => [
  m[0]! * v[0]! + m[4]! * v[1]! + m[8]! * v[2]! + m[12]!,
  m[1]! * v[0]! + m[5]! * v[1]! + m[9]! * v[2]! + m[13]!,
  m[2]! * v[0]! + m[6]! * v[1]! + m[10]! * v[2]! + m[14]!,
];

/**
 * Keeps only the named animation clips (matched on the part after the last '|', e.g. 'HumanArmature|Man_Run'
 * → 'Man_Run') and renames them to that short name. Throws when a requested clip is missing.
 */
export function keepClips(doc: Document, names: readonly string[]): void {
  const found = new Set<string>();
  for (const anim of doc.getRoot().listAnimations()) {
    const short = anim.getName().split('|').pop() ?? '';
    if (names.includes(short) && !found.has(short)) {
      anim.setName(short);
      found.add(short);
    } else {
      anim.dispose();
    }
  }
  const missing = names.filter((n) => !found.has(n));
  if (missing.length) throw new Error(`missing animation clips: ${missing.join(', ')}`);
}

/** World-space AABB of the meshes in their rest pose, skinning applied (glTF: Σ w · jointWorld · inverseBind · v). */
export function characterBounds(doc: Document): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const grow = (p: number[]) => {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, p[k]!);
      max[k] = Math.max(max[k]!, p[k]!);
    }
  };
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const skin = node.getSkin();
    const jointMats = skin?.listJoints().map((j, i) => {
      const ibm = skin.getInverseBindMatrices()?.getElement(i, []) ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      return mul(j.getWorldMatrix() as unknown as M4, ibm);
    });
    const world = node.getWorldMatrix() as unknown as M4;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')!;
      const joints = prim.getAttribute('JOINTS_0');
      const weights = prim.getAttribute('WEIGHTS_0');
      const v: number[] = [], j: number[] = [], w: number[] = [];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        if (!jointMats || !joints || !weights) {
          grow(apply(world, v));
          continue;
        }
        joints.getElement(i, j);
        weights.getElement(i, w);
        const p: [number, number, number] = [0, 0, 0];
        for (let k = 0; k < 4; k++) {
          if (!w[k]) continue;
          const q = apply(jointMats[j[k]!]!, v);
          for (let a = 0; a < 3; a++) p[a] = p[a]! + w[k]! * q[a]!;
        }
        grow(p);
      }
    }
  }
  return { min, max };
}

/** Wraps the scene in a root node that scales the rest pose to `height` metres, feet at y = 0, centred in x and z. */
export function normaliseCharacter(doc: Document, height: number): void {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error('document has no scene');
  const { min, max } = characterBounds(doc);
  const s = height / (max[1] - min[1]);
  const root = doc
    .createNode('Character')
    .setScale([s, s, s])
    .setTranslation([(-(min[0] + max[0]) / 2) * s, -min[1] * s, (-(min[2] + max[2]) / 2) * s]);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    root.addChild(child);
  }
  scene.addChild(root);
}

