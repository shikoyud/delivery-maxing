import { beforeAll, describe, expect, it } from 'vitest';
import greyboxJson from '../../../../map/greybox.json';
import { movementConfig as cfg, ridingConfig } from '../../src/config';
import { vec3, type Vec3 } from '../../src/math/vec3';
import { facing } from '../../src/movement/ground';
import { baySlot, zoneAt } from '../../src/world/access';
import { streetDistance } from '../../src/world/distance';
import { expandGreybox } from '../../src/world/greybox';
import type { AccessZone, District, GreyboxSource, MapData, Rect, Solid } from '../../src/world/mapTypes';
import { createPhysicsWorld, initRapier, type PhysicsWorld, type Rapier } from '../../src/world/physicsWorld';

const src = greyboxJson as unknown as GreyboxSource;
const map: MapData = expandGreybox(src);
const half = map.size / 2;
const generated = map.solids.filter((s) => s.kind === 'building' && /^b-/.test(s.id));
const hospitalBlocks = map.solids.filter((s) => s.kind === 'hospital');
const handPlaced = map.solids.filter((s) => s.id !== 'ground' && !generated.includes(s) && !hospitalBlocks.includes(s));
const DISTRICTS: District[] = ['downtown', 'harbor', 'hillside', 'suburbs'];

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
/** Height of the SP4 test town terrace (top of town-terrace). */
const TERRACE_TOP = 5;

