import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MATERIAL_FOLDED_SUFFIX, ridingConfig, type CatalogEntry, type RideSpec, type RideTier } from '@dm/shared';
import { carModelScale, finishMaterial, paintMaterial, surfaceOf, type Paint } from '../cosmetics';
import { foldFlatShader, type ModelLoader } from '../city/modelLoader';
import { placeModel } from '../city/placement';
import { palette } from '../palette';

/**
 * Code-built vehicle placeholders (plan Decision 7: no pack art in SP4). Each is one mesh of boxes and cylinders with
 * vertex colours (one draw call, plus its shadow), sized from the ride's collider: as wide as the capsule
 * (2 × radius), as long as it (2 × radius upright, 2 × (halfLength + radius) lengthwise), standing on y = 0 at the
 * feet and facing −Z (heading 0). Art proportions below are shares of those sizes.
 */

/** Gives every vertex of `g` one colour (non-indexed, no UVs) so parts with different colours merge into one mesh. */
export function paint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const flat = g.index ? g.toNonIndexed() : g;
  const count = flat.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) c.toArray(colors, i * 3);
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  flat.deleteAttribute('uv');
  return flat;
}

/**
 * Collects painted parts and merges them. Parts in the ride's body colour are its paintable body: they go last, as
 * the merged geometry's second group (paintVehicle).
 */
class Parts {
  private readonly fixed: THREE.BufferGeometry[] = [];
  private readonly body: THREE.BufferGeometry[] = [];

  constructor(private readonly bodyColor: number) {}

  private add(g: THREE.BufferGeometry, color: number): void {
    (color === this.bodyColor ? this.body : this.fixed).push(paint(g, color));
  }

  /** A box of size (w, h, l) centred at (x, y, z). */
  box(w: number, h: number, l: number, x: number, y: number, z: number, color: number): this {
    this.add(new THREE.BoxGeometry(w, h, l).translate(x, y, z), color);
    return this;
  }

  /** A wheel (cylinder with its axle along X) of radius `r` and width `w`, centred at (x, r, z) so it stands on y = 0. */
  wheel(r: number, w: number, x: number, z: number, color: number): this {
    this.add(new THREE.CylinderGeometry(r, r, w, WHEEL_SEGMENTS).rotateZ(Math.PI / 2).translate(x, r, z), color);
    return this;
  }

  /** A bar from a to b (a thin box along the segment), `t` thick. */
  bar(a: THREE.Vector3, b: THREE.Vector3, t: number, color: number): this {
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(t, len, t);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(q);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.add(g.translate(mid.x, mid.y, mid.z), color);
    return this;
  }

  /** One geometry: group 0 the fixed parts (wheels, trim, seat, glass, lights), group 1 the body. */
  merge(): THREE.BufferGeometry {
    const all = [...this.fixed, ...this.body];
    const merged = mergeGeometries(all, false);
    const fixed = this.fixed.reduce((n, g) => n + g.getAttribute('position').count, 0);
    merged.addGroup(0, fixed, 0);
    merged.addGroup(fixed, merged.getAttribute('position').count - fixed, 1);
    all.forEach((g) => g.dispose());
    return merged;
  }
}

const WHEEL_SEGMENTS = 12;
const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Collider footprint: width (x) and length (z). */
function footprint(spec: RideSpec): { w: number; l: number } {
  const { shape, radius, halfLength } = spec.collider;
  return { w: 2 * radius, l: shape === 'upright' ? 2 * radius : 2 * (halfLength + radius) };
}

/** Skateboard proportions (shares of the deck length). */
const BOARD = { wheelR: 0.05, wheelW: 0.06, deckW: 0.3, deckT: 0.04, truckInset: 0.18 };

/** Height of the skateboard deck top above the feet (the courier stands on it). */
function deckTop(l: number): number {
  return 2 * BOARD.wheelR * l + BOARD.deckT * l;
}

/** A deck on four wheels, as long as the collider is wide. */
function skateboard(p: Parts, l: number): void {
  const wr = BOARD.wheelR * l;
  const ww = BOARD.wheelW * l;
  const dw = BOARD.deckW * l;
  const dt = BOARD.deckT * l;
  p.box(dw, dt, l, 0, 2 * wr + dt / 2, 0, palette.skateDeck);
  for (const z of [-1, 1]) {
    const tz = z * (l / 2 - BOARD.truckInset * l);
    p.box(dw - ww, wr * 0.6, wr * 1.2, 0, wr + wr * 0.3, tz, palette.trim);
    for (const x of [-1, 1]) p.wheel(wr, ww, x * (dw / 2 - ww / 2), tz, palette.wheel);
  }
}

