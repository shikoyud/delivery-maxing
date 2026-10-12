import { describe, expect, it } from 'vitest';
import { movementConfig as cfg, type JumpPad, type Vec3, type ZipLine } from '@dm/shared';
import { mantleSteps, navLinkFor, padLaunchFor, zipBetween } from '../../src/city/kits';

const g = cfg.gravity;

/** Where a body launched from `start` at `v` is after `t` s of free flight. */
const at = (start: Vec3, v: Vec3, t: number): Vec3 => ({
  x: start.x + v.x * t,
  y: start.y + v.y * t - (g * t * t) / 2,
  z: start.z + v.z * t,
});

describe('padLaunchFor', () => {
  const cases: { start: Vec3; target: Vec3; apex: number }[] = [
    { start: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 20, z: -18 }, apex: 2.5 },
    { start: { x: 400, y: 0.15, z: -400 }, target: { x: 391.3, y: 31.7, z: -421.6 }, apex: 3 },
    { start: { x: 5, y: 12, z: 5 }, target: { x: 30, y: 2, z: -7 }, apex: 1.5 },
    { start: { x: -3, y: 4, z: 9 }, target: { x: -3, y: 4, z: 1 }, apex: 4 },
  ];

  it('padLaunchFor lands on target in closed form (±0.05 m)', () => {
    for (const { start, target, apex } of cases) {
      const v = padLaunchFor(start, target, apex, g);
      // Peak height: max(start.y, target.y) + apexAbove
      const tUp = v.y / g;
      expect(at(start, v, tUp).y).toBeCloseTo(Math.max(start.y, target.y) + apex, 1);
      // On the way down it passes target.y exactly at the target
      const peak = Math.max(start.y, target.y) + apex;
      const tLand = tUp + Math.sqrt((2 * (peak - target.y)) / g);
      const p = at(start, v, tLand);
      expect(Math.abs(p.x - target.x)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(p.y - target.y)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(p.z - target.z)).toBeLessThanOrEqual(0.05);
    }
  });

  it('rounds the launch to 0.01 m/s', () => {
    const v = padLaunchFor(cases[1]!.start, cases[1]!.target, 3, g);
    for (const c of [v.x, v.y, v.z]) expect(Math.round(c * 100) / 100).toBe(c);
  });
});

describe('mantleSteps', () => {
  it('climbs from the base to within one rise of the top in crate steps 1.5 m deep, each rise ≤ the limit', () => {
    const base = { x: 10, y: 0, z: 20 };
    const top = { x: 10, y: 6.2, z: 18 };
    // Climbing toward −z (rotY 180): the tallest crate stands against the ledge at the base, the others step back +z.
    const steps = mantleSteps(base, top, 180, 1.2, 'yard-steps');
    expect(steps.length).toBe(5);
    const tops = steps.map((s) => s.center.y + s.size.y / 2);
    let prev = base.y;
    for (const [k, s] of steps.entries()) {
      expect(s.id).toBe(`yard-steps-${k}`);
      expect(s.size.z).toBeCloseTo(1.5, 6);
      expect(s.center.y - s.size.y / 2).toBeCloseTo(base.y, 6);
      expect(tops[k]! - prev).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(tops[k]! - prev).toBeGreaterThan(0);
      prev = tops[k]!;
    }
    expect(top.y - prev).toBeLessThanOrEqual(1.2 + 1e-9);
    // Farthest (lowest) crate first; the last one touches the ledge face at the base point
    expect(steps[4]!.center.z - steps[4]!.size.z / 2).toBeCloseTo(base.z, 6);
    expect(steps[0]!.center.z).toBeGreaterThan(steps[4]!.center.z);
  });

  it('turns with rotY (90 climbs toward +x) and returns nothing when the ledge is within one rise', () => {
    const steps = mantleSteps({ x: 0, y: 0, z: 0 }, { x: 1, y: 3, z: 0 }, 90, 1.2, 's');
    expect(steps.length).toBe(2);
    expect(steps[1]!.center.x + steps[1]!.size.x / 2).toBeCloseTo(0, 6);
    expect(steps[0]!.center.x).toBeLessThan(steps[1]!.center.x);
    expect(steps[0]!.size.x).toBeCloseTo(1.5, 6);
    expect(mantleSteps({ x: 0, y: 0, z: 0 }, { x: 0, y: 1.1, z: 0 }, 0, 1.2, 's')).toEqual([]);
  });
});

describe('zipBetween and navLinkFor', () => {
  it('zipBetween rounds the ends and keeps the id', () => {
    const z = zipBetween({ x: 1.234, y: 2.345, z: 3.456 }, { x: 4, y: 5, z: 6 }, 'downtown-zip-1');
    expect(z).toEqual({ id: 'downtown-zip-1', a: { x: 1.23, y: 2.35, z: 3.46 }, b: { x: 4, y: 5, z: 6 } });
  });

  it('zips are bidirectional, pads and drops one-way, mantle stacks bidirectional', () => {
    const zip: ZipLine = { id: 'z1', a: { x: 0, y: 10, z: 0 }, b: { x: 30, y: 3, z: 0 } };
    expect(navLinkFor(zip)).toEqual({ id: 'z1-nav', kind: 'zip', from: zip.a, to: zip.b, bidirectional: true });
    const pad: JumpPad & { target: Vec3 } = {
      id: 'p1',
      position: { x: 0, y: 0, z: 0 },
      radius: 1.2,
      launch: { x: 0, y: 9, z: -5 },
      target: { x: 0, y: 15, z: -12 },
    };
    expect(navLinkFor(pad)).toEqual({ id: 'p1-nav', kind: 'pad', from: pad.position, to: pad.target, bidirectional: false });
    const drop = { kind: 'drop' as const, id: 'd1', from: { x: 0, y: 6, z: 0 }, to: { x: 0, y: 0, z: 3 } };
    expect(navLinkFor(drop)).toEqual({ id: 'd1', kind: 'drop', from: drop.from, to: drop.to, bidirectional: false });
    const mantle = { kind: 'mantle' as const, id: 'm1', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 4, z: -2 } };
    expect(navLinkFor(mantle)).toEqual({ id: 'm1', kind: 'mantle', from: mantle.from, to: mantle.to, bidirectional: true });
  });
});
