import { beforeAll, describe, expect, it } from 'vitest';
import greyboxJson from '../../../../map/greybox.json';
import { movementConfig as cfg, ordersConfig } from '../../src/config';
import { distance, vec3, type Vec3 } from '../../src/math/vec3';
import { buildPoiTable, streetDistance } from '../../src/world/distance';
import { expandGreybox } from '../../src/world/greybox';
import type { District, GreyboxSource, MapData, Rect, Solid } from '../../src/world/mapTypes';
import { createPhysicsWorld, initRapier, type PhysicsWorld, type Rapier } from '../../src/world/physicsWorld';

const src = greyboxJson as unknown as GreyboxSource;
const map: MapData = expandGreybox(src);
const half = map.size / 2;
const generated = map.solids.filter((s) => s.kind === 'building' && /^b-/.test(s.id));
const handPlaced = map.solids.filter((s) => s.id !== 'ground' && !generated.includes(s));
const DISTRICTS: Exclude<District, 'hub'>[] = ['downtown', 'harbor', 'hillside', 'suburbs'];

let rapier: Rapier;
let physics: PhysicsWorld;
beforeAll(async () => {
  rapier = await initRapier();
  physics = createPhysicsWorld(rapier, map);
});

/** Rotation matrix (row-major) for an XYZ Euler in degrees, matching three.js 'XYZ' order (R = Rx·Ry·Rz). */
function rotation(s: Solid): number[][] {
  const r = s.rotationDeg ?? vec3(0, 0, 0);
  const [a, b, c] = [r.x, r.y, r.z].map((d) => (d * Math.PI) / 180) as [number, number, number];
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
  ];
}

/** Whether p is strictly inside the solid (by more than eps on every axis). */
function insideSolid(p: Vec3, s: Solid, eps = 0.01): boolean {
  const m = rotation(s);
  const d = [p.x - s.center.x, p.y - s.center.y, p.z - s.center.z];
  // local = Rᵀ · d
  const local = [0, 1, 2].map((i) => m[0]![i]! * d[0]! + m[1]![i]! * d[1]! + m[2]![i]! * d[2]!);
  const h = [s.size.x / 2, s.size.y / 2, s.size.z / 2];
  return local.every((v, i) => Math.abs(v) < h[i]! - eps);
}

/** World-space axis-aligned bounds of a (possibly rotated) solid. */
function bounds(s: Solid): { min: Vec3; max: Vec3 } {
  const m = rotation(s);
  const h = [s.size.x / 2, s.size.y / 2, s.size.z / 2];
  const ext = [0, 1, 2].map((i) => Math.abs(m[i]![0]!) * h[0]! + Math.abs(m[i]![1]!) * h[1]! + Math.abs(m[i]![2]!) * h[2]!);
  return {
    min: vec3(s.center.x - ext[0]!, s.center.y - ext[1]!, s.center.z - ext[2]!),
    max: vec3(s.center.x + ext[0]!, s.center.y + ext[1]!, s.center.z + ext[2]!),
  };
}

const rectOf = (s: Solid): Rect => {
  const b = bounds(s);
  return { minX: b.min.x, minZ: b.min.z, maxX: b.max.x, maxZ: b.max.z };
};
const overlaps = (a: Rect, b: Rect): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const inRect = (p: Vec3, r: Rect): boolean => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
const solidAt = (p: Vec3): Solid | undefined => map.solids.find((s) => insideSolid(p, s));

/** Distance from `from` straight down to the first surface (0 when `from` is inside a solid), or null. */
function dropTo(from: Vec3, max = 200): number | null {
  const hit = physics.world.castRay(new rapier.Ray(from, { x: 0, y: -1, z: 0 }), max, true);
  return hit ? hit.timeOfImpact : null;
}

const districtRect = (d: District): Rect => {
  const found = src.districts.find((x) => x.district === d);
  if (!found) throw new Error(`no district ${d}`);
  return found.rect;
};

const byId = (id: string): Solid => {
  const s = map.solids.find((x) => x.id === id);
  if (!s) throw new Error(`no solid ${id}`);
  return s;
};
const top = (s: Solid): number => s.center.y + s.size.y / 2;

