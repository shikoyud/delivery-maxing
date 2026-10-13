import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { vec3, vehiclesConfig } from '@dm/shared';
import { MAX_WAYPOINTS, buildWaypoints, slotColor } from '../src/render/waypoints';
import { slotColors } from '../src/render/palette';

describe('buildWaypoints', () => {
  it('shows one beam per target, capped at the slot count', () => {
    const w = buildWaypoints(2, 1);
    expect(w.mesh.count).toBe(0);
    w.update([vec3(1, 0, 2)], [0], 0);
    expect(w.mesh.count).toBe(1);
    w.update([vec3(1, 0, 2), vec3(3, 0, 4), vec3(5, 0, 6)], [0, 1, 2], 0);
    expect(w.mesh.count).toBe(2);
  });

  it('colours each beam by its order colour index, not its list position (R29d)', () => {
    const w = buildWaypoints(3, 1);
    w.update([vec3(1, 0, 2), vec3(3, 0, 4)], [2, 0], 0);
    const c = new THREE.Color();
    w.mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(new THREE.Color(slotColor(2)).getHex());
    w.mesh.getColorAt(1, c);
    expect(c.getHex()).toBe(new THREE.Color(slotColor(0)).getHex());
  });

  it('has a beam and a distinct colour for every slot of the largest carrier', () => {
    expect(MAX_WAYPOINTS).toBe(vehiclesConfig.car.slots);
    expect(slotColors.length).toBeGreaterThanOrEqual(MAX_WAYPOINTS);
    expect(buildWaypoints(MAX_WAYPOINTS, 1).mesh.instanceMatrix.count).toBe(MAX_WAYPOINTS);
  });
});
