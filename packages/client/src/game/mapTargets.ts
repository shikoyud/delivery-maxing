import type { CityMap, Lot, MapData, Vec3 } from '@dm/shared';

export interface TeleportTarget {
  id: string;
  label: string;
  kind: 'hospital' | 'gas';
}

/** Where a teleport puts the player, and the way they face after it (hospitals only). */
export interface TeleportDestination {
  position: Vec3;
  yaw?: number;
}

/** The dev panel's "Teleport to" entries: every hospital, then every gas station of the loaded map. */
export function teleportTargets(map: MapData): TeleportTarget[] {
  return [
    ...map.hospitals.map((h): TeleportTarget => ({ id: h.id, label: h.name, kind: 'hospital' })),
    ...map.gasStations.map((g): TeleportTarget => ({ id: g.id, label: g.name, kind: 'gas' })),
  ];
}

const lotsOf = (map: MapData): Lot[] => (map.kind === 'city' ? (map as CityMap).layout.lots : []);

/** The lot whose footprint holds `p` (horizontally), or null; always null on the greybox. */
export function lotAt(map: MapData, p: Vec3): Lot | null {
  return lotsOf(map).find((l) => p.x >= l.rect.minX && p.x <= l.rect.maxX && p.z >= l.rect.minZ && p.z <= l.rect.maxZ) ?? null;
}

/**
 * A hospital, gas station or lot id → where to stand. Hospital and gas ids also match without their `hospital-` or
 * `gas-` prefix ('bayview-general'). A lot is entered at its door, or at its centre when it has none.
 */
export function resolveTeleport(map: MapData, id: string): TeleportDestination | null {
  const find = <T extends { id: string }>(items: T[], prefix: string): T | undefined =>
    items.find((x) => x.id === id) ?? items.find((x) => x.id === `${prefix}${id}`);
  const h = find(map.hospitals, 'hospital-');
  if (h) return { position: { ...h.spawn }, yaw: h.spawnYaw };
  const g = find(map.gasStations, 'gas-');
  if (g) return { position: { ...g.position } };
  const lot = lotsOf(map).find((l) => l.id === id);
  if (lot) {
    const r = lot.rect;
    return { position: lot.door ? { ...lot.door } : { x: (r.minX + r.maxX) / 2, y: lot.y, z: (r.minZ + r.maxZ) / 2 } };
  }
  return null;
}

/** What teleporting needs from the game (Game, or a stand-in in tests). */
export interface TeleportHost {
  readonly map: MapData;
  readonly sim: { state: { heading: number } };
  teleport(p: Vec3): void;
}

/** Teleports `game` to the id; false (nothing moved) when it names nothing on this map. */
export function teleportToTarget(game: TeleportHost, id: string): boolean {
  const dest = resolveTeleport(game.map, id);
  if (!dest) return false;
  if (dest.yaw !== undefined) game.sim.state.heading = dest.yaw;
  game.teleport(dest.position);
  return true;
}
