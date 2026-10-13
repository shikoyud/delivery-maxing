import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapData, Vec3 } from '@dm/shared';
import { palette } from './palette';
import { shadowCameraTest, type SunShadow } from './shadowCamera';

export interface HubMeshes {
  group: THREE.Group;
  /** Highlights the POIs that are a current step of an active order (drawn wherever they are). */
  setTargets(poiIds: ReadonlySet<string>): void;
  isTarget(poiId: string): boolean;
  /**
   * Picks the POI markers drawn around the player's feet `center`: those within drawRadius, plus current targets. Call
   * once per frame; the instance buffers are rewritten only when the list changes. Nothing is drawn before the first call.
   */
  update(center: Vec3): void;
}

/** How the POI markers are culled (Task 19): by distance from the player, and the posts' shadows by the shadow camera. */
export interface PoiMarkerOptions {
  /** clientConfig.poiMarkers.drawRadius: posts and rings farther than this (horizontal, m) are not drawn. */
  drawRadius: number;
  /** The shadow-casting sun, or null without shadows: only posts inside its shadow camera cast. */
  shadow: SunShadow | null;
}

// Art dimensions (metres). Zone sizes come from the map (hub) and orders config (POI radius).
const DECAL_Y = 0.03;
const PLAZA_RING_WIDTH = 0.5;
const DROP_RING_WIDTH = 0.35;
const POST_HEIGHT = 3.2;
const POST_RADIUS = 0.12;
const POI_RING_WIDTH = 0.3;

function paint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Untextured: drop UVs so every merged part has the same attribute set.
  g.deleteAttribute('uv');
  return g;
}

function flatRing(inner: number, outer: number, segments: number): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(inner, outer, segments);
  g.rotateX(-Math.PI / 2);
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, rotY = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  g.rotateY(rotY);
  g.translate(x, y, z);
  return paint(g, color);
}

/** A low-poly courier kiosk facing the plaza centre: base, counter, a screen and a canopy on two poles. */
function kioskGeometry(map: MapData): THREE.BufferGeometry[] {
  const { kiosk, center } = map.hub;
  // Face the plaza centre (the screen side looks at it).
  const rot = Math.atan2(center.x - kiosk.x, center.z - kiosk.z);
  const local = (lx: number, lz: number): [number, number] => [
    kiosk.x + lx * Math.cos(rot) + lz * Math.sin(rot),
    kiosk.z - lx * Math.sin(rot) + lz * Math.cos(rot),
  ];
  const y = kiosk.y;
  const parts: THREE.BufferGeometry[] = [];
  const at = (w: number, h: number, d: number, lx: number, ly: number, lz: number, color: number): void => {
    const [x, z] = local(lx, lz);
    parts.push(box(w, h, d, x, y + ly, z, color, rot));
  };
  at(2.4, 1.0, 1.2, 0, 0, 0, palette.kioskBody); // base
  at(2.6, 0.1, 1.4, 0, 1.0, 0.05, palette.kioskCounter); // counter top
  at(1.4, 0.9, 0.12, 0, 1.15, -0.2, palette.kioskScreen); // board screen (back of the counter)
  at(0.12, 2.4, 0.12, -1.15, 1.0, -0.55, palette.post); // canopy poles
  at(0.12, 2.4, 0.12, 1.15, 1.0, -0.55, palette.post);
  at(3.0, 0.18, 1.9, 0, 3.4, 0.1, palette.kioskCanopy); // canopy
  at(3.0, 0.08, 0.06, 0, 3.32, 1.05, palette.kioskCounter); // canopy trim
  return parts;
}

/**
 * HUB and POI markers (spec §3, §11): plaza ring, drop-zone disc, the Order Board kiosk, and a post plus a
 * ground ring for each POI near the player (and each current target). Static parts are merged; POI posts and rings
 * are two InstancedMeshes whose instance colours highlight current targets (draw-call budget, ruling R5). No POI
 * count is assumed.
 */
