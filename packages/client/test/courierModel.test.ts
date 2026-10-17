import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { vehiclesConfig, type MoveMode, type PlayerState, type Vec3 } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';
import { riderLift } from '../src/render/vehicles/vehicleMeshes';
import { CourierModel } from '../src/render/courier/CourierModel';

const cfg = clientConfig.courier;
const glb = readFileSync(new URL('../../../assets/models/RobotExpressive.glb', import.meta.url));

async function model(): Promise<CourierModel> {
  const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  return new CourierModel(await new GLTFLoader().parseAsync(ab, ''), cfg);
}

function st(over: Partial<{ mode: MoveMode; heading: number; crouched: boolean; vy: number; v: Vec3 }> = {}): PlayerState {
  return {
    mode: over.mode ?? 'ground',
    heading: over.heading ?? 0,
    crouched: over.crouched ?? false,
    velocity: over.v ?? { x: 0, y: over.vy ?? 0, z: 0 },
  } as unknown as PlayerState;
}

const origin = { x: 0, y: 0, z: 0 };

/** World box of the courier's visible meshes (skinning applied), packages excluded. */
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it('faces its travel in a slide, not the input (R14)', async () => {
    const m = await model();
    m.snap();
    m.update(0, st({ mode: 'slide', crouched: true, heading: Math.PI / 2, v: { x: -8, y: 0, z: 0 } }), origin, 8);
    expect(m.root.rotation.y).toBeCloseTo(Math.PI / 2, 6); // −X is yaw π/2
    m.snap();
    m.update(0, st({ mode: 'slide', crouched: true, heading: 0.3, v: { x: 0, y: 0, z: 8 } }), origin, 8);
    expect(Math.abs(m.root.rotation.y)).toBeCloseTo(Math.PI, 6);
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

  it('poses change the figure: slide lowers it, mantle reaches the arms forward', async () => {
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
    const hand = (): THREE.Vector3 => m.bone('Palm2L').getWorldPosition(new THREE.Vector3());
    settle(st({ mode: 'air', vy: 0 }), 0);
    const airHand = hand();
    settle(st({ mode: 'mantle' }), 2);
    // Same Jump clip under both; the mantle pose swings the arms forward (−Z at heading 0).
    expect(hand().z).toBeLessThan(airHand.z - 0.1);
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

  /** Every pose (and plain locomotion) after it has fully blended in. */
  const POSED: [string, Parameters<typeof st>[0], number][] = [
    ['idle', {}, 0],
    ['run', {}, 8],
    ['slide', { mode: 'slide', crouched: true }, 9],
    ['mantle', { mode: 'mantle' }, 2],
    ['fall', { mode: 'air', vy: -6 }, 6],
    ['crouch', { crouched: true }, 0],
    ['crouch-walk', { crouched: true }, 2.5],
  ];

  /** Settles `m` into a state, sampling the figure over `frames` frames of the clip. */
  const boxesOver = (m: CourierModel, s: PlayerState, speed: number, frames = 24): THREE.Box3[] => {
    m.snap();
    m.update(0, s, origin, speed);
    const out: THREE.Box3[] = [];
    for (let i = 0; i < frames; i++) {
      m.update(0.05, s, origin, speed);
      out.push(bodyBox(m));
    }
    return out;
  };

  it.each(POSED)('%s: no part of the figure goes below the surface it stands on', async (_label, over, speed) => {
    const m = await model();
    const low = Math.min(...boxesOver(m, st(over), speed).map((b) => b.min.y));
    expect(low).toBeGreaterThanOrEqual(-0.03);
  });

  it('poses do not accumulate frame over frame', async () => {
    const m = await model();
    const s = st({ mode: 'slide', crouched: true });
    m.snap();
    m.update(0, s, origin, 9);
    const a = bodyBox(m);
    for (let i = 0; i < 30; i++) m.update(1 / 60, s, origin, 9);
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

  it('one box per carried package on its back', async () => {
    const m = await model();
    m.snap();
    m.update(0, st(), origin, 0);
    expect(m.packages.visible).toBe(false);
    m.setPackages(3);
    expect(m.packages.visible).toBe(true);
    expect(m.packages.count).toBe(3);
    m.setPackages(99);
    expect(m.packages.count).toBe(vehiclesConfig.car.slotCap);
    // Behind the courier (+Z at heading 0), around its back.
    m.root.updateMatrixWorld(true);
    const p = new THREE.Box3().setFromObject(m.packages);
    expect(p.min.z).toBeGreaterThan(0);
    expect(p.min.y).toBeGreaterThan(0.4);
    m.setPackages(0);
    expect(m.packages.visible).toBe(false);
  });

  it('riding: hidden inside the car; on the skateboard it stands on the deck', async () => {
    const m = await model();
    const ride = (t: string): PlayerState => ({ ...st(), riding: t }) as unknown as PlayerState;
    m.snap();
    m.update(1 / 60, st(), origin, 0);
    const onFoot = bodyBox(m).min.y;
    m.snap();
    m.update(1 / 60, ride('car'), origin, 10);
    expect(m.root.visible).toBe(false);
    m.snap();
    m.update(1 / 60, ride('skateboard'), origin, 5);
    expect(m.root.visible).toBe(true);
    expect(m.debug().pose).toBe('board');
    expect(bodyBox(m).min.y).toBeGreaterThan(onFoot + riderLift('skateboard') * 0.8);
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

  it.each([
    ['a 404', () => new Response('not found', { status: 404 })],
    ['a corrupt file', () => new Response('this is not a glb', { status: 200 })],
  ])('a failed load (%s) resolves to null with one warning', async (_label, respond) => {
    vi.stubGlobal('fetch', vi.fn(async () => respond()));
    // Node has no ProgressEvent; FileLoader reports download progress with one.
    vi.stubGlobal('ProgressEvent', class extends Event {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await CourierModel.load('https://example.test/RobotExpressive.glb', cfg)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });
});
