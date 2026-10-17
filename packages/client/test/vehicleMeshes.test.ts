import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createPhysicsWorld,
  defaultGarage,
  expandGreybox,
  Garage,
  initRapier,
  movementConfig,
  RIDE_TIERS,
  ridingConfig,
  type GreyboxSource,
  type MapData,
  type PhysicsWorld,
  type RideSpec,
} from '@dm/shared';
import greybox from '../../../map/greybox.json';
import { buildAccessZoneMeshes } from '../src/render/accessZoneMeshes';
import { buildGasStationMeshes } from '../src/render/gasStationMeshes';
import { buildVehicleMesh, CAR_MODEL_ID, carModel, paintVehicle } from '../src/render/vehicles/vehicleMeshes';
import { createCourierPlaceholder } from '../src/render/courierPlaceholder';
import { clientConfig } from '../src/clientConfig';
import type { Look } from '../src/render/cosmetics';
import { ModelLoader } from '../src/render/city/modelLoader';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CatalogEntry } from '@dm/shared';
import { VehicleViews } from '../src/render/vehicles/VehicleViews';

const map: MapData = expandGreybox(greybox as GreyboxSource);

/** Horizontal footprint of a ride's collider: [width (x), length (z)] in metres. */
function footprint(spec: RideSpec): [number, number] {
  const { shape, radius, halfLength } = spec.collider;
  return [2 * radius, shape === 'upright' ? 2 * radius : 2 * (halfLength + radius)];
}

/** Draw calls a subtree costs per frame: one per visible mesh, plus one more for each mesh drawn into the shadow map. */
function drawCallCost(root: THREE.Object3D): number {
  let calls = 0;
  root.traverseVisible((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const materials = Array.isArray(o.material) ? o.material.length : 1;
    calls += materials * (o.castShadow ? 2 : 1);
  });
  return calls;
}

const bounds = (o: THREE.Object3D): THREE.Box3 => {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o, true);
};

describe('buildVehicleMesh', () => {
  it('each vehicle mesh fits within its collider footprint ±10 % and stands on y = 0', () => {
    for (const tier of RIDE_TIERS) {
      const spec = ridingConfig.rides[tier];
      const b = bounds(buildVehicleMesh(tier, spec));
      const size = b.getSize(new THREE.Vector3());
      const [width, length] = footprint(spec);
      expect(b.min.y, tier).toBeCloseTo(0, 6);
      expect(size.x, tier).toBeLessThanOrEqual(width * 1.1);
      expect(size.z, tier).toBeLessThanOrEqual(length * 1.1);
      expect(size.z, tier).toBeGreaterThanOrEqual(length * 0.9);
      expect(size.y, tier).toBeLessThanOrEqual(spec.collider.height * 1.1);
      // Centred on the feet (the collider's axis).
      expect(Math.abs(b.min.x + b.max.x), tier).toBeLessThan(0.02);
      expect(Math.abs(b.min.z + b.max.z), tier).toBeLessThan(0.1 * length);
    }
  });

  it('one mesh per tier (one merged material set, vertex colours), casting shadows', () => {
    for (const tier of RIDE_TIERS) {
      const g = buildVehicleMesh(tier, ridingConfig.rides[tier]);
      const meshes: THREE.Mesh[] = [];
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes.push(o);
      });
      expect(meshes, tier).toHaveLength(1);
      expect(meshes[0]!.castShadow).toBe(true);
      expect((meshes[0]!.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);
      expect(meshes[0]!.geometry.getAttribute('color')).toBeDefined();
    }
  });

  it('the car is the longest and the skateboard the lowest', () => {
    const size = (t: (typeof RIDE_TIERS)[number]): THREE.Vector3 => bounds(buildVehicleMesh(t, ridingConfig.rides[t])).getSize(new THREE.Vector3());
    expect(size('car').z).toBeGreaterThan(size('motorbike').z);
    expect(size('skateboard').y).toBeLessThan(0.3);
  });
});

