import * as THREE from 'three';
import type { Vec3 } from '@dm/shared';

/**
 * The shadow-casting sun (Renderer): its orthographic shadow camera looks along -toSun at the player's ground point and
 * covers ±extent across.
 */
export interface SunShadow {
  /** Unit vector toward the light (y > 0). */
  toSun: Vec3;
  /** graphics.shadowExtent: half-size of the shadow camera (m). */
  extent: number;
}

/** Slack (m) of the shadow-camera test: Renderer snaps the shadow camera's centre to whole shadow texels. */
const SHADOW_SNAP_SLACK = 1;

/**
 * Whether a sphere (centre cx, cy, cz, radius r) reaches into the sun's shadow camera centred on the ground point under
 * `focus`: only such objects can draw into the shadow map.
 */
export type ShadowCameraTest = (focus: Vec3, cx: number, cy: number, cz: number, r: number) => boolean;

export function shadowCameraTest(shadow: SunShadow): ShadowCameraTest {
  // The shadow camera looks at the target from toSun with up = +y (three's lookAt): x = up × z, y = z × x.
  const z = new THREE.Vector3(shadow.toSun.x, shadow.toSun.y, shadow.toSun.z).normalize();
  const x = new THREE.Vector3(0, 1, 0).cross(z).normalize();
  const y = z.clone().cross(x);
  return (focus, cx, cy, cz, r) => {
    const qx = cx - focus.x;
    const qz = cz - focus.z;
    const reach = shadow.extent + r + SHADOW_SNAP_SLACK;
    return Math.abs(qx * x.x + cy * x.y + qz * x.z) <= reach && Math.abs(qx * y.x + cy * y.y + qz * y.z) <= reach;
  };
}
