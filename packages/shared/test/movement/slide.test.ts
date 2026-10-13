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
  it('crouch while sprinting at 8 m/s starts a slide that keeps its speed (≥ 6.9 after 0.5 s on flat, never above the 12 m/s burst)', async () => {
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
    expect(speed(h.sim.state)).toBeLessThanOrEqual(cfg.run.sprintSpeed + cfg.slide.boostSpeed);
    expect(h.sim.state.position.y).toBeCloseTo(0, 1);
  });

  it('a boosted slide from sprint never exceeds the 12 m/s on-foot cap', async () => {
    const h = await makeSim();
    h.run(30, SPRINT);
    h.tick(SLIDE, ['crouch']);
    expect(h.sim.state.mode).toBe('slide');
    for (let i = 0; i < 45; i++) {
      expect(speed(h.sim.state)).toBeLessThanOrEqual(12 + 1e-9);
      h.tick(SLIDE);
    }
    expect(speed(h.sim.state)).toBeLessThanOrEqual(12 + 1e-9);
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
    h.sim.state.slideBoostCooldown = 10; // no burst: the gain must come from the slope (a burst would sit at the 12 m/s cap)
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
    // 12 m/s (8 + burst 4) down to 3.5 m/s at friction 1.2 m/s² takes ~7.1 s (~212 ticks).
    const ticks = h.runUntil((s) => s.mode !== 'slide', 260, SLIDE);
    expect(ticks).toBeGreaterThanOrEqual(200);
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

describe('steep slopes', () => {
  it('a slide down a long steep ramp never takes horizontal speed past speedCap', async () => {
    const deg = 25;
    const a = (deg * Math.PI) / 180;
    const len = 200; // z in ±82: inside the test map's bounds
    const ramp = box('long-ramp', vec3(0, -0.5 * Math.cos(a), 0.5 * Math.sin(a)), vec3(8, 1, len), {
      rotationDeg: vec3(-deg, 0, 0),
      kind: 'ramp',
    });
    const h = await makeSim({ floor: false, solids: [ramp], spawn: onSlope(deg, 75) });
    h.run(20, SPRINT);
    h.tick(SLIDE, ['crouch']);
    expect(h.sim.state.mode).toBe('slide');
    let max = 0;
    for (let i = 0; i < 6 * cfg.tickRate && h.sim.state.position.z > 5; i++) {
      h.tick(SLIDE);
      max = Math.max(max, speed(h.sim.state));
    }
    expect(max).toBeGreaterThan(cfg.speedCap - 0.5); // the slope does reach the cap
    expect(max).toBeLessThanOrEqual(cfg.speedCap + 1e-6);
  });
});

describe('slide boost', () => {
  const started = (events: { kind: string }[]) => events.filter((e) => e.kind === 'slideStarted') as { kind: 'slideStarted'; boosted: boolean }[];

  it('a sprint slide starts at 12 m/s (8 + boostSpeed 4)', async () => {
    const h = await makeSim();
    h.run(30, SPRINT);
    expect(speed(h.sim.state)).toBeCloseTo(cfg.run.sprintSpeed, 2);
    const events = h.tick(SLIDE, ['crouch']);
    expect(h.sim.state.mode).toBe('slide');
    expect(started(events)).toEqual([{ kind: 'slideStarted', boosted: true }]);
    expect(speed(h.sim.state)).toBeCloseTo(cfg.run.sprintSpeed + cfg.slide.boostSpeed, 1);
    expect(h.sim.state.slideBoostCooldown).toBeCloseTo(cfg.slide.boostCooldown, 6);
  });

  it('keeps ≥ 11.3 m/s after 0.5 s on flat (friction 1.2)', async () => {
    const h = await makeSim();
    h.run(30, SPRINT);
    h.tick(SLIDE, ['crouch']);
    h.run(14, SLIDE); // 15 slide ticks = 0.5 s
    expect(h.sim.state.mode).toBe('slide');
    expect(speed(h.sim.state)).toBeGreaterThanOrEqual(11.3);
  });

  /** Boosted slide, then `gap` ticks later releases crouch for one tick and presses crouch again. Returns the second start's events and the speed before it. */
  async function secondSlide(gapTicks: number) {
    const h = await makeSim();
    h.run(30, SPRINT);
    h.tick(SLIDE, ['crouch']);
    h.run(gapTicks - 2, SLIDE);
    h.tick(SPRINT); // crouch released: the player stands, still sprinting
    expect(h.sim.state.mode).toBe('ground');
    expect(h.sim.state.sprinting).toBe(true);
    const before = speed(h.sim.state);
    const events = h.tick(SLIDE, ['crouch']);
    return { h, events, before };
  }

  it('a second slide 1.0 s after the first boosted one gets no burst (keeps current speed)', async () => {
    const { h, events, before } = await secondSlide(30);
    expect(h.sim.state.mode).toBe('slide');
    expect(started(events)).toEqual([{ kind: 'slideStarted', boosted: false }]);
    expect(before).toBeGreaterThan(cfg.run.sprintSpeed + 1);
    expect(speed(h.sim.state)).toBeLessThanOrEqual(before);
    expect(speed(h.sim.state)).toBeGreaterThan(before - 0.5);
    expect(h.sim.state.slideBoostCooldown).toBeGreaterThan(0.9);
  });

  it('the burst returns 2 s after the start of the boosted slide', async () => {
    const { events: early } = await secondSlide(58);
    expect(started(early)[0]?.boosted).toBe(false);
    const { h, events, before } = await secondSlide(62);
    expect(started(events)).toEqual([{ kind: 'slideStarted', boosted: true }]);
    expect(speed(h.sim.state)).toBeGreaterThan(before);
    expect(speed(h.sim.state)).toBeGreaterThan(cfg.speedCap - 0.05); // 8 + 4 = the 12 m/s cap
    expect(h.sim.state.slideBoostCooldown).toBeCloseTo(cfg.slide.boostCooldown, 6);
  });

  it('the burst never passes speedCap: entering at 10 m/s gives 12', async () => {
    const h = await makeSim();
    h.run(30, SPRINT);
    h.sim.state.velocity = vec3(0, 0, -10); // injected on the tick before the crouch press: still grounded and sprinting
    h.tick(SPRINT);
    expect(h.sim.state.grounded).toBe(true);
    expect(h.sim.state.sprinting).toBe(true);
    const events = h.tick(SLIDE, ['crouch']);
    expect(started(events)).toEqual([{ kind: 'slideStarted', boosted: true }]);
    expect(speed(h.sim.state)).toBeLessThanOrEqual(cfg.speedCap + 1e-9);
    expect(speed(h.sim.state)).toBeGreaterThan(cfg.speedCap - 0.1);
  });

  it('a landing slide (R26) never boosts', async () => {
    const h = await makeSim();
    h.run(30, SPRINT);
    h.tick(SLIDE, ['crouch']);
    h.tick(SLIDE, ['jump']);
    h.sim.state.slideBoostCooldown = 0; // as if the cooldown had run out in the air
    const events: { kind: string }[] = [];
    for (let i = 0; i < 40 && !h.sim.state.grounded; i++) events.push(...h.tick({ crouch: true }));
    const airSpeed = speed(h.sim.state);
    events.push(...h.run(6, { crouch: true }));
    expect(h.sim.state.mode).toBe('slide');
    expect(started(events)).toEqual([]);
    expect(speed(h.sim.state)).toBeLessThanOrEqual(airSpeed + 1e-9);
    expect(h.sim.state.slideBoostCooldown).toBe(0);
  });
});
