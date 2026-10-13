import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapData, Poi } from '@dm/shared';
import { palette } from './palette';

export interface PoiMeshes {
  group: THREE.Group;
  /** Raises the markers of the POIs that are a current stop of an active order. */
  setTargets(ids: ReadonlySet<string>): void;
  /** Brightens one marker (the selected offer's stop), or none. */
  setHighlight(id: string | null): void;
}

// Art dimensions (metres). The zone radius comes from the orders config.
const DOOR_WIDTH = 1.2;
const DOOR_HEIGHT = 2.2;
const DOOR_DEPTH = 0.12;
const SIGN_SIZE = 0.5;
const SIGN_Y = DOOR_HEIGHT + 0.7;
const RING_WIDTH = 0.25;
const DECAL_Y = 0.03;
/** How far a targeted marker rises, so stops read from a distance. */
const TARGET_LIFT = 1.5;
/** Share of white mixed into the highlighted marker. */
const HIGHLIGHT_MIX = 0.55;

/** The marker colour: the POI's first pickup role, else dropoff. */
export function poiColor(poi: Poi): number {
  for (const role of poi.roles) {
    if (role === 'foodPickup') return palette.poiFood;
    if (role === 'packagePickup') return palette.poiPackage;
  }
  return palette.poiDrop;
}

/**
 * POI markers (spec §3): a door-shaped slab with a diamond sign above it, plus a ground ring at the zone radius, for
 * every POI, coloured by role. Two InstancedMeshes whatever the POI count (draw-call budget, ruling R5).
 */
export function buildPoiMeshes(map: MapData, radius: number): PoiMeshes {
  const group = new THREE.Group();
  group.name = 'pois';
  const pois = map.pois;
  const n = Math.max(1, pois.length);

  const door = new THREE.BoxGeometry(DOOR_WIDTH, DOOR_HEIGHT, DOOR_DEPTH).translate(0, DOOR_HEIGHT / 2, 0).toNonIndexed();
  door.deleteAttribute('uv');
  const sign = new THREE.OctahedronGeometry(SIGN_SIZE, 0).translate(0, SIGN_Y, 0);
  sign.deleteAttribute('uv');
  const markerGeo = mergeGeometries([door, sign], false);
  door.dispose();
  sign.dispose();
  const markers = new THREE.InstancedMesh(markerGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
  markers.name = 'poi-markers';
  markers.castShadow = true;

  const ringGeo = new THREE.RingGeometry(radius - RING_WIDTH, radius, 40).rotateX(-Math.PI / 2);
  const rings = new THREE.InstancedMesh(
    ringGeo,
    new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    n,
  );
  rings.name = 'poi-rings';
  markers.count = rings.count = pois.length;

  const base = pois.map((p) => new THREE.Color(poiColor(p)));
  const white = new THREE.Color(0xffffff);
  const c = new THREE.Color();
  const m = new THREE.Matrix4();
  const targets = new Set<string>();
  let highlight: string | null = null;

  const place = (): void => {
    pois.forEach((p, i) => {
      const lift = targets.has(p.id) ? TARGET_LIFT : 0;
      m.makeTranslation(p.position.x, p.position.y + lift, p.position.z);
      markers.setMatrixAt(i, m);
    });
    markers.instanceMatrix.needsUpdate = true;
    markers.computeBoundingSphere();
  };
  const paint = (): void => {
    pois.forEach((p, i) => {
      c.copy(base[i]!);
      if (p.id === highlight) c.lerp(white, HIGHLIGHT_MIX);
      markers.setColorAt(i, c);
      rings.setColorAt(i, c);
    });
    if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
  };

  pois.forEach((p, i) => {
    m.makeTranslation(p.position.x, p.position.y + DECAL_Y, p.position.z);
    rings.setMatrixAt(i, m);
  });
  rings.computeBoundingSphere();
  place();
  paint();
  if (pois.length > 0) group.add(markers, rings);

  return {
    group,
    setTargets(ids) {
      if (ids.size === targets.size && [...ids].every((id) => targets.has(id))) return;
      targets.clear();
      for (const id of ids) targets.add(id);
      place();
    },
    setHighlight(id) {
      if (id === highlight) return;
      highlight = id;
      paint();
    },
  };
}
