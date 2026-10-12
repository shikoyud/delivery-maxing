import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ordersConfig, type MoveMode, type PlayerState, type Vec3 } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { CourierModel } from '../src/render/courier/CourierModel';

const cfg = clientConfig.courier;
const glb = readFileSync(new URL('../../../assets/models/RobotExpressive.glb', import.meta.url));

async function model(): Promise<CourierModel> {
  const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  return new CourierModel(await new GLTFLoader().parseAsync(ab, ''), cfg);
}

function st(over: Partial<{ mode: MoveMode; heading: number; onBoard: boolean; crouched: boolean; vy: number; normal: Vec3 | null }> = {}): PlayerState {
  return {
    mode: over.mode ?? 'ground',
    heading: over.heading ?? 0,
    onBoard: over.onBoard ?? false,
    crouched: over.crouched ?? false,
    velocity: { x: 0, y: over.vy ?? 0, z: 0 },
    wallRun: { time: 0.2, normal: over.normal ?? null, lastNormal: null },
  } as unknown as PlayerState;
}

const origin = { x: 0, y: 0, z: 0 };

/** World box of the courier's visible meshes (skinning applied), packages and deck excluded. */
function bodyBox(m: CourierModel): THREE.Box3 {
  m.root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(m.figure, true);
}

const meshesOf = (o: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh);
  });
  return out;
};

afterEach(() => vi.restoreAllMocks());

