import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createPhysicsWorld,
  defaultGarage,
  expandGreybox,
  Garage,
  initRapier,
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
import { buildVehicleMesh } from '../src/render/vehicles/vehicleMeshes';
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
