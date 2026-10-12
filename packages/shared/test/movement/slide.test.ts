import { describe, expect, it } from 'vitest';
import { movementConfig as cfg } from '../../src/config';
import { horizontalLength, vec3 } from '../../src/math/vec3';
import type { Solid } from '../../src/world/mapTypes';
import { box, makeSim, type Hold } from '../helpers/simHarness';

const speed = (s: { velocity: { x: number; y: number; z: number } }) => horizontalLength(s.velocity);
const SPRINT: Hold = { forward: 1, sprint: true };
const SLIDE: Hold = { forward: 1, sprint: true, crouch: true };

/**
 * A 60 m x 1 m x 8 m slab tilted `deg` about X so it descends toward -Z (yaw 0 faces downhill).
 * Its top surface passes through the origin: y = tan(deg) · z.
 */
function slope(id: string, deg: number, extra?: Partial<Solid>): Solid {
  const a = (deg * Math.PI) / 180;
  // Top-surface normal after rotating by -deg about X is (0, cos a, -sin a); the centre is half a thickness below.
  return box(id, vec3(0, -0.5 * Math.cos(a), 0.5 * Math.sin(a)), vec3(8, 1, 60), {
    rotationDeg: vec3(-deg, 0, 0),
    ...extra,
  });
}
const onSlope = (deg: number, z: number) => vec3(0, Math.tan((deg * Math.PI) / 180) * z + 0.05, z);

/** A 1.4 m ceiling over z in [-14, -4] (6 m wide): too low to stand under, high enough to crouch. */
const TUNNEL_NEAR = -4;
const TUNNEL_FAR = -14;
const ceiling = () => box('ceiling', vec3(0, 1.9, (TUNNEL_NEAR + TUNNEL_FAR) / 2), vec3(6, 1, TUNNEL_NEAR - TUNNEL_FAR));

