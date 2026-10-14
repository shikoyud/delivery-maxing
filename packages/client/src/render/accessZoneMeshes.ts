import * as THREE from 'three';
import type { MapData } from '@dm/shared';
import { accessZoneColors } from './palette';

/** How far each overlay box reaches above the zone's top (m), so a flat zone still shows as a volume. */
const HEADROOM = 2.5;
const OPACITY = 0.25;

/**
 * The access-zone overlay (spec §4.3, debug): one translucent box per zone over its rect from minY to maxY + HEADROOM,
 * coloured per kind (accessZoneColors). One InstancedMesh, no shadows, not written to the depth buffer. Hidden until
 * the F3 overlay shows it (Game sets `visible`).
 */
export function buildAccessZoneMeshes(map: MapData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'access-zone-overlay';
  group.visible = false;
  const zones = map.accessZones;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: OPACITY, depthWrite: false }),
    Math.max(1, zones.length),
  );
  mesh.name = 'access-zones';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.count = zones.length;
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  zones.forEach((z, i) => {
    const r = z.rect;
    const h = z.maxY - z.minY + HEADROOM;
    m.makeScale(r.maxX - r.minX, h, r.maxZ - r.minZ).setPosition((r.minX + r.maxX) / 2, z.minY, (r.minZ + r.maxZ) / 2);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setHex(accessZoneColors[z.kind]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
  return group;
}