/** Bicycle proportions (shares of the collider length). */
const BIKE = { wheelR: 0.23, tyreW: 0.06, tube: 0.045, seatY: 0.75, barY: 0.95, barW: 0.7 };

/** A diamond frame on two wheels filling the collider's length; handlebars at the front (−Z). */
function bicycle(p: Parts, w: number, l: number): void {
  const r = BIKE.wheelR * l;
  const t = BIKE.tube * l;
  const front = -(l / 2 - r);
  const rear = l / 2 - r;
  const seat = v(0, BIKE.seatY * l, rear * 0.35);
  const head = v(0, BIKE.seatY * l, front * 0.7);
  const crank = v(0, r * 0.9, 0);
  p.wheel(r, BIKE.tyreW * l, 0, front, palette.tyre).wheel(r, BIKE.tyreW * l, 0, rear, palette.tyre);
  p.bar(v(0, r, rear), seat, t, palette.bicycleFrame)
    .bar(v(0, r, rear), crank, t, palette.bicycleFrame)
    .bar(crank, seat, t, palette.bicycleFrame)
    .bar(crank, head, t, palette.bicycleFrame)
    .bar(seat, head, t, palette.bicycleFrame)
    .bar(head, v(0, r, front), t, palette.trim)
    .bar(head, v(0, BIKE.barY * l, front * 0.75), t, palette.trim);
  p.box(Math.min(w, BIKE.barW * l), t, t, 0, BIKE.barY * l, front * 0.75, palette.trim);
  p.box(t * 2.4, t * 1.2, t * 4, 0, seat.y + t, seat.z, palette.seat);
}

/** Motorbike proportions (shares of the collider height, i.e. its diameter). */
const MOTO = { wheelR: 0.3, tyreW: 0.16, bodyW: 0.36, bodyY: 0.55, bodyH: 0.3, seatY: 0.75, barY: 0.95, barW: 0.75 };

/** A body, tank and seat over two wheels filling the collider's length; handlebars at the front. */
function motorbike(p: Parts, w: number, l: number, h: number): void {
  const r = MOTO.wheelR * h;
  const front = -(l / 2 - r);
  const rear = l / 2 - r;
  const bw = MOTO.bodyW * h;
  p.wheel(r, MOTO.tyreW * h, 0, front, palette.tyre).wheel(r, MOTO.tyreW * h, 0, rear, palette.tyre);
  // Hubs.
  p.wheel(r * 0.45, MOTO.tyreW * h * 1.2, 0, front, palette.trim).wheel(r * 0.45, MOTO.tyreW * h * 1.2, 0, rear, palette.trim);
  p.box(bw, MOTO.bodyH * h, rear - front - r, 0, MOTO.bodyY * h, (front + rear) / 2, palette.motorbikeBody);
  p.box(bw * 1.15, MOTO.bodyH * h * 0.8, l * 0.2, 0, MOTO.bodyY * h + MOTO.bodyH * h * 0.55, front * 0.35, palette.motorbikeBody);
  p.box(bw * 0.9, 0.1 * h, l * 0.3, 0, MOTO.seatY * h, rear * 0.35, palette.seat);
  p.box(bw * 1.1, 0.1 * h, r * 1.2, 0, 2 * r + 0.02 * h, rear, palette.motorbikeBody);
  const head = v(0, MOTO.barY * h - 0.05 * h, front * 0.8);
  p.bar(v(0, r, front), head, 0.06 * h, palette.trim);
  p.box(Math.min(w, MOTO.barW * h), 0.05 * h, 0.05 * h, 0, MOTO.barY * h, front * 0.8, palette.trim);
  p.box(0.14 * h, 0.12 * h, 0.06 * h, 0, MOTO.barY * h - 0.12 * h, front * 0.8 - 0.06 * h, palette.headlight);
}

/** Car proportions (shares of the collider width and height). */
const CAR = { wheelR: 0.17, tyreW: 0.11, wheelInset: 0.38, bodyY0: 0.16, bodyY1: 0.5, cabinY1: 0.78, cabinW: 0.86, cabinL: 0.5, roofT: 0.03 };

