import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { vec3 } from '../../src/math/vec3';
import { baySlot } from '../../src/world/access';
import { box, makeSim } from '../helpers/simHarness';

describe('out-of-bounds respawn', () => {
  it('falling below outOfBoundsY respawns at the nearest hospital spawn and emits respawned', async () => {
    const h = await makeSim({
      floor: false,
      solids: [box('plat', vec3(0, -0.5, 0), vec3(8, 1, 8))],
      spawn: vec3(0, 0, 0),
    });
    h.sim.teleport(vec3(20, 0, 0)); // off the platform, over the void
    let ev = h.tick();
    for (let i = 0; i < 120 && !ev.some((e) => e.kind === 'respawned'); i++) ev = h.tick();
    expect(ev).toContainEqual({ kind: 'respawned', hospitalId: 'h-test' });
    const s = h.sim.state;
    expect(s.position.x).toBeCloseTo(0, 5);
    expect(s.position.y).toBeCloseTo(0, 5);
    expect(s.position.z).toBeCloseTo(0, 5);
    expect(s.velocity).toEqual(vec3(0, 0, 0));
    expect(s.mode).toBe('air');
    expect(s.jumpPressAge).toBeNull();
  });

  it('respawns at the hospital nearest the last grounded position, carrying its id', async () => {
    const far = { id: 'far', name: 'Far', center: vec3(-80, 0, -80), safeRadius: 18, spawn: vec3(-80, 0, -72), spawnYaw: 0, bay: vec3(-80, 0, -64), bayYaw: 0 };
    const near = { id: 'near', name: 'Near', center: vec3(40, 0, 0), safeRadius: 18, spawn: vec3(40, 0, 8), spawnYaw: 0, bay: vec3(40, 0, 16), bayYaw: 0 };
    const h = await makeSim({ spawn: vec3(30, 0, 0), hospitals: [far, near] });
    expect(h.sim.state.lastGrounded.x).toBeCloseTo(30, 1);
    h.sim.teleport(vec3(0, -10, 0)); // the fall position itself is nearer to neither; lastGrounded decides
    const ev = h.tick();
    expect(ev).toContainEqual({ kind: 'respawned', hospitalId: 'near' });
    expect(h.sim.state.position.x).toBeCloseTo(40, 5);
    expect(h.sim.state.position.z).toBeCloseTo(8, 5);
  });

  it("respawn faces the hospital's spawnYaw (heading and look yaw)", async () => {
    const hosp = { id: 'h', name: 'H', center: vec3(0, 0, 0), safeRadius: 18, spawn: vec3(0, 0, 8), spawnYaw: 1.25, bay: vec3(0, 0, 16), bayYaw: 0 };
    const h = await makeSim({ spawn: vec3(0, 0, 8), hospitals: [hosp] });
    h.sim.state.heading = -2;
    h.sim.state.yaw = -2;
    h.sim.teleport(vec3(0, -10, 0));
    expect(h.tick().some((e) => e.kind === 'respawned')).toBe(true);
    expect(h.sim.state.heading).toBe(1.25);
    expect(h.sim.state.yaw).toBe(1.25);
  });

  it('leaving the island edge (beyond size/2 + boundsMargin) also respawns', async () => {
    const h = await makeSim({ spawn: vec3(5, 0, 0) });
    h.sim.teleport(vec3(h.map.size / 2 + cfg.fall.boundsMargin + 1, 3, 0));
    const ev = h.tick();
    expect(ev.some((e) => e.kind === 'respawned')).toBe(true);
    expect(h.sim.state.position.x).toBeCloseTo(5, 5);
  });

  it('does not respawn while inside the bounds', async () => {
    const h = await makeSim();
    expect(h.run(30, { forward: 1 }).some((e) => e.kind === 'respawned')).toBe(false);
  });

  it('Review Focus 5: riding off the map edge respawns on foot at the nearest hospital and tows the car to its bay; F at the bay mounts it again', async () => {
    const hosp = { id: 'h-north', name: 'North', center: vec3(0, 0, 40), safeRadius: 18, spawn: vec3(0, 0, 48), spawnYaw: 0, bay: vec3(10, 0, 56), bayYaw: 0 };
    const h = await makeSim({
      spawn: vec3(2, 0, -80),
      hospitals: [hosp],
      garage: [
        { tier: 'skateboard', spot: { kind: 'carried' }, fuel: 1 },
        { tier: 'car', spot: { kind: 'parked', position: vec3(0, 0, -80), heading: 0 }, fuel: 0.6 },
      ],
    });
    expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'mounted', tier: 'car' });
    let ev = h.tick({ forward: 1 });
    for (let i = 0; i < 300 && !ev.some((e) => e.kind === 'respawned'); i++) ev = h.tick({ forward: 1 });
    expect(ev).toContainEqual({ kind: 'respawned', hospitalId: 'h-north' });
    expect(ev).toContainEqual({ kind: 'towed', tier: 'car', hospitalId: 'h-north' });
    const s = h.sim.state;
    expect(s.riding).toBeNull();
    expect(s.lastRide).toBe('car');
    expect(s.position.x).toBeCloseTo(0, 5);
    expect(s.position.z).toBeCloseTo(48, 5);
    expect(h.sim.body.collider.isEnabled()).toBe(true);
    const garage = h.sim.garage;
    expect(garage.spot('car')).toEqual({ kind: 'parked', ...baySlot(hosp, 0) });
    expect(garage.state('car').fuel).toBe(0.6);
    expect(garage.state('car').velocity).toEqual(vec3(0, 0, 0));

    // Walk over to the bay and get back in.
    h.sim.teleport(vec3(12, 0.5, 56));
    h.runUntil((st) => st.grounded, 30);
    expect(h.sim.mountCandidate()).toBe('car');
    expect(h.tick({}, ['mount'])).toContainEqual({ kind: 'mounted', tier: 'car' });
  });
});