describe('CourierModel', () => {
  it('is courier.height tall, standing on the feet', async () => {
    const m = await model();
    m.snap();
    m.update(0, st(), { x: 3, y: 2, z: -4 }, 0);
    const b = bodyBox(m);
    expect(b.max.y - b.min.y).toBeCloseTo(cfg.height, 1);
    expect(b.min.y).toBeCloseTo(2, 1);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(3, 0);
  });

  it('faces −Z at heading 0 and turns left with positive heading (the shared facing convention)', async () => {
    const m = await model();
    const forward = (): THREE.Vector3 => {
      m.root.updateMatrixWorld(true);
      // The file's model faces its own +Z.
      return m.figure.getWorldDirection(new THREE.Vector3());
    };
    m.snap();
    m.update(0, st({ heading: 0 }), origin, 0);
    expect(forward().z).toBeCloseTo(-1, 5);
    m.snap();
    m.update(0, st({ heading: Math.PI / 2 }), origin, 0);
    expect(forward().x).toBeCloseTo(-1, 5);
  });

  it('eases its yaw toward the heading at turnEaseRate; snap jumps', async () => {
    const m = await model();
    m.snap();
    m.update(0, st({ heading: 0 }), origin, 0);
    m.update(0.05, st({ heading: 1 }), origin, 0);
    expect(m.root.rotation.y).toBeGreaterThan(0.1);
    expect(m.root.rotation.y).toBeLessThan(1);
    m.snap();
    m.update(0.016, st({ heading: -2 }), origin, 0);
    expect(m.root.rotation.y).toBeCloseTo(-2, 9);
  });

  it('plays the clip animFor picks, and the mixer time advances', async () => {
    const m = await model();
    m.snap();
    m.update(0, st(), origin, 0);
    expect(m.debug()).toMatchObject({ loaded: true, clip: 'Idle', pose: 'none' });
    m.update(0.1, st(), origin, 8);
    m.update(0.1, st(), origin, 8);
    expect(m.debug().clip).toBe('Running');
    expect(m.debug().time).toBeGreaterThan(0);
    m.update(0.1, st({ mode: 'slide', crouched: true }), origin, 9);
    expect(m.debug()).toMatchObject({ clip: 'Idle', pose: 'slide' });
  });

  it('poses change the figure: slide lowers it, zip raises the arms, wall-run leans away from the wall', async () => {
    const m = await model();
    const settle = (s: PlayerState, speed: number): THREE.Box3 => {
      m.snap();
      m.update(0, s, origin, speed);
      for (let i = 0; i < 10; i++) m.update(0.05, s, origin, speed);
      return bodyBox(m);
    };
    const stand = settle(st(), 0);
    const slide = settle(st({ mode: 'slide', crouched: true }), 9);
    expect(slide.max.y).toBeLessThan(stand.max.y - 0.5);
    expect(slide.min.y).toBeGreaterThan(-0.05); // nothing sinks into the floor
    const hand = (): number => m.bone('Palm2L').getWorldPosition(new THREE.Vector3()).y;
    settle(st(), 0);
    const standHand = hand();
    settle(st({ mode: 'zipline' }), 12);
    expect(hand()).toBeGreaterThan(standHand + 0.5);
    // Wall on the left (normal +X at heading 0): the head leans right (+X).
    const head = (): THREE.Vector3 => m.bone('Head').getWorldPosition(new THREE.Vector3());
    settle(st({ mode: 'wallrun', normal: { x: 1, y: 0, z: 0 } }), 8);
    const left = head().x;
    settle(st({ mode: 'wallrun', normal: { x: -1, y: 0, z: 0 } }), 8);
    const right = head().x;
    expect(left).toBeGreaterThan(0.15);
    expect(right).toBeLessThan(-0.15);
  });

  it('in the air the jump clip holds its airborne frame without lifting the figure off the sim feet', async () => {
    const m = await model();
    const hand = (): number => m.bone('LowerArmL').getWorldPosition(new THREE.Vector3()).y;
    m.snap();
    m.update(0, st(), origin, 0);
    m.root.updateMatrixWorld(true);
    const idleHand = hand();
    const air = st({ mode: 'air', vy: 3 });
    m.snap();
    m.update(0, air, origin, 6);
    for (let i = 0; i < 40; i++) m.update(0.05, air, origin, 6); // 2 s: long past the clip's end
    m.root.updateMatrixWorld(true);
    expect(m.debug().clip).toBe('Jump');
    // The lower foot stays on the collider's feet (the clip's own hop is taken out).
    expect(Math.abs(bodyBox(m).min.y)).toBeLessThan(0.08);
    // Held on the airborne frame, arms raised.
    expect(hand()).toBeGreaterThan(idleHand + 0.2);
  });

  it('poses do not accumulate frame over frame', async () => {
    const m = await model();
    const s = st({ mode: 'zipline' });
    m.snap();
    m.update(0, s, origin, 12);
    const a = bodyBox(m);
    for (let i = 0; i < 30; i++) m.update(1 / 60, s, origin, 12);
    const b = bodyBox(m);
    expect(b.max.y).toBeCloseTo(a.max.y, 1);
  });

  it('crouched it fits under the 1.4 m crouch tunnel', async () => {
    const m = await model();
    m.snap();
    m.update(0, st({ crouched: true }), origin, 0);
    for (let i = 0; i < 10; i++) m.update(0.05, st({ crouched: true }), origin, 0);
    expect(bodyBox(m).max.y).toBeLessThan(1.35);
  });

  it('one box per carried package on its back; the deck only on the board', async () => {
    const m = await model();
    m.snap();
    m.update(0, st(), origin, 0);
    expect(m.packages.visible).toBe(false);
    m.setPackages(3);
    expect(m.packages.visible).toBe(true);
    expect(m.packages.count).toBe(3);
    m.setPackages(99);
    expect(m.packages.count).toBe(ordersConfig.backpack.maxSlots);
    // Behind the courier (+Z at heading 0), around its back.
    m.root.updateMatrixWorld(true);
    const p = new THREE.Box3().setFromObject(m.packages);
    expect(p.min.z).toBeGreaterThan(0);
    expect(p.min.y).toBeGreaterThan(0.4);
    m.setPackages(0);
    expect(m.packages.visible).toBe(false);

    expect(m.deck.visible).toBe(false);
    m.update(0.05, st({ onBoard: true }), origin, 10);
    expect(m.deck.visible).toBe(true);
  });

  it('hiding keeps every mesh in the shadow map', async () => {
    const m = await model();
    m.setPackages(2);
    m.setHidden(true);
    const all = meshesOf(m.root);
    expect(all.length).toBeGreaterThan(10);
    for (const mesh of all) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      expect(mesh.castShadow, mesh.name).toBe(true);
      expect(mats.every((x) => !x.colorWrite && !x.depthWrite), mesh.name).toBe(true);
    }
    m.setHidden(false);
    for (const mesh of all) expect((mesh.material as THREE.Material).colorWrite).toBe(true);
  });

  it('a failed load resolves to null with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await CourierModel.load('http://127.0.0.1:9/missing.glb', cfg)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });
});