/** A body and a glass cabin with a cream roof over four wheels; headlights at the front (−Z), tail lights behind. */
function car(p: Parts, w: number, l: number, h: number): void {
  const r = CAR.wheelR * h;
  const tw = CAR.tyreW * w;
  const wz = l / 2 - CAR.wheelInset * w;
  for (const x of [-1, 1]) for (const z of [-1, 1]) p.wheel(r, tw, x * (w / 2 - tw / 2), z * wz, palette.tyre);
  const y0 = CAR.bodyY0 * h;
  const y1 = CAR.bodyY1 * h;
  p.box(w - 2 * tw * 0.1, y1 - y0, l, 0, (y0 + y1) / 2, 0, palette.carBody);
  const cy1 = CAR.cabinY1 * h;
  const cl = CAR.cabinL * l;
  const cz = l * 0.06;
  p.box(CAR.cabinW * w, cy1 - y1, cl, 0, (y1 + cy1) / 2, cz, palette.glass);
  p.box(CAR.cabinW * w + 0.02, CAR.roofT * h, cl + 0.02, 0, cy1 + (CAR.roofT * h) / 2, cz, palette.carRoof);
  const lightY = y1 - 0.08 * h;
  for (const x of [-1, 1]) {
    p.box(0.18 * w, 0.06 * h, 0.02, x * w * 0.33, lightY, -l / 2 - 0.01, palette.headlight);
    p.box(0.16 * w, 0.05 * h, 0.02, x * w * 0.35, lightY, l / 2 + 0.01, palette.taillight);
  }
}

/** Each placeholder's paintable body colour (the deck, the frame, the body panels). */
const BODY_COLOR: Record<RideTier, number> = {
  skateboard: palette.skateDeck,
  bicycle: palette.bicycleFrame,
  motorbike: palette.motorbikeBody,
  car: palette.carBody,
};

/** A placeholder's paint state: its body's vertex range and factory colours, and its materials. */
interface PaintState {
  start: number;
  count: number;
  factory: Float32Array;
  base: THREE.MeshLambertMaterial;
  /** Made on the first premium finish. */
  finish: THREE.MeshStandardMaterial | null;
}

/**
 * The placeholder for `tier`, sized from `spec.collider`: a Group named `vehicle-<tier>` holding one vertex-coloured
 * mesh (skateboard: deck + 4 wheels; bicycle: frame + 2 wheels; motorbike: body + 2 wheels; car: body + cabin +
 * 4 wheels), its body parts the geometry's second group (paintVehicle). Origin at the feet, facing −Z.
 */
export function buildVehicleMesh(tier: RideTier, spec: RideSpec): THREE.Group {
  const { w, l } = footprint(spec);
  const h = spec.collider.height;
  const p = new Parts(BODY_COLOR[tier]);
  switch (tier) {
    case 'skateboard':
      skateboard(p, l);
      break;
    case 'bicycle':
      bicycle(p, w, l);
      break;
    case 'motorbike':
      motorbike(p, w, l, h);
      break;
    case 'car':
      car(p, w, l, h);
      break;
  }
  const geometry = p.merge();
  const base = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, base);
  const body = geometry.groups[1]!;
  const colors = geometry.getAttribute('color').array as Float32Array;
  const state: PaintState = { start: body.start, count: body.count, factory: colors.slice(body.start * 3, (body.start + body.count) * 3), base, finish: null };
  mesh.userData.paint = state;
  mesh.name = `vehicle-${tier}-mesh`;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  const group = new THREE.Group();
  group.name = `vehicle-${tier}`;
  group.add(mesh);
  return group;
}

/**
 * Paints a placeholder (buildVehicleMesh) in place; wheels, trim, seat, glass and lights keep their colours. A colour
 * (or the factory paint, `color: null`) rewrites the body's vertex colours and stays one material, so one draw call; a
 * premium finish draws the body group with a finish material (one more draw call while it is worn).
 */
export function paintVehicle(root: THREE.Object3D, paint: Paint): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const state = mesh.userData.paint as PaintState | undefined;
    if (!mesh.isMesh || !state) return;
    const attr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const colors = attr.array as Float32Array;
    if ('finish' in paint) {
      state.finish ??= new THREE.MeshStandardMaterial();
      finishMaterial(paint.finish, state.finish);
      mesh.material = [state.base, state.finish];
      return;
    }
    if (paint.color === null) colors.set(state.factory, state.start * 3);
    else {
      const c = new THREE.Color(paint.color);
      for (let i = state.start; i < state.start + state.count; i++) c.toArray(colors, i * 3);
    }
    attr.needsUpdate = true;
    mesh.material = state.base;
  });
}