describe('gas stations and access zones', () => {
  it('a FUEL sign on each canopy and a glow on each pump point', () => {
    const g = buildGasStationMeshes(map);
    const signs = g.getObjectByName('fuel-signs') as THREE.InstancedMesh;
    const glows = g.getObjectByName('pump-glows') as THREE.InstancedMesh;
    expect(map.gasStations).toHaveLength(2);
    expect(signs.count).toBe(map.gasStations.length);
    const pumps = map.gasStations.flatMap((s) => s.pumps);
    expect(glows.count).toBe(pumps.length);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    map.gasStations.forEach((s, i) => {
      const canopy = map.solids.find((x) => x.id === `${s.id}-canopy`)!;
      signs.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(p.x).toBeCloseTo(canopy.center.x, 6);
      expect(p.z).toBeCloseTo(canopy.center.z, 6);
      expect(p.y).toBeCloseTo(canopy.center.y + canopy.size.y / 2, 6);
    });
    pumps.forEach((q, i) => {
      glows.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect([p.x, p.z]).toEqual([q.x, q.z]);
    });
    expect(() => buildGasStationMeshes({ ...map, gasStations: [] })).not.toThrow();
  });

  it('access zones: one translucent box per zone, coloured per kind, no shadows, hidden until the F3 overlay shows them', () => {
    const g = buildAccessZoneMeshes(map);
    const zones = g.getObjectByName('access-zones') as THREE.InstancedMesh;
    expect(g.visible).toBe(false);
    expect(zones.count).toBe(map.accessZones.length);
    const mat = zones.material as THREE.MeshBasicMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeLessThan(1);
    expect(mat.depthWrite).toBe(false);
    expect(zones.castShadow).toBe(false);
    const colorOf = (i: number): number => {
      const c = new THREE.Color();
      zones.getColorAt(i, c);
      return c.getHex();
    };
    const kinds = map.accessZones.map((z) => z.kind);
    const stairs = kinds.indexOf('stairs');
    const path = kinds.indexOf('path');
    expect(colorOf(stairs)).not.toBe(colorOf(path));
    expect(colorOf(path)).toBe(colorOf(kinds.lastIndexOf('path')));
  });

  it('the draw-call cost of four vehicles plus two stations is ≤ 24', () => {
    const scene = new THREE.Scene();
    for (const t of RIDE_TIERS) scene.add(buildVehicleMesh(t, ridingConfig.rides[t]));
    scene.add(buildGasStationMeshes(map));
    expect(map.gasStations).toHaveLength(2);
    expect(drawCallCost(scene)).toBeLessThanOrEqual(24);
  });
});

