import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapData, Solid, Vec3 } from '@dm/shared';
import { palette } from './palette';

export interface FeatureMeshes {
  group: THREE.Group;
  setOrbVisible(id: string, visible: boolean): void;
  isOrbVisible(id: string): boolean;
  update(timeSeconds: number): void;
}

// Art dimensions (metres). Visual only; collision and trigger sizes come from the map and movement config.
const CABLE_RADIUS = 0.04;
const POST_RADIUS = 0.14;
const RAIL_RADIUS = 0.07;
const RAIL_POST_SPACING = 4;
const ORB_RADIUS = 0.45;
const HALO_RADIUS = 0.8;
const BOB_HEIGHT = 0.15;
const BOB_SPEED = 2;
const SPIN_SPEED = 1.5;
const STRIPE_SPACING = 1.2;
const STRIPE_WIDTH = 0.5;

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const v3 = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);

function paint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** A thin cylinder from a to b. */
function tube(a: Vec3, b: Vec3, radius: number, color: number): THREE.BufferGeometry {
  const from = v3(a);
  const to = v3(b);
  const dir = to.clone().sub(from);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(radius, radius, len, 8, 1);
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      from.clone().add(to).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize()),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  return paint(g, color);
}

/** A vertical post from the ground (y = 0) to `top`, capped with a small block. */
function post(top: Vec3, radius: number, color: number, capColor: number): THREE.BufferGeometry[] {
  const h = Math.max(0.1, top.y);
  const shaft = new THREE.CylinderGeometry(radius, radius * 1.15, h, 8, 1);
  shaft.translate(top.x, h / 2, top.z);
  const cap = new THREE.BoxGeometry(radius * 3, radius * 2, radius * 3);
  cap.translate(top.x, top.y, top.z);
  return [paint(shaft, color), paint(cap, capColor)];
}

/** Flat disc with a ring and an arrow along the horizontal part of the launch. */
function padGeometry(p: { position: Vec3; radius: number; launch: Vec3 }): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const disc = new THREE.CylinderGeometry(p.radius, p.radius, 0.12, 24, 1);
  disc.translate(p.position.x, p.position.y + 0.06, p.position.z);
  out.push(paint(disc, palette.padDisc));
  const ring = new THREE.RingGeometry(p.radius * 0.8, p.radius * 0.92, 32);
  ring.rotateX(-Math.PI / 2);
  ring.translate(p.position.x, p.position.y + 0.14, p.position.z);
  out.push(paint(ring, palette.padRing));
  const dx = p.launch.x;
  const dz = p.launch.z;
  if (Math.hypot(dx, dz) > 1e-6) {
    const r = p.radius * 0.6;
    const shape = new THREE.Shape();
    shape.moveTo(0, r); // tip
    shape.lineTo(r * 0.7, r * 0.1);
    shape.lineTo(r * 0.25, r * 0.1);
    shape.lineTo(r * 0.25, -r);
    shape.lineTo(-r * 0.25, -r);
    shape.lineTo(-r * 0.25, r * 0.1);
    shape.lineTo(-r * 0.7, r * 0.1);
    shape.closePath();
    const arrow = new THREE.ShapeGeometry(shape);
    arrow.rotateX(-Math.PI / 2); // shape +Y → world -Z
    arrow.rotateY(Math.atan2(-dx, -dz)); // -Z → launch direction
    arrow.translate(p.position.x, p.position.y + 0.16, p.position.z);
    out.push(paint(arrow, palette.padArrow));
  }
  return out;
}

/** Light stripes across a chute's top surface, so it reads as a slide. */
function chuteStripes(s: Solid): THREE.BufferGeometry[] {
  const r = s.rotationDeg;
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(r?.x ?? 0),
      THREE.MathUtils.degToRad(r?.y ?? 0),
      THREE.MathUtils.degToRad(r?.z ?? 0),
      'XYZ',
    ),
  );
  const out: THREE.BufferGeometry[] = [];
  // Stripes run across the slab's long local axis (the longer of x and z).
  const alongX = s.size.x >= s.size.z;
  const length = alongX ? s.size.x : s.size.z;
  const width = alongX ? s.size.z : s.size.x;
  const count = Math.max(1, Math.floor(length / STRIPE_SPACING));
  for (let i = 0; i < count; i++) {
    const t = -length / 2 + (i + 0.5) * (length / count);
    const g = alongX
      ? new THREE.BoxGeometry(STRIPE_WIDTH, 0.04, width)
      : new THREE.BoxGeometry(width, 0.04, STRIPE_WIDTH);
    g.translate(alongX ? t : 0, s.size.y / 2 + 0.02, alongX ? 0 : t);
    g.applyMatrix4(new THREE.Matrix4().compose(v3(s.center), q, new THREE.Vector3(1, 1, 1)));
    out.push(paint(g, palette.chuteStripe));
  }
  return out;
}