describe('crouch-slide', () => {
  it('crouch while sprinting at 8 m/s starts a slide that keeps speed (≥ 6.9 after 0.5 s on flat)', async () => {
    const h = await makeSim();
    h.run(30, SPRINT);
    expect(speed(h.sim.state)).toBeGreaterThanOrEqual(7.95);
    h.tick(SLIDE, ['crouch']);
    expect(h.sim.state.mode).toBe('slide');
    expect(h.sim.state.crouched).toBe(true);
    expect(h.sim.body.crouched).toBe(true);
    h.run(14, SLIDE); // 15 slide ticks = 0.5 s
    expect(h.sim.state.mode).toBe('slide');
    expect(h.sim.state.grounded).toBe(true);
    expect(speed(h.sim.state)).toBeGreaterThanOrEqual(6.9);
    expect(speed(h.sim.state)).toBeLessThan(8);
    expect(h.sim.state.position.y).toBeCloseTo(0, 1);
  });

  it('crouch at 5.5 m/s (below minEntrySpeed 6) crouch-walks at ≤ 3 m/s instead', async () => {
    const h = await makeSim();
    h.run(30, { forward: 1 });
    expect(speed(h.sim.state)).toBeCloseTo(5.5, 2);
    // Sprint is held on the crouch tick too, so only the speed gate keeps this from being a slide.
    h.tick(SLIDE, ['crouch']);
    expect(h.sim.state.mode).toBe('ground');
    expect(h.sim.state.crouched).toBe(true);
    h.run(30, SLIDE);
    expect(h.sim.state.mode).toBe('ground');
    expect(h.sim.state.crouched).toBe(true);
    expect(speed(h.sim.state)).toBeLessThanOrEqual(cfg.run.crouchSpeed + 1e-9);
    expect(speed(h.sim.state)).toBeGreaterThan(2.9);
    // Releasing crouch in the open stands back up.
    h.tick({ forward: 1 });
    expect(h.sim.state.crouched).toBe(false);
  });

  it('a slide gains speed down a 15° slope (speed after 1 s > entry + 1)', async () => {
    const h = await makeSim({ floor: false, solids: [slope('ramp', 15)], spawn: onSlope(15, 20) });
    expect(h.sim.state.grounded).toBe(true);
    h.run(15, SPRINT);
    expect(h.sim.state.grounded).toBe(true);
    h.tick(SLIDE, ['crouch']);
    expect(h.sim.state.mode).toBe('slide');
    const entry = speed(h.sim.state);
    expect(entry).toBeGreaterThanOrEqual(7.5);
    const y0 = h.sim.state.position.y;
    h.run(30, SLIDE);
    expect(h.sim.state.mode).toBe('slide');
    expect(h.sim.state.grounded).toBe(true);
    expect(speed(h.sim.state)).toBeGreaterThan(entry + 1);
    expect(h.sim.state.position.y).toBeLessThan(y0 - 2);
  });

  it('jumping out of a slide keeps horizontal speed (momentum rule)', async () => {
    const h = await makeSim();
    h.run(30, SPRINT);
    h.tick(SLIDE, ['crouch']);
    // Momentum above sprint speed (e.g. from a downhill slide) must survive the jump.
    h.sim.state.velocity = vec3(0, 0, -12);
    h.tick(SLIDE);
    expect(h.sim.state.mode).toBe('slide');
    const before = speed(h.sim.state);
    expect(before).toBeGreaterThan(11.9);
    const events = h.tick(SLIDE, ['jump']);
    expect(events.some((e) => e.kind === 'jumped')).toBe(true);
    expect(h.sim.state.mode).toBe('air');
    expect(speed(h.sim.state)).toBeGreaterThanOrEqual(before - 1e-9);
    let airTicks = 0;
    while (!h.sim.state.grounded && airTicks < 60) {
      h.tick(SPRINT);
      airTicks += 1;
      if (!h.sim.state.grounded) expect(speed(h.sim.state)).toBeGreaterThanOrEqual(before - 1e-9);
    }
    expect(airTicks).toBeGreaterThan(10);
    expect(h.sim.state.grounded).toBe(true);
    expect(speed(h.sim.state)).toBeGreaterThanOrEqual(before - 0.2);
  });

  it('a slide that drops below endSpeed becomes a crouch', async () => {
    const h = await makeSim();
    h.run(30, SPRINT);
    h.tick(SLIDE, ['crouch']);
    expect(h.sim.state.mode).toBe('slide');
    // 8 m/s down to 3.5 m/s at friction 2 m/s² takes 2.25 s (~68 ticks).
    const ticks = h.runUntil((s) => s.mode !== 'slide', 90, SLIDE);
    expect(ticks).toBeGreaterThanOrEqual(60);
    expect(h.sim.state.mode).toBe('ground');
    expect(h.sim.state.crouched).toBe(true);
    expect(speed(h.sim.state)).toBeLessThan(cfg.slide.endSpeed);
    h.run(30, SLIDE);
    expect(h.sim.state.mode).toBe('ground');
    expect(speed(h.sim.state)).toBeLessThanOrEqual(cfg.run.crouchSpeed + 1e-9);
  });

  it('releasing crouch under a 1.4 m ceiling keeps the player crouched; they stand once clear (Review Focus 4)', async () => {
    const h = await makeSim({ solids: [ceiling()] });
    h.run(12, SPRINT);
    expect(h.sim.state.position.z).toBeGreaterThan(TUNNEL_NEAR + cfg.capsule.radius);
    h.tick(SLIDE, ['crouch']);
    expect(h.sim.state.mode).toBe('slide');
    h.runUntil((s) => s.position.z < TUNNEL_NEAR - 1, 30, SLIDE);
    // Crouch released inside the tunnel: standing is blocked, so the player stays crouched and planted.
    const r = cfg.capsule.radius;
    let ticksUnder = 0;
    let exitTicks = 0;
    while (h.sim.state.position.z > TUNNEL_FAR - r - 2 && exitTicks < 300) {
      h.tick({ forward: 1 });
      exitTicks += 1;
      const p = h.sim.state.position;
      if (p.z < TUNNEL_NEAR + r && p.z > TUNNEL_FAR - r) {
        ticksUnder += 1;
        expect(h.sim.state.crouched).toBe(true);
        expect(h.sim.body.crouched).toBe(true);
        expect(p.y).toBeGreaterThanOrEqual(-0.05);
        expect(p.y).toBeLessThanOrEqual(0.05);
        expect(h.sim.state.grounded).toBe(true);
      }
    }
    expect(ticksUnder).toBeGreaterThan(5);
    expect(h.sim.state.position.z).toBeLessThan(TUNNEL_FAR - r);
    expect(h.sim.state.crouched).toBe(false);
    expect(h.sim.body.crouched).toBe(false);
    expect(h.sim.state.mode).toBe('ground');
    expect(h.sim.state.position.y).toBeCloseTo(0, 1);
  });

  it('setCrouched refuses to stand under a ceiling and keeps the feet planted; fitsAt tests both sizes', async () => {
    const h = await makeSim({ solids: [ceiling()] });
    const body = h.sim.body;
    const under = vec3(0, 0, -9);
    expect(body.fitsAt(body.feet, false)).toBe(true);
    expect(body.fitsAt(under, false)).toBe(false);
    expect(body.fitsAt(under, true)).toBe(true);
    // A 1.12 m crouched capsule (1.1 m + offset) does not fit under a 1.0 m ceiling either.
    expect(body.fitsAt(vec3(0, 0.5, -9), true)).toBe(false);

    const feet0 = body.feet;
    expect(body.setCrouched(true)).toBe(true);
    expect(body.crouched).toBe(true);
    expect(body.feet).toEqual(feet0);
    h.sim.teleport(under);
    expect(body.setCrouched(false)).toBe(false);
    expect(body.crouched).toBe(true);
    expect(body.feet).toEqual(under);
    h.sim.teleport(feet0);
    expect(body.setCrouched(false)).toBe(true);
    expect(body.crouched).toBe(false);
    expect(body.feet).toEqual(feet0);
  });
});