/**
 * How far the courier's model is lifted above the vehicle's feet while riding `tier`: onto the skateboard deck;
 * 0 on the bikes (the `bike` pose's hip drop seats it) and in the car (hidden).
 */
export function riderLift(tier: RideTier, spec: RideSpec = ridingConfig.rides[tier]): number {
  return tier === 'skateboard' ? deckTop(footprint(spec).l) : 0;
}

/** The player's car model (Decision 11); the other rides stay code-built (missing models, city design §5.5). */
export const CAR_MODEL_ID = 'mega/Car_01';

/**
 * The pack car, once `loader` has it (`entry` is its catalog entry): a Group named `vehicle-car-model` holding the
 * model scaled to the car's collider length (Decision 13: the 3.3 m model on the 4.4 m collider, carModelScale),
 * placed by its catalog pivot on the car's feet (bounding-box centre on the origin, lowest point on y = 0) and turned
 * so its front (`entry.front`, +z by default) faces −Z like the placeholders. Null while loading or when the model is
 * missing (the placeholder stays).
 */
export function carModel(loader: ModelLoader, entry: CatalogEntry, spec: RideSpec = ridingConfig.rides.car): THREE.Object3D | null {
  const m = loader.get(entry.id);
  if (m === 'missing' || m === 'loading') return null;
  const mesh = new THREE.Mesh(m.lod0, m.material);
  // facing 'S' is −z (placement's convention: the side a lot's front is on)
  const t = placeModel(entry, 'S', { x: 0, y: 0, z: 0 });
  mesh.position.set(t.position.x, t.position.y, t.position.z);
  mesh.rotation.y = t.rotY;
  mesh.name = 'vehicle-car-model-mesh';
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.userData.shared = m.material; // the loader's, shared with the city's cars: paintPackCar paints copies
  const group = new THREE.Group();
  group.name = 'vehicle-car-model';
  group.scale.setScalar(carModelScale(entry.size.d, footprint(spec).l));
  group.add(mesh);
  return group;
}

/**
 * The pack car's paint material: its only material, or (a model with glass or lights in their own materials) the
 * material of its largest geometry group, the body.
 */
function paintIndex(mesh: THREE.Mesh, materials: readonly THREE.Material[]): number {
  if (materials.length === 1) return 0;
  let best = 0;
  let most = -1;
  for (const g of mesh.geometry.groups) {
    if (g.count > most) {
      most = g.count;
      best = g.materialIndex ?? 0;
    }
  }
  return best;
}

/**
 * A painted copy of the pack car's paint material: the same texture and vertex colours, tinted by the colour (a
 * folded material tints only its textured parts, never the glass and lights); a finish is a standard material.
 */
function packPaint(src: THREE.Material, paint: Paint): THREE.MeshLambertMaterial | THREE.MeshStandardMaterial {
  const s = src as THREE.MeshLambertMaterial;
  const params = { map: s.map ?? null, vertexColors: s.vertexColors };
  const m = 'finish' in paint ? new THREE.MeshStandardMaterial(params) : new THREE.MeshLambertMaterial(params);
  m.name = src.name;
  if (src.name.endsWith(MATERIAL_FOLDED_SUFFIX)) foldFlatShader(m);
  paintMaterial(m, paint, surfaceOf(m), 0xffffff);
  return m;
}

/**
 * Paints the pack car (carModel) on copies of its materials: the loader's are shared with every parked car of the
 * city, which keep theirs. The factory paint (`color: null`) draws the model's own materials. Draw calls stay the same.
 */
export function paintPackCar(model: THREE.Object3D, paint: Paint): void {
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const shared = mesh.userData.shared as THREE.Material | THREE.Material[] | undefined;
    if (!mesh.isMesh || !shared) return;
    const previous = mesh.userData.painted as THREE.Material | undefined;
    previous?.dispose();
    mesh.userData.painted = undefined;
    if ('color' in paint && paint.color === null) {
      mesh.material = shared;
      return;
    }
    const list = Array.isArray(shared) ? shared : [shared];
    const i = paintIndex(mesh, list);
    const painted = packPaint(list[i]!, paint);
    mesh.userData.painted = painted;
    mesh.material = Array.isArray(shared) ? shared.map((m, k) => (k === i ? painted : m)) : painted;
  });
}