describe('greybox city: hospitals', () => {
  it('has 4 hospitals with distinct names and spawns on the ground', () => {
    expect(map.hospitals).toHaveLength(4);
    expect(new Set(map.hospitals.map((h) => h.name)).size).toBe(4);
    expect(new Set(map.hospitals.map((h) => h.id)).size).toBe(4);
    for (const h of map.hospitals) {
      expect(h.safeRadius, h.id).toBe(18);
      expect(Math.hypot(h.spawn.x - h.center.x, h.spawn.z - h.center.z), h.id).toBeCloseTo(8, 6);
      for (const p of [h.spawn]) {
        expect(solidAt(vec3(p.x, p.y + 0.05, p.z))?.id, `${h.id} inside a solid`).toBeUndefined();
        expect(solidAt(vec3(p.x, p.y + 1.7, p.z))?.id, `${h.id} headroom`).toBeUndefined();
        const drop = dropTo(vec3(p.x, p.y + 0.25, p.z), 10);
        expect(drop, `${h.id} has ground below`).not.toBeNull();
        expect(drop! - 0.25, `${h.id} ground gap`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('has a solid hospital block at each hospital centre that a ray from the spawn hits at the block face', () => {
    expect(hospitalBlocks).toHaveLength(map.hospitals.length);
    for (const h of map.hospitals) {
      expect(solidAt(vec3(h.center.x, h.center.y + 1, h.center.z))?.kind, `${h.id} block`).toBe('hospital');
      const from = { x: h.spawn.x, y: h.spawn.y + 1, z: h.spawn.z };
      const dx = h.center.x - h.spawn.x;
      const dz = h.center.z - h.spawn.z;
      const len = Math.hypot(dx, dz);
      const hit = physics.world.castRay(new rapier.Ray(from, { x: dx / len, y: 0, z: dz / len }), len, true);
      expect(hit, `${h.id} ray hits the block`).not.toBeNull();
      expect(hit!.timeOfImpact, h.id).toBeCloseTo(len - src.hospitalBlock.z / 2, 4);
    }
  });

  it('each hospital spawn faces away from its block, with 20 m of open street ahead', () => {
    for (const h of map.hospitals) {
      const f = facing(h.spawnYaw);
      const out = { x: h.spawn.x - h.center.x, z: h.spawn.z - h.center.z };
      expect(f.x * out.x + f.z * out.z, `${h.id} faces outward`).toBeCloseTo(Math.hypot(out.x, out.z), 6);
      for (const y of [0.05, 0.5, 1.7]) {
        const hit = physics.world.castRay(new rapier.Ray({ x: h.spawn.x, y, z: h.spawn.z }, f), 20, true);
        expect(hit, `${h.id} open ahead at ${y} m`).toBeNull();
      }
    }
  });

  it('keeps hospital blocks clear of generated buildings, hand-placed solids and POIs', () => {
    for (const b of hospitalBlocks) {
      for (const s of [...generated, ...handPlaced]) expect(overlaps(rectOf(b), rectOf(s)), `${b.id} vs ${s.id}`).toBe(false);
      for (const p of map.pois) expect(insideSolid(vec3(p.position.x, 0.5, p.position.z), b, -1), `${p.id} near ${b.id}`).toBe(false);
    }
  });

  it('puts at least one hospital in each district', () => {
    for (const d of DISTRICTS) {
      expect(map.hospitals.filter((h) => inRect(h.center, districtRect(d))).length, d).toBeGreaterThanOrEqual(1);
    }
  });

  it('has the greybox order rules', () => {
    expect(map.orderRules).toEqual({
      bands: { shortMax: 150, mediumMax: 350 },
      foodDropoff: { min: 180, max: 520 },
      packageDropoff: { min: 150, max: 650 },
      maxPickupDistance: 400,
    });
  });

  it('every pickup has a few dropoff pairs inside its distance window (the longer minimums never starve offers)', () => {
    const pairs = (pickupRole: string, dropoffRole: string, w: { min: number; max: number }): number[] =>
      map.pois
        .filter((p) => (p.roles as string[]).includes(pickupRole))
        .map(
          (p) =>
            map.pois.filter((d) => {
              if (d.id === p.id || !(d.roles as string[]).includes(dropoffRole)) return false;
              const dist = streetDistance(p.position, d.position);
              return dist >= w.min && dist <= w.max;
            }).length,
        );
    for (const n of pairs('foodPickup', 'dropoffFood', map.orderRules.foodDropoff)) expect(n).toBeGreaterThanOrEqual(3);
    for (const n of pairs('packagePickup', 'dropoffPackage', map.orderRules.packageDropoff)) expect(n).toBeGreaterThanOrEqual(3);
  });

  it('has at least 2 food pickups within maxPickupDistance of every hospital spawn (one used pickup never starves it)', () => {
    for (const h of map.hospitals) {
      const near = map.pois.filter(
        (p) => p.roles.includes('foodPickup') && streetDistance(h.spawn, p.position) <= map.orderRules.maxPickupDistance,
      );
      expect(near.length, h.id).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('greybox city: POIs', () => {
  it('has unique ids and names, and at least 4 POIs in each district', () => {
    expect(new Set(map.pois.map((p) => p.id)).size).toBe(map.pois.length);
    expect(new Set(map.pois.map((p) => p.name)).size).toBe(map.pois.length);
    for (const d of DISTRICTS) {
      const inD = map.pois.filter((p) => p.district === d);
      expect(inD.length, d).toBeGreaterThanOrEqual(4);
      for (const p of inD) expect(inRect(p.position, districtRect(d)), `${p.id} lies in ${d}`).toBe(true);
    }
  });

  it('every POI has at least one role, a name, and a ground-level position reachable without parkour', () => {
    for (const p of map.pois) {
      expect(p.roles.length, p.id).toBeGreaterThanOrEqual(1);
      expect(p.name.length, p.id).toBeGreaterThan(0);
      expect(['door', 'counter'], p.id).toContain(p.kind);
      // Town terrace doors stand on the 5 m terrace; every other POI is at street level.
      expect(p.position.y, `${p.id} street level`).toBeLessThanOrEqual(p.id.startsWith('town-') ? 5 : 1.2);
      expect(Math.abs(p.position.x)).toBeLessThanOrEqual(half);
      expect(Math.abs(p.position.z)).toBeLessThanOrEqual(half);
    }
  });

  it('no POI is inside a solid, and each has ground within 0.5 m below', () => {
    for (const p of map.pois) {
      const lifted = vec3(p.position.x, p.position.y + 0.05, p.position.z);
      expect(solidAt(lifted)?.id, `${p.id} inside a solid`).toBeUndefined();
      expect(solidAt(vec3(p.position.x, p.position.y + 1.7, p.position.z))?.id, `${p.id} headroom`).toBeUndefined();
      const drop = dropTo(vec3(p.position.x, p.position.y + 0.25, p.position.z), 10);
      expect(drop, `${p.id} has ground below`).not.toBeNull();
      expect(drop! - 0.25, `${p.id} ground gap`).toBeLessThanOrEqual(0.5);
    }
  });

  it('food pickups carry items; package pickups carry items and a weightKg range within [1,150]', () => {
    for (const p of map.pois.filter((q) => q.roles.includes('foodPickup'))) {
      expect(p.items?.length, p.id).toBeGreaterThanOrEqual(1);
    }
    for (const p of map.pois.filter((q) => q.roles.includes('packagePickup'))) {
      expect(p.items?.length, p.id).toBeGreaterThanOrEqual(1);
      expect(p.weightKg, p.id).toBeDefined();
      const [lo, hi] = p.weightKg!;
      expect(lo, p.id).toBeGreaterThanOrEqual(1);
      expect(hi, p.id).toBeLessThanOrEqual(150);
      expect(lo, p.id).toBeLessThanOrEqual(hi);
    }
  });

  it('has at least 6 pickups (4 food, 2 package) and 14 dropoffs, with some food-only dropoffs', () => {
    const has = (role: string) => map.pois.filter((p) => (p.roles as string[]).includes(role));
    expect(has('foodPickup').length).toBeGreaterThanOrEqual(4);
    expect(has('packagePickup').length).toBeGreaterThanOrEqual(2);
    const dropoffs = map.pois.filter((p) => p.roles.some((r) => r === 'dropoffFood' || r === 'dropoffPackage'));
    expect(dropoffs.length).toBeGreaterThanOrEqual(14);
    expect(map.pois.filter((p) => p.roles.length === 1 && p.roles[0] === 'dropoffFood').length).toBeGreaterThanOrEqual(2);
    for (const p of [...has('foodPickup'), ...has('packagePickup')]) expect(dropoffs).not.toContain(p);
  });
});

describe('greybox city: schema v2', () => {
  it('has no chute solids, and no feature arrays remain', () => {
    expect(map.solids.some((s) => (s.kind as string) === 'chute')).toBe(false);
    expect(map.solids.some((s) => 'surface' in s)).toBe(false);
    for (const key of ['zipLines', 'jumpPads', 'boostOrbs', 'rails', 'checkpoints', 'spawn']) {
      expect(key in (src as object), key).toBe(false);
      expect(key in (map as object), key).toBe(false);
    }
  });

  it('keeps hand-placed solid ids unique and prefixed with their area', () => {
    const ids = handPlaced.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(downtown|harbor|hillside|suburbs|town)-/);
  });

  it('keeps every hand-placed solid inside the island', () => {
    for (const s of handPlaced) {
      const b = bounds(s);
      expect(Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z)), s.id).toBeLessThanOrEqual(half);
    }
  });
});

describe('greybox city: layout', () => {
  it('never overlaps a generated building with a hand-placed solid', () => {
    for (const b of generated) {
      for (const s of handPlaced) expect(overlaps(rectOf(b), rectOf(s)), `${b.id} vs ${s.id}`).toBe(false);
    }
  });

  it('keeps every ramp walkable, and hillside and town ramp streets at <= 25 degrees', () => {
    for (const s of handPlaced.filter((x) => x.kind === 'ramp')) {
      const m = rotation(s);
      const tilt = (Math.acos(Math.min(1, Math.abs(m[1]![1]!))) * 180) / Math.PI;
      expect(tilt, s.id).toBeLessThan(cfg.controller.maxSlopeClimbDeg);
      if (/^(hillside|town)-/.test(s.id)) expect(tilt, s.id).toBeLessThanOrEqual(25.001);
    }
    expect(top(byId('town-terrace'))).toBe(TERRACE_TOP);
  });
});

describe('greybox city: walkability', () => {
  /**
   * Flood fill over a 2 m grid of standable, headroom-clear ground points (neighbouring cells may differ by at most
   * 0.4 m of ground height, so ramps up to ~20 degrees pass and building walls do not), starting at the first
   * hospital spawn. Every other hospital spawn and every POI must have a reached cell within one cell.
   */
  const CELL = 2;
  const STEP = 0.4;
  const cellKey = (i: number, j: number): string => `${i},${j}`;
  const groundAt = (x: number, z: number): number | null => {
    if (Math.abs(x) > half || Math.abs(z) > half) return null;
    const hit = physics.world.castRay(new rapier.Ray({ x, y: 30, z }, { x: 0, y: -1, z: 0 }), 60, true);
    if (!hit) return null;
    const y = 30 - hit.timeOfImpact;
    const up = physics.world.castRay(new rapier.Ray({ x, y: y + 0.05, z }, { x: 0, y: 1, z: 0 }), 1.7, true);
    return up ? null : y;
  };

  it('reaches every other hospital spawn and every POI from the first hospital spawn on foot', () => {
    const start = map.hospitals[0]!.spawn;
    const reached = new Map<string, number>();
    const si = Math.round(start.x / CELL);
    const sj = Math.round(start.z / CELL);
    const y0 = groundAt(si * CELL, sj * CELL);
    expect(y0, 'start is standable').not.toBeNull();
    reached.set(cellKey(si, sj), y0!);
    const queue: [number, number][] = [[si, sj]];
    while (queue.length) {
      const [i, j] = queue.pop()!;
      const y = reached.get(cellKey(i, j))!;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = cellKey(i + di, j + dj);
        if (reached.has(k)) continue;
        const ny = groundAt((i + di) * CELL, (j + dj) * CELL);
        if (ny === null || Math.abs(ny - y) > STEP) continue;
        reached.set(k, ny);
        queue.push([i + di, j + dj]);
      }
    }
    const near = (p: Vec3): boolean => {
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (reached.has(cellKey(Math.round(p.x / CELL) + di, Math.round(p.z / CELL) + dj))) return true;
        }
      }
      return false;
    };
    for (const h of map.hospitals) expect(near(h.spawn), `${h.id} spawn reachable`).toBe(true);
    for (const p of map.pois) expect(near(p.position), `${p.id} reachable`).toBe(true);
  });
});

describe('greybox city: SP4 test town and gas stations', () => {
  const TERRACE = TERRACE_TOP;
  const zoneById = (id: string): AccessZone => {
    const z = map.accessZones.find((x) => x.id === id);
    if (!z) throw new Error(`no access zone ${id}`);
    return z;
  };
  const tiltRad = (s: Solid): number => Math.acos(Math.min(1, Math.abs(rotation(s)[1]![1]!)));
  /** A ramp tilted about one horizontal axis: grade (rise / run), width across the slope and its top-surface ends. */
  const ramp = (s: Solid): { grade: number; width: number; low: Vec3; high: Vec3 } => {
    const r = s.rotationDeg ?? vec3(0, 0, 0);
    expect(r.y, s.id).toBe(0);
    expect(r.x === 0 || r.z === 0, `${s.id} tilts about one axis`).toBe(true);
    const aboutZ = r.z !== 0;
    const m = rotation(s);
    const end = (sign: number): Vec3 => {
      const l = aboutZ ? [(sign * s.size.x) / 2, s.size.y / 2, 0] : [0, s.size.y / 2, (sign * s.size.z) / 2];
      const w = [0, 1, 2].map((i) => m[i]![0]! * l[0]! + m[i]![1]! * l[1]! + m[i]![2]! * l[2]!);
      return vec3(s.center.x + w[0]!, s.center.y + w[1]!, s.center.z + w[2]!);
    };
    const [a, b] = [end(-1), end(1)];
    return { grade: Math.tan(tiltRad(s)), width: aboutZ ? s.size.z : s.size.x, low: a.y < b.y ? a : b, high: a.y < b.y ? b : a };
  };
  const rectInside = (inner: Rect, outer: Rect): boolean =>
    inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minZ >= outer.minZ && inner.maxZ <= outer.maxZ;
  const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const car = ridingConfig.rides.car.collider;
  /** Ground rect a parked car (lengthwise capsule) covers at a slot. */
  const slotRect = (p: Vec3, heading: number): Rect => {
    const f = facing(heading);
    const along = car.halfLength + car.radius;
    const ex = Math.abs(f.x) * along + Math.abs(f.z) * car.radius;
    const ez = Math.abs(f.z) * along + Math.abs(f.x) * car.radius;
    return { minX: p.x - ex, maxX: p.x + ex, minZ: p.z - ez, maxZ: p.z + ez };
  };
  const stairs = (): Solid[] =>
    map.solids.filter((s) => /^town-stair-\d\d$/.test(s.id)).sort((a, b) => top(a) - top(b));
  const rampTop = (): Vec3 => ramp(byId('town-ramp')).high;

  it('road ramp grade is 9 % ± 0.3 % and 12 m wide', () => {
    const r = ramp(byId('town-ramp'));
    expect(byId('town-ramp').kind).toBe('ramp');
    expect(Math.abs(r.grade - 0.09)).toBeLessThanOrEqual(0.003);
    expect(r.width).toBe(12);
    expect(r.low.y).toBeCloseTo(0, 2);
    expect(r.high.y).toBeCloseTo(TERRACE, 2);
    expect(top(byId('town-terrace'))).toBe(TERRACE);
  });

  it('steep lane grade is 14 % ± 0.3 %, 6 m wide, and fully inside zone town-steep-lane', () => {
    const lane = byId('town-steep-lane');
    const r = ramp(lane);
    expect(lane.kind).toBe('ramp');
    expect(Math.abs(r.grade - 0.14)).toBeLessThanOrEqual(0.003);
    expect(r.width).toBe(6);
    expect(r.low.y).toBeCloseTo(0, 2);
    expect(r.high.y).toBeCloseTo(TERRACE, 2);
    const z = zoneById('town-steep-lane');
    expect(z.kind).toBe('steepLane');
    expect(rectInside(rectOf(lane), z.rect)).toBe(true);
  });

  it('stairs: 20 steps of 0.25 m rise, 0.35 m tread, inside zone town-stairs', () => {
    const steps = stairs();
    expect(steps.map((s) => s.id).sort()).toEqual(Array.from({ length: 20 }, (_, i) => `town-stair-${String(i + 1).padStart(2, '0')}`));
    const z = zoneById('town-stairs');
    expect(z.kind).toBe('stairs');
    const runX = steps[0]!.center.x !== steps[1]!.center.x;
    steps.forEach((s, i) => {
      expect(s.kind, s.id).toBe('prop');
      expect(s.rotationDeg, s.id).toBeUndefined();
      expect(top(s), s.id).toBeCloseTo(0.25 * (i + 1), 6);
      expect(s.center.y - s.size.y / 2, s.id).toBeCloseTo(0, 6);
      expect(runX ? s.size.x : s.size.z, `${s.id} tread`).toBeCloseTo(0.35, 6);
      expect(runX ? s.size.z : s.size.x, `${s.id} width`).toBe(4);
      expect(rectInside(rectOf(s), z.rect), `${s.id} in zone`).toBe(true);
      if (i > 0) {
        const prev = steps[i - 1]!;
        expect(Math.hypot(s.center.x - prev.center.x, s.center.z - prev.center.z), `${s.id} tread step`).toBeCloseTo(0.35, 6);
      }
    });
    expect(top(steps[19]!)).toBe(TERRACE);
  });

  it('two gas stations, each with 2 pumps on open ground (no solid within 0.5 m of a pump point)', () => {
    expect(map.gasStations.map((g) => [g.id, g.name])).toEqual([
      ['town-gas', 'Hilltop Fuel Stop'],
      ['harbor-gas', 'Bayline Fuel'],
    ]);
    // A 0.5 m radius column from just above the ground to 3 m up around each pump.
    const probe = new rapier.Capsule(1, 0.5);
    for (const g of map.gasStations) {
      const canopy = byId(`${g.id}-canopy`);
      expect(canopy.center.y - canopy.size.y / 2, g.id).toBeCloseTo(5, 6);
      expect(top(canopy), g.id).toBeCloseTo(5.4, 6);
      expect(g.pumps, g.id).toHaveLength(2);
      for (const p of g.pumps) {
        const label = `${g.id} pump (${p.x}, ${p.z})`;
        expect(Math.hypot(p.x - g.position.x, p.z - g.position.z), label).toBeLessThanOrEqual(9);
        const drop = dropTo(vec3(p.x, p.y + 0.25, p.z), 10);
        expect(drop, label).not.toBeNull();
        expect(drop! - 0.25, label).toBeLessThanOrEqual(0.01);
        expect(physics.world.intersectionWithShape({ x: p.x, y: p.y + 1.55, z: p.z }, { x: 0, y: 0, z: 0, w: 1 }, probe), label).toBeNull();
        expect(zoneAt(map, p), label).toBeNull();
      }
    }
  });

  it('every hospital bay slot 0..3 stands on ground and fits a car capsule', () => {
    const shape = new rapier.Capsule(car.halfLength, car.radius);
    for (const h of map.hospitals) {
      for (let i = 0; i < 4; i++) {
        const { position: p, heading } = baySlot(h, i);
        const label = `${h.id} slot ${i}`;
        const drop = dropTo(vec3(p.x, p.y + 0.25, p.z), 10);
        expect(drop, label).not.toBeNull();
        expect(drop! - 0.25, label).toBeLessThanOrEqual(0.01);
        // Capsule axis (local +Y) turned 90° about (f.z, 0, -f.x) to lie along the heading.
        const f = facing(heading);
        const s = Math.SQRT1_2;
        const rot = { x: f.z * s, y: 0, z: -f.x * s, w: s };
        const at = { x: p.x, y: p.y + car.radius + 0.05, z: p.z };
        expect(physics.world.intersectionWithShape(at, rot, shape), label).toBeNull();
      }
    }
  });

  it('bay slots 0..3 stand clear of the line a courier walks from the spawn (20 m along spawnYaw)', () => {
    const clearance = car.radius + cfg.capsule.radius + 0.5;
    for (const h of map.hospitals) {
      const f = facing(h.spawnYaw);
      for (let i = 0; i < 4; i++) {
        const { position: p, heading } = baySlot(h, i);
        const a = facing(heading);
        // Samples along the car capsule's axis: their sideways distance from the walk line, where they lie along it.
        for (let k = -1; k <= 1; k += 0.25) {
          const q = vec3(p.x + a.x * car.halfLength * k, 0, p.z + a.z * car.halfLength * k);
          const dx = q.x - h.spawn.x;
          const dz = q.z - h.spawn.z;
          const along = dx * f.x + dz * f.z;
          if (along < -clearance || along > 20 + clearance) continue;
          expect(Math.abs(dx * f.z - dz * f.x), `${h.id} slot ${i}`).toBeGreaterThan(clearance);
        }
      }
    }
  });

  it('town POIs exist and town-poi-02 is within 30 m (straight line) of the ramp top', () => {
    const poi = (id: string) => {
      const p = map.pois.find((x) => x.id === id);
      if (!p) throw new Error(`no POI ${id}`);
      return p;
    };
    const p1 = poi('town-poi-01');
    const p2 = poi('town-poi-02');
    expect(p1.roles).toEqual(['dropoffFood']);
    expect(p1.position.y).toBe(TERRACE);
    const stairTop = stairs()[19]!.center;
    const stairTopPoint = vec3(stairTop.x, TERRACE, stairTop.z);
    // The stairs are its nearest way up: closer to the stair top than to the road ramp top.
    expect(dist(p1.position, stairTopPoint)).toBeLessThan(dist(p1.position, rampTop()));
    expect(dist(p1.position, stairTopPoint)).toBeLessThanOrEqual(15);
    expect(p2.roles).toEqual(expect.arrayContaining(['dropoffFood', 'dropoffPackage']));
    expect(p2.position.y).toBe(TERRACE);
    expect(dist(p2.position, rampTop())).toBeLessThanOrEqual(30);
  });

  it('no access zone overlaps a hospital safe zone or a bay slot', () => {
    for (const id of ['town-steep-lane', 'town-stairs', 'town-park-path', 'town-boardwalk']) zoneById(id);
    expect(zoneById('town-park-path').kind).toBe('path');
    expect(zoneById('town-boardwalk').kind).toBe('path');
    for (const z of map.accessZones) {
      for (const h of map.hospitals) {
        const dx = Math.max(z.rect.minX - h.center.x, 0, h.center.x - z.rect.maxX);
        const dz = Math.max(z.rect.minZ - h.center.z, 0, h.center.z - z.rect.maxZ);
        expect(Math.hypot(dx, dz), `${z.id} vs ${h.id} safe zone`).toBeGreaterThan(h.safeRadius);
        for (let i = 0; i < 4; i++) {
          const slot = baySlot(h, i);
          expect(overlaps(z.rect, slotRect(slot.position, slot.heading)), `${z.id} vs ${h.id} slot ${i}`).toBe(false);
        }
      }
    }
  });

  it('the park path and boardwalk end on car-legal ground at both ends', () => {
    for (const id of ['town-park-path', 'town-boardwalk']) {
      const z = zoneById(id);
      const r = z.rect;
      const alongX = r.maxX - r.minX > r.maxZ - r.minZ;
      const [mx, mz] = [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2];
      const ends = alongX ? [vec3(r.minX - 3, z.minY, mz), vec3(r.maxX + 3, z.minY, mz)] : [vec3(mx, z.minY, r.minZ - 3), vec3(mx, z.minY, r.maxZ + 3)];
      for (const e of ends) {
        const label = `${id} end (${e.x}, ${e.z})`;
        expect(zoneAt(map, e), label).toBeNull();
        const drop = dropTo(vec3(e.x, e.y + 0.25, e.z), 10);
        expect(drop, label).not.toBeNull();
        expect(drop! - 0.25, label).toBeLessThanOrEqual(0.01);
        expect(solidAt(vec3(e.x, e.y + 1.7, e.z))?.id, `${label} headroom`).toBeUndefined();
      }
    }
  });
});