describe('greybox city: POIs', () => {
  it('has 18–22 POIs with unique ids, ≥ 4 in each of downtown/harbor/hillside/suburbs, all four kinds', () => {
    expect(map.pois.length).toBeGreaterThanOrEqual(18);
    expect(map.pois.length).toBeLessThanOrEqual(22);
    expect(new Set(map.pois.map((p) => p.id)).size).toBe(map.pois.length);
    for (const d of DISTRICTS) {
      const inD = map.pois.filter((p) => p.district === d);
      expect(inD.length, d).toBeGreaterThanOrEqual(4);
      for (const p of inD) expect(inRect(p.position, districtRect(d)), `${p.id} lies in ${d}`).toBe(true);
    }
    expect(new Set(map.pois.map((p) => p.kind))).toEqual(new Set(['door', 'mailbox', 'counter', 'balcony']));
  });

  it('has ≥ 5 POIs in each band by street distance from the HUB', () => {
    const table = buildPoiTable(map, streetDistance, ordersConfig.bands);
    for (const band of ['short', 'medium', 'long'] as const) {
      expect(table.filter((t) => t.band === band).length, band).toBeGreaterThanOrEqual(5);
    }
  });

  it('no POI is inside a solid, and each has ground within 0.5 m below', () => {
    for (const p of map.pois) {
      const lifted = vec3(p.position.x, p.position.y + 0.05, p.position.z);
      expect(solidAt(lifted)?.id, `${p.id} inside a solid`).toBeUndefined();
      // Standing room: the capsule height above the ground point is free too.
      expect(solidAt(vec3(p.position.x, p.position.y + 1.7, p.position.z))?.id, `${p.id} headroom`).toBeUndefined();
      const drop = dropTo(vec3(p.position.x, p.position.y + 0.25, p.position.z), 10);
      expect(drop, `${p.id} has ground below`).not.toBeNull();
      expect(drop! - 0.25, `${p.id} ground gap`).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('greybox city: features', () => {
  it('has ≥ 6 zip lines (≥ 2 longer than 80 m), ≥ 8 jump pads, ≥ 10 orbs, ≥ 3 chutes, ≥ 6 rails', () => {
    expect(map.zipLines.length).toBeGreaterThanOrEqual(6);
    expect(map.zipLines.filter((z) => distance(z.a, z.b) > 80).length).toBeGreaterThanOrEqual(2);
    expect(map.jumpPads.length).toBeGreaterThanOrEqual(8);
    expect(map.boostOrbs.length).toBeGreaterThanOrEqual(10);
    expect(map.solids.filter((s) => s.kind === 'chute').length).toBeGreaterThanOrEqual(3);
    expect(map.rails.length).toBeGreaterThanOrEqual(6);
  });

  it('prefixes every feature id with its area and keeps ids unique', () => {
    const ids = [
      ...handPlaced.map((s) => s.id),
      ...map.zipLines.map((f) => f.id),
      ...map.jumpPads.map((f) => f.id),
      ...map.boostOrbs.map((f) => f.id),
      ...map.rails.map((f) => f.id),
      ...map.checkpoints.map((f) => f.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(hub|downtown|harbor|hillside|suburbs)-/);
  });

  it('has ≥ 1 checkpoint per district plus one at the HUB', () => {
    const hubCps = map.checkpoints.filter((c) => c.id.startsWith('hub-'));
    expect(hubCps.some((c) => Math.hypot(c.position.x - map.hub.center.x, c.position.z - map.hub.center.z) <= map.hub.plazaRadius)).toBe(true);
    for (const d of DISTRICTS) {
      const cps = map.checkpoints.filter((c) => c.id.startsWith(`${d}-`));
      expect(cps.length, d).toBeGreaterThanOrEqual(1);
      for (const c of cps) expect(inRect(c.position, districtRect(d)), c.id).toBe(true);
    }
    for (const c of map.checkpoints) {
      expect(solidAt(vec3(c.position.x, c.position.y + 0.05, c.position.z))?.id, c.id).toBeUndefined();
      const drop = dropTo(vec3(c.position.x, c.position.y + 0.25, c.position.z), 10);
      expect(drop, c.id).not.toBeNull();
      expect(drop! - 0.25, c.id).toBeLessThanOrEqual(0.5);
    }
  });

  it('keeps every feature inside the island (|x|, |z| ≤ size/2)', () => {
    const points = [
      ...map.zipLines.flatMap((z) => [z.a, z.b]),
      ...map.jumpPads.map((p) => p.position),
      ...map.boostOrbs.map((o) => o.position),
      ...map.rails.flatMap((r) => r.points),
      ...map.checkpoints.map((c) => c.position),
      ...map.pois.map((p) => p.position),
    ];
    for (const p of points) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(half);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(half);
    }
    for (const s of handPlaced) {
      const b = bounds(s);
      expect(Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z)), s.id).toBeLessThanOrEqual(half);
    }
  });

  it('has no zip line end or orb inside a solid, and every jump pad on a surface', () => {
    for (const z of map.zipLines) {
      expect(solidAt(z.a)?.id, `${z.id}.a`).toBeUndefined();
      expect(solidAt(z.b)?.id, `${z.id}.b`).toBeUndefined();
    }
    for (const o of map.boostOrbs) expect(solidAt(o.position)?.id, o.id).toBeUndefined();
    for (const p of map.jumpPads) {
      expect(solidAt(vec3(p.position.x, p.position.y + 0.05, p.position.z))?.id, p.id).toBeUndefined();
      const drop = dropTo(vec3(p.position.x, p.position.y + 0.1, p.position.z), 1);
      expect(drop, `${p.id} sits on a surface`).not.toBeNull();
      expect(drop!, p.id).toBeLessThanOrEqual(0.15);
    }
  });

  it('keeps every rail point clear of solids with a surface below', () => {
    for (const r of map.rails) {
      for (const p of r.points) {
        expect(solidAt(p)?.id, r.id).toBeUndefined();
        expect(dropTo(p), r.id).not.toBeNull();
      }
    }
  });
});

describe('greybox city: layout', () => {
  it('keeps the HUB plaza and the playground clear of generated buildings', () => {
    const c = map.hub.center;
    const plaza: Rect = { minX: c.x - 30, minZ: c.z - 30, maxX: c.x + 30, maxZ: c.z + 30 };
    // The playground: every hand-placed HUB solid except the kiosk, which stands on the plaza.
    const hubSolids = handPlaced.filter((s) => s.id.startsWith('hub-') && s.id !== 'hub-kiosk').map(rectOf);
    const playground: Rect = {
      minX: Math.min(...hubSolids.map((r) => r.minX)),
      minZ: Math.min(...hubSolids.map((r) => r.minZ)),
      maxX: Math.max(...hubSolids.map((r) => r.maxX)),
      maxZ: Math.max(...hubSolids.map((r) => r.maxZ)),
    };
    expect(playground.minX).toBeGreaterThanOrEqual(c.x);
    for (const b of generated) {
      expect(overlaps(rectOf(b), plaza), b.id).toBe(false);
      expect(overlaps(rectOf(b), playground), b.id).toBe(false);
    }
  });

  it('never overlaps a generated building with a hand-placed solid', () => {
    for (const b of generated) {
      for (const s of handPlaced) expect(overlaps(rectOf(b), rectOf(s)), `${b.id} vs ${s.id}`).toBe(false);
    }
  });

  it('builds the movement playground kit east of the HUB', () => {
    expect(top(byId('hub-mantle-01'))).toBe(1.0);
    expect(top(byId('hub-mantle-02'))).toBe(1.5);
    expect(top(byId('hub-mantle-03'))).toBe(1.8);
    const [w1, w2] = [byId('hub-wall-01'), byId('hub-wall-02')];
    for (const w of [w1, w2]) {
      expect(Math.max(w.size.x, w.size.z)).toBe(20);
      expect(w.size.y).toBe(6);
    }
    const gap = Math.abs(w1.center.z - w2.center.z) - (w1.size.z + w2.size.z) / 2;
    expect(gap).toBeCloseTo(4, 6);
    const roof = byId('hub-tunnel-roof');
    expect(roof.center.y - roof.size.y / 2).toBe(1.4);
    expect(top(byId('hub-tower-01'))).toBe(12);
    expect(handPlaced.some((s) => s.id.startsWith('hub-') && s.kind === 'chute')).toBe(true);
    expect(map.zipLines.some((z) => z.id.startsWith('hub-'))).toBe(true);
    expect(map.boostOrbs.filter((o) => o.id.startsWith('hub-')).length).toBeGreaterThanOrEqual(3);
    expect(map.rails.some((r) => r.id.startsWith('hub-'))).toBe(true);
    expect(handPlaced.some((s) => s.id.startsWith('hub-') && s.kind === 'ramp')).toBe(true);
  });

  it('keeps every ramp walkable, and hillside ramp streets at ≤ 25°', () => {
    for (const s of handPlaced.filter((x) => x.kind === 'ramp')) {
      const m = rotation(s);
      const tilt = (Math.acos(Math.min(1, Math.abs(m[1]![1]!))) * 180) / Math.PI;
      expect(tilt, s.id).toBeLessThan(cfg.controller.maxSlopeClimbDeg);
      if (s.id.startsWith('hillside-')) expect(tilt, s.id).toBeLessThanOrEqual(25.001);
    }
    expect(top(byId('hillside-plateau'))).toBe(20);
  });

  it('has a reserved skatepark in the suburbs with at least 3 rails', () => {
    expect(map.rails.filter((r) => r.id.startsWith('suburbs-')).length).toBeGreaterThanOrEqual(3);
  });

  it('places a solid kiosk at the HUB, reachable from open ground', () => {
    const kiosk = byId('hub-kiosk');
    expect(insideSolid(vec3(map.hub.kiosk.x, map.hub.kiosk.y + 0.5, map.hub.kiosk.z), kiosk)).toBe(true);
    // In front of the kiosk (toward the plaza centre) there is free ground within kioskRange.
    const k = map.hub.kiosk;
    const c = map.hub.center;
    const d = Math.hypot(c.x - k.x, c.z - k.z);
    const front = vec3(k.x + ((c.x - k.x) / d) * 1.5, 0, k.z + ((c.z - k.z) / d) * 1.5);
    expect(solidAt(vec3(front.x, 0.5, front.z))).toBeUndefined();
    expect(Math.hypot(front.x - k.x, front.z - k.z)).toBeLessThanOrEqual(map.hub.kioskRange);
  });
});
