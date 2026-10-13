import { describe, expect, it } from 'vitest';
import { movementConfig as cfg, type JumpPad, type Vec3, type ZipLine } from '@dm/shared';
import { MANTLE_STEP_MIN_RISE, mantleStepRises, mantleSteps, navLinkFor, obstacleOf, padLaunchFor, slopedSlab, zipBetween } from '../../src/city/kits';

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

describe('mantle step rises (Ruling R17)', () => {
  it('the rise floor is the mantle wall-probe height, inside the mantle window', () => {
    expect(MANTLE_STEP_MIN_RISE).toBe(1);
    expect(MANTLE_STEP_MIN_RISE).toBeGreaterThan(cfg.mantle.minHeight);
    expect(MANTLE_STEP_MIN_RISE).toBeLessThan(cfg.mantle.maxHeight);
  });

  it('mantleStepRises lists the rises of the kit, adding up to the climb', () => {
    for (const tiers of [1, 2, 3]) {
      const rises = mantleStepRises(tiers * 2.6, 1.4);
      expect(rises.length).toBe(mantleSteps({ x: 0, y: 0, z: 0 }, { x: 0, y: tiers * 2.6, z: 0 }, 0, 1.4).length + 1);
      expect(rises.reduce((a, b) => a + b, 0)).toBeCloseTo(tiers * 2.6, 6);
      for (const r of rises) {
        expect(r).toBeGreaterThanOrEqual(MANTLE_STEP_MIN_RISE);
        expect(r).toBeLessThanOrEqual(1.4);
      }
    }
    // A 1.2 m cap on a 2.6 m climb needs three rises under 1 m: below the R17 floor
    expect(Math.min(...mantleStepRises(2.6, 1.2))).toBeLessThan(MANTLE_STEP_MIN_RISE);
  });
});

describe('obstacleOf', () => {
  it('a box gives its footprint and top; a rotated box the top of its turned box', () => {
    const flat = { id: 'a', kind: 'prop' as const, center: { x: 1, y: 2, z: 3 }, size: { x: 2, y: 4, z: 6 } };
    expect(obstacleOf(flat)).toEqual({ rect: { minX: 0, minZ: 0, maxX: 2, maxZ: 6 }, top: 4 });
    const tilted = { ...flat, size: { x: 2, y: 1, z: 10 }, rotationDeg: { x: 30, y: 0, z: 0 } };
    // Half extents turned 30° about x: y = 0.5·cos 30° + 5·sin 30°
    expect(obstacleOf(tilted).top).toBeCloseTo(2 + 0.5 * Math.cos(Math.PI / 6) + 5 * Math.sin(Math.PI / 6), 6);
  });
});

describe('slopedSlab', () => {
  /** `p` in the slab's own frame (undoing its x or z rotation about its centre). */
  const local = (s: ReturnType<typeof slopedSlab>, p: Vec3): Vec3 => {
    const [ax, az] = [((s.rotationDeg?.x ?? 0) * Math.PI) / 180, ((s.rotationDeg?.z ?? 0) * Math.PI) / 180];
    const d = { x: p.x - s.center.x, y: p.y - s.center.y, z: p.z - s.center.z };
    // Inverse of Rx(ax)·Rz(az) (one of them is 0): Rz(−az) then Rx(−ax)
    const z1 = { x: d.x * Math.cos(az) + d.y * Math.sin(az), y: -d.x * Math.sin(az) + d.y * Math.cos(az), z: d.z };
    return { x: z1.x, y: z1.y * Math.cos(ax) + z1.z * Math.sin(ax), z: -z1.y * Math.sin(ax) + z1.z * Math.cos(ax) };
  };

  it('in each of the four directions the top face runs through hi and lo, hi at its upper end, reaching embed past lo', () => {
    const hi = { x: 10, y: 3, z: -20 };
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const lo = { x: hi.x + dx * 6, y: 1, z: hi.z + dz * 6 };
      const s = slopedSlab('s', 'ramp', hi, lo, 4, 0.8, 0.5);
      const alongX = dx !== 0;
      const half = (alongX ? s.size.x : s.size.z) / 2;
      expect(alongX ? s.size.z : s.size.x, `${dx},${dz} width`).toBe(4);
      expect(half * 2, `${dx},${dz} length`).toBeCloseTo(Math.hypot(6, 2) + 0.5, 2);
      for (const [p, at] of [[hi, -half], [lo, -half + Math.hypot(6, 2)]] as const) {
        const l = local(s, p);
        expect(l.y, `${dx},${dz} on the top face`).toBeCloseTo(0.4, 2);
        // The slab's long axis runs from hi (one end) past lo; which end is −half depends on the turn
        expect(Math.abs(alongX ? l.x : l.z), `${dx},${dz} along`).toBeCloseTo(Math.abs(at), 2);
        expect(alongX ? l.z : l.x, `${dx},${dz} centred across`).toBeCloseTo(0, 6);
      }
    }
    expect(() => slopedSlab('s', 'ramp', hi, { x: 12, y: 1, z: -18 }, 4, 0.8, 0)).toThrow(/along x or z/);
    expect(() => slopedSlab('s', 'ramp', hi, { x: 10, y: 4, z: -14 }, 4, 0.8, 0)).toThrow(/fall from hi to lo/);
  });
});