describe('VehicleViews', () => {
  let physics: PhysicsWorld;
  beforeAll(async () => {
    physics = createPhysicsWorld(await initRapier(), map);
  });

  const viewOf = (scene: THREE.Scene, t: string): THREE.Object3D => scene.getObjectByName(`vehicle-${t}`)!;

  it('one mesh per owned vehicle at its feet and heading; the carried skateboard is hidden', () => {
    const garage = new Garage(physics, map, defaultGarage(map));
    const scene = new THREE.Scene();
    const views = new VehicleViews(scene);
    views.update(garage, 1);
    for (const t of RIDE_TIERS) {
      const o = viewOf(scene, t);
      expect(o, t).toBeDefined();
      if (t === 'skateboard') {
        expect(o.visible).toBe(false);
        continue;
      }
      const s = garage.state(t);
      expect(o.visible, t).toBe(true);
      expect(o.position.x).toBeCloseTo(s.position.x, 6);
      expect(o.position.y).toBeCloseTo(s.position.y, 6);
      expect(o.position.z).toBeCloseTo(s.position.z, 6);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(o.quaternion);
      expect(fwd.x).toBeCloseTo(-Math.sin(s.heading), 6);
      expect(fwd.z).toBeCloseTo(-Math.cos(s.heading), 6);
    }
  });

  it('unowned vehicles are not drawn', () => {
    const garage = new Garage(physics, map, defaultGarage(map).filter((v) => v.tier === 'car'));
    const scene = new THREE.Scene();
    new VehicleViews(scene).update(garage, 1);
    expect(viewOf(scene, 'car').visible).toBe(true);
    expect(viewOf(scene, 'motorbike').visible).toBe(false);
  });

  it('interpolates between ticks, snaps across a teleport, and pitches to the ground normal', () => {
    const garage = new Garage(physics, map, defaultGarage(map));
    const scene = new THREE.Scene();
    const views = new VehicleViews(scene);
    views.update(garage, 1);
    const car = garage.state('car');
    const start = { ...car.position };
    views.beforeStep(garage);
    car.position = { x: start.x + 1, y: start.y, z: start.z };
    views.update(garage, 0.5);
    expect(viewOf(scene, 'car').position.x).toBeCloseTo(start.x + 0.5, 6);

    // A summon or tow moves the vehicle far in one go: snap() draws it there at once.
    views.beforeStep(garage);
    car.position = { x: start.x + 200, y: start.y, z: start.z };
    views.snap();
    views.update(garage, 0);
    expect(viewOf(scene, 'car').position.x).toBeCloseTo(start.x + 200, 6);

    const n = new THREE.Vector3(0, 1, 0.09).normalize();
    car.groundNormal = { x: n.x, y: n.y, z: n.z };
    views.update(garage, 1);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(viewOf(scene, 'car').quaternion);
    expect(up.distanceTo(n)).toBeLessThan(1e-6);
  });

  it('a spot change (mount, dismount, carry) draws the vehicle at its new place without a sweep', () => {
    const garage = new Garage(physics, map, defaultGarage(map));
    const scene = new THREE.Scene();
    const views = new VehicleViews(scene);
    views.update(garage, 1);
    views.beforeStep(garage);
    // As PlayerSim does on mount: place the carried skateboard at the feet and ride it.
    const feet = { x: 3, y: 0, z: 4 };
    garage.body('skateboard').place(feet, 0);
    garage.state('skateboard').position = feet;
    garage.ride('skateboard');
    views.update(garage, 0);
    const o = viewOf(scene, 'skateboard');
    expect(o.visible).toBe(true);
    expect([o.position.x, o.position.z]).toEqual([3, 4]);
  });
});

