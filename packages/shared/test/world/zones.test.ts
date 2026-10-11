import { describe, expect, it } from 'vitest';
import { inCylinder, playerZones } from '../../src/world/zones';
import { ordersConfig } from '../../src/config';
import { vec3 } from '../../src/math/vec3';
import { emptyMap } from './fixtures';

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

  it('playerZones reports plaza, drop zone and every POI containing the point', () => {
    const map = emptyMap();
    map.pois = [
      { id: 'a', position: vec3(20, 0, 0), district: 'downtown', kind: 'door' },
      { id: 'b', position: vec3(22, 0, 0), district: 'downtown', kind: 'mailbox' },
      { id: 'c', position: vec3(80, 0, 0), district: 'downtown', kind: 'counter' },
    ];
    const z = ordersConfig.zones;
    const hub = playerZones(vec3(0, 0, 0), map, z);
    expect(hub.inPlaza && hub.inDropZone).toBe(true);
    expect(hub.poiIds.size).toBe(0);
    const plaza = playerZones(vec3(20, 0, 0), map, z);
    expect(plaza.inPlaza).toBe(true);
    expect(plaza.inDropZone).toBe(false);
    expect([...plaza.poiIds].sort()).toEqual(['a', 'b']);
    const far = playerZones(vec3(80, 0, 0), map, z);
    expect(far.inPlaza).toBe(false);
    expect([...far.poiIds]).toEqual(['c']);
  });
});
