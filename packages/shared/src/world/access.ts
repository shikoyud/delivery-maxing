import { ridingConfig } from '../config';
import type { AccessKind, RidingConfig, VehicleTier } from '../config';
import { add, scale, vec3 } from '../math/vec3';
import type { Vec3 } from '../math/vec3';
import type { AccessZone, Hospital, MapData } from './mapTypes';

/** How far outside a zone's [minY, maxY] a point may be and still count as inside it. */
const Y_TOLERANCE = 0.5;

/** True when `tier` may enter zones of `kind` (spec §4.3). */
export const accessAllowed = (tier: VehicleTier, kind: AccessKind, cfg: RidingConfig = ridingConfig): boolean =>
  cfg.access[tier].includes(kind);

/** First zone whose rect contains the point (edges inclusive) at a compatible height. */
export function zoneAt(map: MapData, p: Vec3): AccessZone | null {
  for (const z of map.accessZones) {
    const r = z.rect;
    if (p.x < r.minX || p.x > r.maxX || p.z < r.minZ || p.z > r.maxZ) continue;
    if (p.y < z.minY - Y_TOLERANCE || p.y > z.maxY + Y_TOLERANCE) continue;
    return z;
  }
  return null;
}

/** The zone at `p` if `tier` is not allowed in it, else null. */
export function forbiddenZoneAt(map: MapData, tier: VehicleTier, p: Vec3): AccessZone | null {
  const z = zoneAt(map, p);
  return z && !accessAllowed(tier, z.kind) ? z : null;
}

/** Parking slot `i` at a hospital: spaced along the bay's right vector, facing `bayYaw`. */
export function baySlot(h: Hospital, i: number, cfg: RidingConfig = ridingConfig): { position: Vec3; heading: number } {
  const right = vec3(Math.cos(h.bayYaw), 0, -Math.sin(h.bayYaw));
  return { position: add(h.bay, scale(right, i * cfg.bays.spacing)), heading: h.bayYaw };
}