describe('the pack car (Decision 11)', () => {
  // The catalog's mega/Car_01: 1.97 × 1.38 × 3.28 m, its front (the FL/FR wheels) on +z.
  const car: CatalogEntry = {
    id: CAR_MODEL_ID, file: 'megatropolis vehicles/Car_01.glb', category: 'vehicle', size: { w: 1.97, h: 1.38, d: 3.28 },
    pivot: { x: 0.2, z: 0.01, minY: -0.1 }, use: 'placed',
  };
  /** A loader serving a car-sized box (front half marked by a +z offset) or 404s when `serve` is false. */
  const loaderFor = (serve: boolean): ModelLoader => {
    const gltf = {
      loadAsync: async () => {
        if (!serve) throw new Error('HTTP 404');
        const g = new THREE.BoxGeometry(1.97, 1.38, 3.28).translate(0.2, 0.59, 0.01);
        return { scene: new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: 'flat' })) };
      },
    } as unknown as GLTFLoader;
    return new ModelLoader('packs/', gltf);
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('carModel: null until loaded and when missing; then the model scaled to the collider, its pivot on the feet, its front on −z', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const missing = loaderFor(false);
    missing.request(CAR_MODEL_ID);
    expect(carModel(missing, car)).toBeNull();
    await flush();
    expect(carModel(missing, car)).toBeNull();
    warn.mockRestore();

    const ok = loaderFor(true);
    ok.request(CAR_MODEL_ID);
    await flush();
    const o = carModel(ok, car)!;
    expect(o).not.toBeNull();
    o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 5);
    // Scaled to the 4.4 m collider (Decision 13), turned half round: its length along z
    const k = 4.4 / 3.28;
    expect(box.max.z - box.min.z).toBeCloseTo(4.4, 5);
    expect(box.max.x - box.min.x).toBeCloseTo(1.97 * k, 5);
    let mesh: THREE.Mesh | null = null;
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) mesh = c as THREE.Mesh;
    });
    expect(mesh!.castShadow).toBe(true);
    // the model's +z front faces the vehicles' forward (−z)
    const front = new THREE.Vector3(0, 0, 1).transformDirection(mesh!.matrixWorld);
    expect(front.z).toBeCloseTo(-1, 6);
  });

  it('VehicleViews swaps the car placeholder for the model once it loads, and keeps it when missing', async () => {
    const physics = createPhysicsWorld(await initRapier(), map);
    const garage = new Garage(physics, map, defaultGarage(map));
    for (const [serve, model] of [[true, true], [false, false]] as const) {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const scene = new THREE.Scene();
      const views = new VehicleViews(scene, { loader: loaderFor(serve), car });
      views.update(garage, 1);
      await flush();
      views.update(garage, 1);
      const root = scene.getObjectByName('vehicle-car')!;
      expect(root.getObjectByName('vehicle-car-mesh') === undefined, `serve ${serve}`).toBe(model);
      expect(root.getObjectByName('vehicle-car-model') !== undefined).toBe(model);
      warn.mockRestore();
    }
  });
});


