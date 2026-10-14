import { describe, expect, it } from 'vitest';
import { inCylinder, playerZones } from '../../src/world/zones';
import { ordersConfig } from '../../src/config';
import { vec3 } from '../../src/math/vec3';
import { emptyMap, testHospital } from './fixtures';

describe('zones', () => {
  it('inCylinder is inclusive at the radius and rejects points above base + height', () => {
    const base = vec3(0, 2, 0);
    expect(inCylinder(vec3(3, 2, 0), base, 3, 4)).toBe(true);
    expect(inCylinder(vec3(3.001, 2, 0), base, 3, 4)).toBe(false);
    expect(inCylinder(vec3(0, 6, 0), base, 3, 4)).toBe(true);
    expect(inCylinder(vec3(0, 6.01, 0), base, 3, 4)).toBe(false);
    expect(inCylinder(vec3(0, 1.5, 0), base, 3, 4)).toBe(true);
    expect(inCylinder(vec3(0, 1.49, 0), base, 3, 4)).toBe(false);
  });

  it('playerZones reports every POI containing the point', () => {
    const map = emptyMap();
    map.hospitals = [testHospital('h', vec3(-200, 0, -200))];
    map.pois = [
      { id: 'a', position: vec3(20, 0, 0), district: 'downtown', kind: 'door', name: 'A', roles: ['dropoffFood'] },
      { id: 'b', position: vec3(22, 0, 0), district: 'downtown', kind: 'door', name: 'B', roles: ['dropoffFood'] },
      { id: 'c', position: vec3(80, 0, 0), district: 'downtown', kind: 'counter', name: 'C', roles: ['foodPickup'], items: ['pizza'] },
    ];
    const z = ordersConfig.zones;
    expect(playerZones(vec3(0, 0, 0), map, z).poiIds.size).toBe(0);
    expect([...playerZones(vec3(20, 0, 0), map, z).poiIds].sort()).toEqual(['a', 'b']);
    expect([...playerZones(vec3(80, 0, 0), map, z).poiIds]).toEqual(['c']);
    expect(playerZones(vec3(80, 6, 0), map, z).poiIds.size).toBe(0);
  });

  it('playerZones reports the safe zone hospital id, or null outside every safe radius', () => {
    const map = emptyMap();
    map.hospitals = [testHospital('h1', vec3(0, 0, 0)), testHospital('h2', vec3(100, 0, 0))];
    const z = ordersConfig.zones;
    expect(playerZones(vec3(10, 0, 0), map, z).safeZone).toBe('h1');
    expect(playerZones(vec3(100, 0, 10), map, z).safeZone).toBe('h2');
    expect(playerZones(vec3(50, 0, 0), map, z).safeZone).toBeNull();
  });
});
