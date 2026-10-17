import { describe, expect, it } from 'vitest';
import { vec3, type CityMap, type Lot, type MapData } from '@dm/shared';
import { lotAt, resolveTeleport, teleportTargets } from '../src/game/mapTargets';

const rect = (x: number, z: number) => ({ minX: x - 5, minZ: z - 5, maxX: x + 5, maxZ: z + 5 });
const lot = (id: string, x: number, z: number, door: ReturnType<typeof vec3> | null): Lot =>
  ({ id, rect: rect(x, z), y: 10, door }) as unknown as Lot;
const map = {
  kind: 'city',
  hospitals: [{ id: 'hospital-bayview-general', name: 'Bayview General', spawn: vec3(1, 2, 3), spawnYaw: 0.5 }],
  gasStations: [{ id: 'gas-ridge-fuel', name: 'Ridge Fuel', position: vec3(7, 0, 8) }],
  layout: { lots: [lot('lot-a', 0, 0, vec3(0, 10, -5)), lot('lot-b', 50, 0, null)] },
} as unknown as CityMap;

describe('map targets', () => {
  it('lists every hospital, then every gas station', () => {
    expect(teleportTargets(map as MapData)).toEqual([
      { id: 'hospital-bayview-general', label: 'Bayview General', kind: 'hospital' },
      { id: 'gas-ridge-fuel', label: 'Ridge Fuel', kind: 'gas' },
    ]);
  });

  it('resolves a hospital to its spawn and yaw, by full id or without the prefix', () => {
    expect(resolveTeleport(map, 'hospital-bayview-general')).toEqual({ position: vec3(1, 2, 3), yaw: 0.5 });
    expect(resolveTeleport(map, 'bayview-general')).toEqual({ position: vec3(1, 2, 3), yaw: 0.5 });
  });

  it('resolves a gas station and a lot (its door, else its centre); unknown ids give null', () => {
    expect(resolveTeleport(map, 'gas-ridge-fuel')?.position).toEqual(vec3(7, 0, 8));
    expect(resolveTeleport(map, 'ridge-fuel')?.position).toEqual(vec3(7, 0, 8));
    expect(resolveTeleport(map, 'lot-a')?.position).toEqual(vec3(0, 10, -5));
    expect(resolveTeleport(map, 'lot-b')?.position).toEqual(vec3(50, 10, 0));
    expect(resolveTeleport(map, 'nowhere')).toBeNull();
  });

  it('lotAt finds the lot whose footprint holds the point; null elsewhere and on the greybox', () => {
    expect(lotAt(map, vec3(2, 0, 3))?.id).toBe('lot-a');
    expect(lotAt(map, vec3(25, 0, 0))).toBeNull();
    expect(lotAt({ kind: 'greybox' } as MapData, vec3(0, 0, 0))).toBeNull();
  });
});