describe('vehicle paint (Decision 4)', () => {
  const meshOf = (root: THREE.Object3D): THREE.Mesh => {
    let mesh: THREE.Mesh | null = null;
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) mesh ??= o as THREE.Mesh;
    });
    return mesh!;
  };
  const colours = (m: THREE.Mesh, start: number, count: number): number[] =>
    Array.from((m.geometry.getAttribute('color').array as Float32Array).slice(start * 3, (start + count) * 3));
  const look = (vehicle: Look['vehicle']): Look => ({ outfit: { color: 0x1f9e93 }, vehicle, bag: 0xd8b98a, phone: 0x10262d });

  it('vehicle paint recolours body parts and leaves wheels and the rider untouched', async () => {
    for (const tier of RIDE_TIERS) {
      const root = buildVehicleMesh(tier, ridingConfig.rides[tier]);
      const mesh = meshOf(root);
      const [fixed, body] = mesh.geometry.groups;
      expect(mesh.geometry.groups, tier).toHaveLength(2);
      expect(body!.count, tier).toBeGreaterThan(0);
      const wheels = colours(mesh, fixed!.start, fixed!.count);
      const factory = colours(mesh, body!.start, body!.count);
      const base = mesh.material;

      paintVehicle(root, { color: 0xc8323c });
      const red = new THREE.Color(0xc8323c).toArray();
      const painted = colours(mesh, body!.start, body!.count);
      for (let i = 0; i < painted.length; i++) expect(painted[i], tier).toBeCloseTo(red[i % 3]!, 6);
      expect(colours(mesh, fixed!.start, fixed!.count), tier).toEqual(wheels);
      // A colour is still one material (one draw call): only the body's vertex colours change.
      expect(mesh.material, tier).toBe(base);

      paintVehicle(root, { finish: 'chrome' });
      const mats = mesh.material as THREE.Material[];
      expect(mats, tier).toHaveLength(2);
      expect(mats[0], tier).toBe(base);
      const chrome = mats[1] as THREE.MeshStandardMaterial;
      expect([chrome.color.getHex(), chrome.metalness, chrome.roughness], tier).toEqual([0xdfe3e8, 1, 0.1]);
      expect(colours(mesh, fixed!.start, fixed!.count), tier).toEqual(wheels);

      // The factory paint brings each ride's own SP5 colours back.
      paintVehicle(root, { color: null });
      expect(mesh.material, tier).toBe(base);
      expect(colours(mesh, body!.start, body!.count), tier).toEqual(factory);
    }

    // VehicleViews paints every ride with the look's vehicle paint; the rider wears the look's outfit, not the paint.
    const physics = createPhysicsWorld(await initRapier(), map);
    const garage = new Garage(physics, map, defaultGarage(map));
    const scene = new THREE.Scene();
    const rider = createCourierPlaceholder(movementConfig.capsule, clientConfig.courier);
    scene.add(rider.root);
    const views = new VehicleViews(scene);
    views.update(garage, 1);
    const gold = { ...look({ finish: 'gold' }), outfit: { color: 0x7d4e9e } };
    const capsule = meshOf(rider.root).material as THREE.MeshLambertMaterial;
    const unpainted = [capsule.color.getHex(), capsule.emissive.getHex()];
    views.applyLook(gold);
    // Painting the rides leaves the rider alone: the capsule changes only with its own applyLook.
    expect([capsule.color.getHex(), capsule.emissive.getHex()]).toEqual(unpainted);
    expect(unpainted[0]).not.toBe(0xd4a017);
    rider.applyLook(gold);
    const finishes = RIDE_TIERS.map((t) => (meshOf(views.root(t)).material as THREE.MeshStandardMaterial[])[1]!);
    for (const [k, t] of RIDE_TIERS.entries()) expect(finishes[k]!.color.getHex(), t).toBe(0xd4a017);
    expect([capsule.color.getHex(), capsule.emissive.getHex()]).toEqual([0x7d4e9e, 0]);
    // The same look again (and a colour and back) keeps the same material objects: no shader program is dropped.
    views.applyLook(gold);
    views.applyLook(look({ color: 0x2f6fb5 }));
    views.applyLook(gold);
    for (const [k, t] of RIDE_TIERS.entries()) expect((meshOf(views.root(t)).material as THREE.Material[])[1], t).toBe(finishes[k]);
  });

  const packCar: CatalogEntry = {
    id: CAR_MODEL_ID, file: 'megatropolis vehicles/Car_01.glb', category: 'vehicle', size: { w: 1.97, h: 1.38, d: 3.28 },
    pivot: { x: 0, z: 0, minY: 0 }, use: 'placed',
  };
  /** VehicleViews with the pack car served from `scene` (the loader's extract runs on it) and swapped in. */
  async function packViews(gltfScene: () => THREE.Object3D, before?: Look) {
    const gltf = { loadAsync: async () => ({ scene: gltfScene() }) } as unknown as GLTFLoader;
    const loader = new ModelLoader('packs/', gltf, { loadTexture: () => new THREE.Texture() });
    const physics = createPhysicsWorld(await initRapier(), map);
    const garage = new Garage(physics, map, defaultGarage(map));
    const scene = new THREE.Scene();
    const views = new VehicleViews(scene, { loader, car: packCar });
    if (before) views.applyLook(before);
    views.update(garage, 1);
    await new Promise((r) => setTimeout(r, 0));
    views.update(garage, 1);
    const model = scene.getObjectByName('vehicle-car-model')!;
    const shared = (loader.get(CAR_MODEL_ID) as unknown as { material: THREE.Material | THREE.Material[] }).material;
    return { views, model, mesh: meshOf(model), shared };
  }
  const box = (): THREE.BufferGeometry => new THREE.BoxGeometry(1.97, 1.38, 3.28).translate(0, 0.69, 0);

  it("the pack car's paint material is tinted on a copy; the city's cars keep the shared one", async () => {
    // Painted before the model arrives: the swap paints it too.
    const { views, model, mesh, shared } = await packViews(() => new THREE.Mesh(box(), new THREE.MeshStandardMaterial({ name: 'flat' })), look({ color: 0x2f6fb5 }));
    const flat = shared as THREE.MeshLambertMaterial;
    expect(mesh.material).not.toBe(flat);
    const blue = mesh.material as THREE.MeshLambertMaterial;
    expect(blue.color.getHex()).toBe(0x2f6fb5);
    expect(flat.color.getHex()).toBe(0xffffff);
    // Another colour repaints the same copy in place; the same look again changes nothing.
    views.applyLook(look({ color: 0xc8323c }));
    views.applyLook(look({ color: 0xc8323c }));
    expect(mesh.material).toBe(blue);
    expect(blue.color.getHex()).toBe(0xc8323c);
    views.applyLook(look({ finish: 'neon' }));
    const neon = mesh.material as THREE.MeshStandardMaterial;
    expect([neon.color.getHex(), neon.emissive.getHex()]).toEqual([0x39ff14, 0x39ff14]);
    views.applyLook(look({ finish: 'gold' }));
    expect(mesh.material).toBe(neon);
    expect([neon.color.getHex(), neon.emissive.getHex(), neon.metalness]).toEqual([0xd4a017, 0, 1]);
    views.applyLook(look({ color: null }));
    expect(mesh.material).toBe(flat);
    views.applyLook(look({ finish: 'gold' }));
    expect(mesh.material).toBe(neon);
    model.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).z).toBeCloseTo(4.4, 5);
  });

  it('a pack car with glass in its own material paints the body (the largest group) only', async () => {
    const { views, mesh, shared } = await packViews(() => {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(box(), new THREE.MeshStandardMaterial({ name: 'body' })));
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ name: 'glass' })));
      return scene;
    });
    const list = shared as THREE.Material[];
    expect(list.map((m) => m.name)).toEqual(['body', 'glass']);
    views.applyLook(look({ color: 0xc8323c }));
    const mats = mesh.material as THREE.MeshLambertMaterial[];
    expect(mats).toHaveLength(2);
    expect(mats[1]).toBe(list[1]);
    expect(mats[0]).not.toBe(list[0]);
    expect([mats[0]!.name, mats[0]!.color.getHex()]).toEqual(['body', 0xc8323c]);
    expect((list[0] as THREE.MeshLambertMaterial).color.getHex()).toBe(0xffffff);
  });

  it('a folded pack car (texture plus flat glass) keeps the folded shader on its painted copy', async () => {
    const { views, mesh, shared } = await packViews(() => {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(box(), new THREE.MeshStandardMaterial({ name: 'tex:atlas.png' })));
      const glass = new THREE.PlaneGeometry(1, 0.5).translate(0, 1.2, 0);
      glass.setAttribute('color', new THREE.BufferAttribute(new Float32Array(glass.getAttribute('position').count * 3).fill(0.5), 3));
      scene.add(new THREE.Mesh(glass, new THREE.MeshStandardMaterial({ name: 'flat' })));
      return scene;
    });
    const folded = shared as THREE.MeshLambertMaterial;
    expect(folded.name).toBe('tex:atlas.png+flat');
    views.applyLook(look({ finish: 'chrome' }));
    const chrome = mesh.material as THREE.MeshStandardMaterial;
    expect(chrome).not.toBe(folded);
    expect([chrome.name, chrome.map, chrome.vertexColors]).toEqual([folded.name, folded.map, true]);
    expect(chrome.customProgramCacheKey()).toBe('dm-folded-flat');
    // The folded fragment: the material colour tints the textured texels only, the flat parts keep their own.
    const shader = { fragmentShader: '#include <map_fragment>', vertexShader: '', uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    chrome.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('mix( diffuseColor * texture2D( map, vMapUv ), vec4( 1.0, 1.0, 1.0, diffuseColor.a ), vColor.a )');
    expect(chrome.color.getHex()).toBe(0xdfe3e8);
    expect(folded.color.getHex()).toBe(0xffffff);
  });
});