/**
 * Visuals for the movement features: zip lines (cable and end posts), rails (tubes on posts), jump pads
 * (disc, ring and launch arrow), chute stripes and boost orbs. All static parts merge into one mesh (one draw
 * call); the orbs are one InstancedMesh (plus one for their halos), hidden by a zero-scale matrix.
 */
export function buildFeatureMeshes(map: MapData): FeatureMeshes {
  const group = new THREE.Group();
  group.name = 'features';

  const parts: THREE.BufferGeometry[] = [];
  for (const z of map.zipLines) {
    parts.push(tube(z.a, z.b, CABLE_RADIUS, palette.cable));
    parts.push(...post(z.a, POST_RADIUS, palette.post, palette.coral));
    parts.push(...post(z.b, POST_RADIUS, palette.post, palette.coral));
  }
  for (const r of map.rails) {
    const pts = r.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      parts.push(tube(a, b, RAIL_RADIUS, palette.rail));
      const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / RAIL_POST_SPACING));
      for (let k = 0; k <= n; k++) {
        if (k === 0 && i > 0) continue; // shared with the previous segment's end
        const f = k / n;
        const top = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f - RAIL_RADIUS, z: a.z + (b.z - a.z) * f };
        parts.push(...post(top, RAIL_RADIUS * 0.8, palette.post, palette.post));
      }
    }
  }
  for (const p of map.jumpPads) parts.push(...padGeometry(p));
  for (const s of map.solids) if (s.kind === 'chute') parts.push(...chuteStripes(s));

  if (parts.length > 0) {
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (merged) {
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.name = 'features-static';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }

  // Boost orbs.
  const orbs = map.boostOrbs;
  const indexById = new Map<string, number>();
  orbs.forEach((o, i) => indexById.set(o.id, i));
  const visible = orbs.map(() => true);
  const coreGeo = new THREE.IcosahedronGeometry(ORB_RADIUS, 1);
  const core = new THREE.InstancedMesh(
    coreGeo,
    new THREE.MeshLambertMaterial({ color: palette.orb, emissive: palette.orb, emissiveIntensity: 0.9 }),
    Math.max(1, orbs.length),
  );
  const halo = new THREE.InstancedMesh(
    new THREE.SphereGeometry(HALO_RADIUS, 16, 12),
    new THREE.MeshBasicMaterial({ color: palette.orb, transparent: true, opacity: 0.22, depthWrite: false }),
    Math.max(1, orbs.length),
  );
  core.name = 'orbs';
  halo.name = 'orb-halos';
  core.count = halo.count = orbs.length;
  core.frustumCulled = halo.frustumCulled = false;
  core.castShadow = false;
  halo.castShadow = false;
  if (orbs.length > 0) group.add(core, halo);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const zero = new THREE.Vector3(0, 0, 0);
  const pos = new THREE.Vector3();
  const writeOrbs = (t: number): void => {
    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i]!;
      if (visible[i]) {
        pos.set(o.position.x, o.position.y + Math.sin(t * BOB_SPEED + i) * BOB_HEIGHT, o.position.z);
        q.setFromAxisAngle(Y_AXIS, t * SPIN_SPEED + i);
        m.compose(pos, q, one);
        core.setMatrixAt(i, m);
        const pulse = 1 + 0.08 * Math.sin(t * 3 + i);
        m.compose(pos, q, one.clone().multiplyScalar(pulse));
        halo.setMatrixAt(i, m);
      } else {
        m.compose(pos.set(o.position.x, o.position.y, o.position.z), q.identity(), zero);
        core.setMatrixAt(i, m);
        halo.setMatrixAt(i, m);
      }
    }
    core.instanceMatrix.needsUpdate = true;
    halo.instanceMatrix.needsUpdate = true;
  };
  writeOrbs(0);

  return {
    group,
    setOrbVisible(id, v) {
      const i = indexById.get(id);
      if (i !== undefined) visible[i] = v;
    },
    isOrbVisible(id) {
      const i = indexById.get(id);
      return i !== undefined && visible[i] === true;
    },
    update: writeOrbs,
  };
}