export function buildHubMeshes(map: MapData, poiRadius: number, opts: PoiMarkerOptions): HubMeshes {
  const group = new THREE.Group();
  group.name = 'hub';
  const { hub } = map;

  // Flat decals: plaza boundary, drop-zone disc and its rim.
  const decals = [
    paint(flatRing(hub.plazaRadius - PLAZA_RING_WIDTH, hub.plazaRadius, 96), palette.plazaRing),
    paint(new THREE.CircleGeometry(hub.dropZoneRadius, 48).rotateX(-Math.PI / 2), palette.dropZone),
    paint(flatRing(hub.dropZoneRadius - DROP_RING_WIDTH, hub.dropZoneRadius, 48), palette.dropZoneRing),
  ];
  decals.forEach((g, i) => g.translate(hub.center.x, hub.center.y + DECAL_Y + i * 0.005, hub.center.z));
  const decalGeo = mergeGeometries(decals, false);
  decals.forEach((g) => g.dispose());
  const decalMesh = new THREE.Mesh(
    decalGeo,
    new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  decalMesh.name = 'hub-decals';
  decalMesh.receiveShadow = true;
  decalMesh.matrixAutoUpdate = false;
  group.add(decalMesh);

  const kioskParts = kioskGeometry(map);
  const kioskGeo = mergeGeometries(kioskParts, false);
  kioskParts.forEach((g) => g.dispose());
  const kiosk = new THREE.Mesh(kioskGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  kiosk.name = 'hub-kiosk';
  kiosk.castShadow = true;
  kiosk.receiveShadow = true;
  kiosk.matrixAutoUpdate = false;
  group.add(kiosk);

  // POI posts (white geometry; instance colour gives idle/target) and zone rings.
  const pois = map.pois;
  const n = Math.max(1, pois.length);
  const shaft = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS * 1.2, POST_HEIGHT, 8, 1).translate(0, POST_HEIGHT / 2, 0);
  const head = new THREE.OctahedronGeometry(0.45, 0).translate(0, POST_HEIGHT + 0.35, 0);
  const shaftFlat = shaft.toNonIndexed(); // the octahedron is already non-indexed
  const postGeo = mergeGeometries([shaftFlat, head], false);
  shaft.dispose();
  shaftFlat.dispose();
  head.dispose();
  postGeo.computeBoundingSphere();
  const postSphere = postGeo.boundingSphere!;
  const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
  posts.name = 'poi-posts';
  posts.castShadow = opts.shadow !== null;
  const ringGeo = flatRing(poiRadius - POI_RING_WIDTH, poiRadius, 40);
  const rings = new THREE.InstancedMesh(
    ringGeo,
    new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    n,
  );
  rings.name = 'poi-rings';
  for (const mesh of [posts, rings]) {
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Allocated up front so the shader is compiled with instance colours from the first frame.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
  }
  if (pois.length > 0) group.add(posts, rings);

  // Drawn POIs (indices into map.pois, in instance order): posts inside the shadow camera first, so the shadow pass can
  // draw just the first `shadowN` posts (posts beyond it would only cost shadow-map triangles).
  const inShadow = opts.shadow ? shadowCameraTest(opts.shadow) : null;
  const drawn: number[] = [];
  let shadowN = 0;
  posts.onBeforeShadow = () => {
    posts.count = shadowN;
  };
  posts.onAfterShadow = () => {
    posts.count = drawn.length;
  };

  const idle = new THREE.Color(palette.poiIdle);
  const target = new THREE.Color(palette.poiTarget);
  const targets = new Set<string>();
  const m = new THREE.Matrix4();
  const commit = (): void => {
    drawn.forEach((k, i) => {
      const p = pois[k]!;
      m.makeTranslation(p.position.x, p.position.y, p.position.z);
      posts.setMatrixAt(i, m);
      m.makeTranslation(p.position.x, p.position.y + DECAL_Y, p.position.z);
      rings.setMatrixAt(i, m);
      const c = targets.has(p.id) ? target : idle;
      posts.setColorAt(i, c);
      rings.setColorAt(i, c);
    });
    posts.count = rings.count = drawn.length;
    for (const mesh of [posts, rings]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
  };

  // The bounding spheres cover every POI, so whatever subset is drawn stays inside them (no wrong frustum culling).
  pois.forEach((p, i) => {
    m.makeTranslation(p.position.x, p.position.y, p.position.z);
    posts.setMatrixAt(i, m);
    rings.setMatrixAt(i, m);
  });
  posts.count = rings.count = pois.length;
  posts.computeBoundingSphere();
  rings.computeBoundingSphere();
  posts.count = rings.count = 0;

  const next: number[] = [];
  let center: Vec3 | null = null;
  const pick = (): void => {
    if (!center) return;
    const c = center;
    next.length = 0;
    const far: number[] = [];
    pois.forEach((p, k) => {
      if (Math.hypot(p.position.x - c.x, p.position.z - c.z) > opts.drawRadius && !targets.has(p.id)) return;
      const y = p.position.y + postSphere.center.y;
      if (inShadow?.(c, p.position.x, y, p.position.z, postSphere.radius)) next.push(k);
      else far.push(k);
    });
    const nextShadowN = next.length;
    next.push(...far);
    if (nextShadowN === shadowN && next.length === drawn.length && next.every((k, i) => drawn[i] === k)) return;
    drawn.length = 0;
    drawn.push(...next);
    shadowN = nextShadowN;
    commit();
  };

  return {
    group,
    setTargets(ids) {
      if (ids.size === targets.size && [...ids].every((id) => targets.has(id))) return;
      targets.clear();
      for (const id of ids) targets.add(id);
      pick(); // a far target joins (or leaves) the drawn list
      commit(); // and the colours change
    },
    isTarget: (id) => targets.has(id),
    update(c) {
      center = c;
      pick();
    },
  };
}
