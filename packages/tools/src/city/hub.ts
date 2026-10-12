import type { Checkpoint, Hub, Solid } from '@dm/shared';
import { v2 } from './layout';
import type { CitySource } from './source';

export interface HubOutput { hub: Hub; solids: Solid[]; checkpoint: Checkpoint }

/**
 * The SP1 Central Plaza: the hub values (plaza, drop zone, kiosk, spawn), the kiosk box, and a square paving that
 * covers the plaza circle, flush with the roads (arterials end on its edges). The spawn stands on the paving, and the
 * spawn checkpoint with it.
 */
export function buildHub(src: CitySource): HubOutput {
  const { kioskSize } = src.hub;
  const { center, plazaRadius, dropZoneRadius, zoneHeight, kiosk: kioskAt, kioskRange, spawn: spawnAt, spawnYaw } = src.hub;
  const hubValues: Hub = { center, plazaRadius, dropZoneRadius, zoneHeight, kiosk: kioskAt, kioskRange, spawn: spawnAt, spawnYaw };
  const top = src.streets.roadTop;
  const c = hubValues.center;
  const side = 2 * hubValues.plazaRadius;
  const paving: Solid = {
    id: 'hub-plaza',
    kind: 'hub',
    // Like the street slabs: as deep below the ground top as it stands above it
    center: v2(c),
    size: v2({ x: side, y: 2 * top, z: side }),
  };
  const kiosk: Solid = {
    id: 'hub-kiosk',
    kind: 'hub',
    center: v2({ x: hubValues.kiosk.x, y: hubValues.kiosk.y + kioskSize.y / 2, z: hubValues.kiosk.z }),
    size: v2(kioskSize),
  };
  const spawn = v2({ ...hubValues.spawn, y: c.y + top });
  return {
    hub: { ...hubValues, center: v2(c), kiosk: v2(hubValues.kiosk), spawn },
    solids: [paving, kiosk],
    checkpoint: { id: 'cp-hub', position: spawn },
  };
}