describe('chutes', () => {
  it('grounded on a chute: slides without crouch and accelerates downhill', async () => {
    const h = await makeSim({
      floor: false,
      solids: [slope('chute', 20, { kind: 'chute', surface: 'chute' })],
      spawn: onSlope(20, 20),
    });
    expect(h.sim.state.grounded).toBe(true);
    expect(h.sim.lastMove?.groundSurface).toBe('chute');
    expect(h.sim.state.mode).toBe('slide');
    expect(h.sim.state.crouched).toBe(false);
    const y0 = h.sim.state.position.y;
    h.run(15);
    const half = speed(h.sim.state);
    h.run(15);
    const s = h.sim.state;
    expect(s.mode).toBe('slide');
    expect(s.grounded).toBe(true);
    expect(s.crouched).toBe(false);
    // Downhill along the ground plane: 20·sin20·cos²20 ≈ 6.0 m/s² minus chute friction 0.4.
    expect(speed(s)).toBeGreaterThan(4.5);
    expect(speed(s)).toBeGreaterThan(half + 2);
    expect(s.velocity.z).toBeLessThan(0);
    expect(Math.abs(s.velocity.x)).toBeLessThan(1e-6);
    expect(s.position.y).toBeLessThan(y0 - 0.5);
  });

  it('a long steep chute never takes horizontal speed past speedCap, steered downhill or not', async () => {
    const deg = 25;
    const a = (deg * Math.PI) / 180;
    const len = 200; // z in ±82: inside the test map's bounds
    const chute = box('long-chute', vec3(0, -0.5 * Math.cos(a), 0.5 * Math.sin(a)), vec3(8, 1, len), {
      rotationDeg: vec3(-deg, 0, 0),
      kind: 'chute',
      surface: 'chute',
    });
    for (const hold of [{}, { forward: 1, sprint: true }, { crouch: true }]) {
      const h = await makeSim({ floor: false, solids: [chute], spawn: onSlope(deg, 75) });
      let max = 0;
      for (let i = 0; i < 6 * cfg.tickRate && h.sim.state.position.z > 5; i++) {
        h.tick(hold);
        max = Math.max(max, speed(h.sim.state));
      }
      expect(max, JSON.stringify(hold)).toBeGreaterThan(cfg.speedCap - 0.5); // the chute does reach the cap
      expect(max, JSON.stringify(hold)).toBeLessThanOrEqual(cfg.speedCap + 1e-6);
    }
  });

  it('input on a chute only steers at chute.steerAccel', async () => {
    const h = await makeSim({
      floor: false,
      solids: [slope('chute', 20, { kind: 'chute', surface: 'chute' })],
      spawn: onSlope(20, 20),
    });
    h.run(30, { strafe: 1, sprint: true });
    expect(h.sim.state.mode).toBe('slide');
    // 1 s of full strafe adds at most steerAccel·1 s of sideways speed (yaw 0: strafe right is +X).
    expect(h.sim.state.velocity.x).toBeGreaterThan(0);
    expect(h.sim.state.velocity.x).toBeLessThanOrEqual(cfg.chute.steerAccel + 1e-6);
  });

  /**
   * Slides off a 0.6 m ledge (top at y = 0.6, edge at z = -1): crouch only (W released) until airborne, then `air`
   * until landing. Returns the harness and the speed on the last airborne tick.
   */
  async function slideOffLedge(air: Hold) {
    const h = await makeSim({ solids: [box('ledge', vec3(0, 0.3, 7), vec3(8, 0.6, 16))], spawn: vec3(0, 0.6, 14) });
    h.run(20, SPRINT);
    h.tick(SLIDE, ['crouch']);
    expect(h.sim.state.mode).toBe('slide');
    h.runUntil((s) => !s.grounded, 60, { crouch: true });
    let airSpeed = speed(h.sim.state);
    for (let i = 0; i < 30 && !h.sim.state.grounded; i++) {
      airSpeed = speed(h.sim.state);
      h.tick(air);
    }
    expect(h.sim.state.grounded).toBe(true);
    expect(h.sim.state.position.y).toBeCloseTo(0, 1);
    return { h, airSpeed };
  }

  it('R26: sliding off a 0.6 m ledge with crouch held (W released) keeps sliding and ≥ 90 % of speed 4 ticks after landing', async () => {
    const CROUCH: Hold = { crouch: true };
    const { h, airSpeed } = await slideOffLedge(CROUCH);
    expect(airSpeed).toBeGreaterThanOrEqual(cfg.slide.endSpeed);
    expect(h.sim.state.mode).toBe('slide');
    h.run(4, CROUCH);
    expect(h.sim.state.mode).toBe('slide');
    expect(speed(h.sim.state)).toBeGreaterThanOrEqual(0.9 * airSpeed);
  });

  it('R26: landing from the ledge with crouch NOT held lands on foot (ground) as before', async () => {
    const { h } = await slideOffLedge({});
    expect(h.sim.state.mode).toBe('ground');
    h.run(10, {});
    expect(h.sim.state.mode).toBe('ground');
    expect(speed(h.sim.state)).toBeLessThan(0.5);
  });

  it('R26: a slide-jump landed with crouch held continues the slide', async () => {
    const h = await makeSim();
    h.run(30, SPRINT);
    h.tick(SLIDE, ['crouch']);
    expect(h.sim.state.mode).toBe('slide');
    h.tick(SLIDE, ['jump']);
    expect(h.sim.state.grounded).toBe(false);
    h.runUntil((s) => s.grounded, 40, { crouch: true });
    expect(h.sim.state.mode).toBe('slide');
    expect(speed(h.sim.state)).toBeGreaterThanOrEqual(cfg.slide.endSpeed);
  });
});
