import { beforeAll, describe, expect, it } from 'vitest';
import greyboxJson from '../../../../map/greybox.json';
import { movementConfig as cfg, ordersConfig } from '../../src/config';
import { emptyInput } from '../../src/input/inputFrame';
import { closestOnSegment, distance, vec3, type Vec3 } from '../../src/math/vec3';
import { PlayerSim } from '../../src/movement/PlayerSim';
import { tryAttachZip } from '../../src/movement/zipLine';
import { createWorldFeatureState } from '../../src/movement/triggers';
import { NO_MODS } from '../../src/movement/types';
import { buildPoiInfo } from '../../src/world/distance';
import { streetDistanceTable } from '../../src/orders/distanceTable';
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
    const table = buildPoiInfo(map, streetDistanceTable(map), ordersConfig.bands.greybox);
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

describe('greybox city: zip lines', () => {
  const highEnd = (z: (typeof map.zipLines)[number]) => (z.a.y >= z.b.y ? { start: z.a, end: z.b } : { start: z.b, end: z.a });

  it('every zip start has a standing surface within reach of the hand', () => {
    const hand = cfg.capsule.height;
    for (const z of map.zipLines) {
      const { start, end } = highEnd(z);
      const len = distance(start, end);
      let reachable = false;
      // Look for a surface under the first 4 m of the cable where a standing player's hand reaches the cable.
      for (let s = 0; s <= Math.min(4, len) && !reachable; s += 0.25) {
        const k = s / len;
        const c = vec3(start.x + (end.x - start.x) * k, start.y + (end.y - start.y) * k, start.z + (end.z - start.z) * k);
        const drop = dropTo(c, 10);
        if (drop === null || drop <= 0) continue;
        const feet = vec3(c.x, c.y - drop, c.z);
        if (solidAt(vec3(feet.x, feet.y + 1, feet.z))) continue;
        reachable = closestOnSegment(vec3(feet.x, feet.y + hand, feet.z), z.a, z.b).dist <= cfg.zipLine.attachDistance;
      }
      expect(reachable, `${z.id} start is grabbable from a surface`).toBe(true);
    }
  });

  it('pressing interact anywhere near either end of a zip line within reach grabs that line (tryAttachZip)', () => {
    const simWorld = createPhysicsWorld(rapier, map); // the players' capsules stay out of the shared query world
    for (const z of map.zipLines) {
      for (const [name, start] of [['a', z.a], ['b', z.b]] as const) {
        let spots = 0;
        for (let dx = -3; dx <= 3; dx += 0.5) {
          for (let dz = -3; dz <= 3; dz += 0.5) {
            const drop = dropTo(vec3(start.x + dx, start.y, start.z + dz), 10);
            if (drop === null || drop <= 0) continue;
            const feet = vec3(start.x + dx, start.y - drop, start.z + dz);
            if (solidAt(vec3(feet.x, feet.y + 1, feet.z))) continue;
            const hand = vec3(feet.x, feet.y + cfg.capsule.height, feet.z);
            if (closestOnSegment(hand, z.a, z.b).dist > cfg.zipLine.attachDistance) continue;
            spots++;
            const other = name === 'a' ? z.b : z.a; // face along the line, away from this end (R7)
            const sim = new PlayerSim(simWorld, map, cfg, feet, Math.atan2(-(other.x - start.x), -(other.z - start.z)));
            const input = emptyInput();
            input.interact = { held: true, pressed: true };
            const at = `${z.id}.${name} grab at ${dx}, ${dz}`;
            expect(tryAttachZip(sim.state, input, map.zipLines, cfg), at).toBe(true);
            expect(sim.state.zip?.id, at).toBe(z.id);
          }
        }
        expect(spots, `${z.id}.${name} has standing spots in reach`).toBeGreaterThan(0);
      }
    }
  });

  it('no two zip cables come within 2 × attachDistance + 1 m of each other', () => {
    const minGap = 2 * cfg.zipLine.attachDistance + 1;
    const lines = map.zipLines;
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const [p, q] = [lines[i]!, lines[j]!];
        const len = distance(p.a, p.b);
        let closest = Infinity;
        for (let s = 0; s <= len; s += 0.25) {
          const k = s / len;
          const c = vec3(p.a.x + (p.b.x - p.a.x) * k, p.a.y + (p.b.y - p.a.y) * k, p.a.z + (p.b.z - p.a.z) * k);
          closest = Math.min(closest, closestOnSegment(c, q.a, q.b).dist);
        }
        expect(closest, `${p.id} vs ${q.id}`).toBeGreaterThanOrEqual(minGap);
      }
    }
  });

  it('every zip line clears everything below by the hang drop, ending 2.2 m to hangDrop + fragile.maxFallMeters above the landing', () => {
    const r = cfg.capsule.radius;
    for (const z of map.zipLines) {
      const len = distance(z.a, z.b);
      for (let s = 0; s <= len; s += 0.5) {
        const k = s / len;
        const c = vec3(z.a.x + (z.b.x - z.a.x) * k, z.a.y + (z.b.y - z.a.y) * k, z.a.z + (z.b.z - z.a.z) * k);
        for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]] as const) {
          const drop = dropTo(vec3(c.x + ox, c.y, c.z + oz));
          expect(drop === null || drop >= cfg.zipLine.hangDrop, `${z.id} clearance at ${s.toFixed(1)} m`).toBe(true);
        }
      }
      const { end } = highEnd(z);
      expect(dropTo(end)!, `${z.id} low end`).toBeGreaterThanOrEqual(2.2);
      // A drop from the low end (should the dismount ever miss) keeps a Fragile package intact.
      expect(dropTo(end)!, `${z.id} low end`).toBeLessThanOrEqual(cfg.zipLine.hangDrop + ordersConfig.fragile.maxFallMeters);
    }
  });

  it('every zip line can be ridden both ways from its ends and both ends dismount onto a standing surface (R5)', () => {
    for (const z of map.zipLines) for (const end of ['b', 'a'] as const) rideZip(z, end, 0);
  });

  it('after each dismount, holding W+Shift for 9 ticks keeps the courier on the platform (R6)', () => {
    for (const z of map.zipLines) for (const end of ['b', 'a'] as const) rideZip(z, end, 9);
  });
});

/**
 * Grabs `z` at the end opposite `to` facing along the line, rides it to `to` with no input and checks the exit: the
 * detach tick is a dismount (mode ground) next to the far end, then `sprintTicks` ticks of W+Shift along the ride and
 * 2 s idle. Throughout: no respawn, no landing with a fall over 0.1 m, feet never inside a solid off the line, and the
 * courier ends standing at the dismount height.
 */
function rideZip(z: (typeof map.zipLines)[number], to: 'a' | 'b', sprintTicks: number): void {
  const [from, target, dir] = to === 'b' ? [z.a, z.b, 1] : [z.b, z.a, -1];
  const label = `${z.id} -> ${to}${sprintTicks ? ` (W+Shift ${sprintTicks} ticks)` : ''}`;
  const feet = grabSpot(z, from, target);
  expect(feet, `${label}: a standing spot within reach of the cable near the start`).not.toBeNull();
  // Face along the line toward the target: facing(yaw) = (-sin yaw, 0, -cos yaw).
  const yaw = Math.atan2(-(target.x - from.x), -(target.z - from.z));
  const sim = new PlayerSim(createPhysicsWorld(rapier, map), map, cfg, feet!, yaw);
  const world = createWorldFeatureState(map);
  let tick = 0;
  const step = (interact = false, sprint = false) => {
    const input = emptyInput();
    input.look = { yaw, pitch: 0 };
    if (interact) input.interact = { held: true, pressed: true };
    if (sprint) {
      input.move = { x: 0, y: 1 };
      input.sprint = { held: true, pressed: !sim.state.sprinting };
    }
    const events = sim.step(input, NO_MODS, world, tick++ * sim.dt);
    expect(events.filter((e) => e.kind === 'respawned'), `${label}: respawned at tick ${tick}`).toEqual([]);
    for (const e of events) {
      if (e.kind === 'landed') expect(e.fallHeight, `${label}: fall at tick ${tick}`).toBeLessThanOrEqual(0.1);
    }
    const p = sim.state.position;
    if (sim.state.mode !== 'zipline') {
      expect(solidAt(vec3(p.x, p.y + 0.1, p.z))?.id, `${label}: feet inside a solid at tick ${tick}`).toBeUndefined();
    }
  };
  for (let i = 0; i < 3 && !sim.state.grounded; i++) step();
  step(true);
  expect(sim.state.zip, `${label}: grabbed`).toMatchObject({ id: z.id, dir });
  const rideTicks = Math.ceil((distance(z.a, z.b) / cfg.zipLine.baseSpeed) * cfg.tickRate) + 5;
  for (let i = 0; i < rideTicks && sim.state.mode === 'zipline'; i++) step();
  expect(sim.state.mode, `${label}: the ride ends in a dismount`).toBe('ground');
  const off = sim.state.position;
  expect(Math.hypot(off.x - target.x, off.z - target.z), `${label}: rode to the far end`).toBeLessThan(1);
  for (let i = 0; i < sprintTicks; i++) step(false, true);
  for (let i = 0; i < 2 * cfg.tickRate; i++) step();
  expect(sim.state.grounded, `${label}: standing after the exit`).toBe(true);
  expect(Math.abs(sim.state.position.y - off.y), `${label}: still on the dismount surface`).toBeLessThanOrEqual(0.05);
}

/**
 * Feet for a standing spot under the first 4 m of the cable from `from` (toward `to`) where a standing player's hand
 * reaches the cable and a standing capsule fits, or null.
 */
function grabSpot(z: (typeof map.zipLines)[number], from: Vec3, to: Vec3): Vec3 | null {
  const len = distance(from, to);
  for (let s = 0; s <= Math.min(4, len); s += 0.25) {
    const k = s / len;
    const c = vec3(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, from.z + (to.z - from.z) * k);
    const drop = dropTo(c, 10);
    if (drop === null || drop <= 0) continue;
    const feet = vec3(c.x, c.y - drop, c.z);
    if (solidAt(vec3(feet.x, feet.y + 0.1, feet.z)) || solidAt(vec3(feet.x, feet.y + 1, feet.z))) continue;
    if (closestOnSegment(vec3(feet.x, feet.y + cfg.capsule.height, feet.z), z.a, z.b).dist <= cfg.zipLine.attachDistance) {
      return feet;
    }
  }
  return null;
}

/** Where each jump pad should put the player: on top of this solid. Every pad must be listed. */
const PAD_TARGETS: Record<string, string> = {
  'hub-pad-01': 'hub-roof-01',
  'hillside-pad-01': 'hillside-terrace-01',
  'hillside-pad-02': 'hillside-plateau',
  'harbor-pad-01': 'harbor-crane-01-deck',
  'harbor-pad-02': 'harbor-crane-02-deck',
  'suburbs-pad-01': 'suburbs-watertower-01',
  // Downtown rooftop access lands on generated buildings (ids follow the map seed).
  'downtown-pad-01': 'b-2--2-3',
  'downtown-pad-02': 'b-2--2-1',
  'downtown-pad-03': 'b-0--2-1',
};

/** How the player holds input through a pad flight: nothing, W, or W + Shift, facing the launch direction. */
type PadHold = 'none' | 'forward' | 'sprint';
const PAD_HOLDS: PadHold[] = ['none', 'forward', 'sprint'];

interface Flight { hold: PadHold; position: Vec3; fallHeight: number }

/**
 * Runs a pad launch from standing on the pad; returns where the player first lands and the landing's fallHeight
 * (apex of the flight − landing height, the value the Fragile rule reads).
 */
function flyFromPad(padId: string, hold: PadHold = 'none'): Flight {
  const pad = map.jumpPads.find((p) => p.id === padId);
  if (!pad) throw new Error(`no pad ${padId}`);
  // facing(yaw) = (-sin yaw, 0, -cos yaw): face the launch's horizontal direction.
  const yaw = Math.atan2(-pad.launch.x, -pad.launch.z);
  // A fresh world per flight: a PlayerSim's capsule stays in its physics world and would block the next flight.
  const sim = new PlayerSim(createPhysicsWorld(rapier, map), map, cfg, pad.position, yaw);
  const world = createWorldFeatureState(map);
  let launched = false;
  for (let i = 0; i < 30 * 10; i++) {
    const input = emptyInput();
    input.look = { yaw, pitch: 0 };
    if (hold !== 'none') input.move = { x: 0, y: 1 };
    if (hold === 'sprint') input.sprint = { held: true, pressed: !sim.state.sprinting };
    const events = sim.step(input, NO_MODS, world, i * sim.dt);
    if (events.some((e) => e.kind === 'respawned')) throw new Error(`${padId} (${hold}): respawned at tick ${i}`);
    if (events.some((e) => e.kind === 'jumpPad')) {
      launched = true;
      continue;
    }
    const landed = events.find((e) => e.kind === 'landed');
    if (launched && landed) return { hold, position: { ...sim.state.position }, fallHeight: landed.fallHeight };
  }
  throw new Error(`${padId} (${hold}): no landing within 10 s (launched: ${launched})`);
}

/** Every pad flown with every input variant, once per run (the access graph reuses these). */
let flightCache: Map<string, Flight[]> | undefined;
function padFlights(): Map<string, Flight[]> {
  flightCache ??= new Map(map.jumpPads.map((pad) => [pad.id, PAD_HOLDS.map((h) => flyFromPad(pad.id, h))]));
  return flightCache;
}

/** Whether every variant of a pad's flight lands on its target with a Fragile-safe fall. */
function padSafe(padId: string): boolean {
  const t = PAD_TARGETS[padId];
  if (!t) return false;
  const s = byId(t);
  return (padFlights().get(padId) ?? []).every(
    (f) => Math.abs(f.position.y - top(s)) < 0.5 && inRect(f.position, rectOf(s)) && f.fallHeight <= ordersConfig.fragile.maxFallMeters,
  );
}

describe('greybox city: jump pads', () => {
  it('the playground pad lands the player on its 10 m roof', () => {
    const roof = byId('hub-roof-01');
    expect(top(roof)).toBe(10);
    const p = flyFromPad('hub-pad-01').position;
    expect(p.y).toBeCloseTo(10, 1);
    expect(inRect(p, rectOf(roof))).toBe(true);
  });

  it('every jump pad lands on its target with no input, W, or W + Shift held toward the launch, within the Fragile fall limit', () => {
    for (const pad of map.jumpPads) {
      const t = PAD_TARGETS[pad.id];
      expect(t, `${pad.id} has a PAD_TARGETS entry`).toBeDefined();
      const s = byId(t!);
      for (const { hold, position: p, fallHeight } of padFlights().get(pad.id)!) {
        expect(p.y, `${pad.id} (${hold}) lands on ${t}`).toBeCloseTo(top(s), 0);
        expect(inRect(p, rectOf(s)), `${pad.id} (${hold}) lands on ${t} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBe(true);
        expect(fallHeight, `${pad.id} (${hold}) fall`).toBeLessThanOrEqual(ordersConfig.fragile.maxFallMeters);
      }
    }
  });
});

/**
 * Access graph over standing surfaces: the street ('ground') and the top of every unrotated solid that is not
 * covered by a solid standing on it. Edges are the base movement kit (no upgrades):
 * - a climb onto a touching top at most jump height + mantle reach higher (onto a solid standing on the street,
 *   or from one top to a touching top);
 * - a jump across a gap of at most one alley (rising at most 0.5 m, or dropping at most fragile.maxFallMeters minus
 *   the jump height), or a walk-off drop of at most fragile.maxFallMeters (to the street or a touching top);
 * - a jump pad: the surface it sits on to its PAD_TARGETS solid, only when every simulated flight lands there with a
 *   fallHeight within fragile.maxFallMeters (zip lines: the two-way ride test above bounds their exits);
 * - a zip line: the surfaces under its two ends, both ways;
 * - a ramp (both ways) or a chute (down only): the surface at its high end to the one at its low end.
 */
const GROUND = 'ground';
const CLIMB = cfg.jump.height + cfg.mantle.maxHeight;
const JUMP_GAP = src.grid.alleyWidth;
const JUMP_RISE = 0.5;
const MAX_DROP = ordersConfig.fragile.maxFallMeters;

interface Top { id: string; rect: Rect; y: number; base: number }
const unrotated = (s: Solid): boolean => !s.rotationDeg || (s.rotationDeg.x === 0 && s.rotationDeg.y === 0 && s.rotationDeg.z === 0);
const rectGap = (a: Rect, b: Rect): number =>
  Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ));
const pointRect = (p: Vec3): Rect => ({ minX: p.x, minZ: p.z, maxX: p.x, maxZ: p.z });
const contains = (outer: Rect, inner: Rect): boolean =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minZ >= outer.minZ && inner.maxZ <= outer.maxZ;

function buildAccessGraph(): { tops: Top[]; edges: Map<string, Set<string>>; surfaceUnder: (p: Vec3) => string } {
  const all: Top[] = map.solids
    .filter((s) => s.id !== 'ground' && unrotated(s))
    .map((s) => ({ id: s.id, rect: rectOf(s), y: top(s), base: s.center.y - s.size.y / 2 }));
  const tops = all.filter((a) => !all.some((b) => b !== a && Math.abs(b.base - a.y) < 0.01 && contains(b.rect, a.rect)));
  const edges = new Map<string, Set<string>>();
  const link = (from: string, to: string): void => {
    if (from === to) return;
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from)!.add(to);
  };
  const surfaceUnder = (p: Vec3): string => {
    let best: Top | undefined;
    for (const t of tops) if (t.y <= p.y + 0.05 && inRect(p, t.rect) && (!best || t.y > best.y)) best = t;
    return best?.id ?? GROUND;
  };
  const topAt = (p: Vec3): string => {
    if (p.y < 0.3) return GROUND;
    const t = tops.find((x) => Math.abs(x.y - p.y) < 0.3 && rectGap(x.rect, pointRect(p)) <= 0.5);
    if (!t) throw new Error(`no surface at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`);
    return t.id;
  };

  for (const a of tops) {
    if (a.base < 0.05 && a.y <= CLIMB) link(GROUND, a.id);
    if (a.y <= MAX_DROP) link(a.id, GROUND);
    for (const b of tops) {
      if (a === b) continue;
      const gap = rectGap(a.rect, b.rect);
      const rise = b.y - a.y;
      if (gap === 0 && rise > 0 && rise <= CLIMB) link(a.id, b.id);
      if (gap === 0 && rise <= 0 && -rise <= MAX_DROP) link(a.id, b.id); // walk off onto a touching top
      // A jump across adds its apex to the fall.
      if (gap <= JUMP_GAP && rise <= JUMP_RISE && -rise <= MAX_DROP - cfg.jump.height) link(a.id, b.id);
    }
  }
  // A pad counts only when its simulated flights (all input variants) land on the target within the Fragile limit.
  for (const pad of map.jumpPads) {
    const t = PAD_TARGETS[pad.id];
    if (t && padSafe(pad.id)) link(surfaceUnder(pad.position), t);
  }
  // Zip lines ride both ways (the two-way ride test above checks both grabs and both exits).
  for (const z of map.zipLines) {
    link(surfaceUnder(z.a), surfaceUnder(z.b));
    link(surfaceUnder(z.b), surfaceUnder(z.a));
  }
  for (const s of map.solids.filter((x) => (x.kind === 'ramp' || x.kind === 'chute') && !unrotated(x))) {
    const m = rotation(s);
    const alongX = s.size.x >= s.size.z;
    const end = (sign: number): Vec3 => {
      const l = alongX ? [(sign * s.size.x) / 2, s.size.y / 2, 0] : [0, s.size.y / 2, (sign * s.size.z) / 2];
      const w = [0, 1, 2].map((i) => m[i]![0]! * l[0]! + m[i]![1]! * l[1]! + m[i]![2]! * l[2]!);
      return vec3(s.center.x + w[0]!, s.center.y + w[1]!, s.center.z + w[2]!);
    };
    const [e1, e2] = [end(1), end(-1)];
    const [hi, lo] = e1.y >= e2.y ? [e1, e2] : [e2, e1];
    const [h, l] = [topAt(hi), topAt(lo)];
    link(h, l);
    if (s.kind === 'ramp') link(l, h);
  }
  return { tops, edges, surfaceUnder };
}

function closure(start: string, edges: Map<string, Set<string>>): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const n of edges.get(queue.shift()!) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen;
}

describe('greybox city: access and exits', () => {
  const graph = () => {
    const g = buildAccessGraph();
    const reverse = new Map<string, Set<string>>();
    for (const [from, tos] of g.edges) {
      for (const to of tos) {
        if (!reverse.has(to)) reverse.set(to, new Set());
        reverse.get(to)!.add(from);
      }
    }
    return { ...g, reach: closure(GROUND, g.edges), exit: closure(GROUND, reverse) };
  };

  it('every POI is reachable from the street with the base kit, and has a way down with no fall over the Fragile limit', () => {
    const g = graph();
    for (const p of map.pois) {
      const node = g.surfaceUnder(vec3(p.position.x, p.position.y, p.position.z));
      if (p.position.y > 0.05) expect(node, `${p.id} stands on a solid`).not.toBe(GROUND);
      expect(g.reach.has(node), `${p.id} on ${node} is reachable`).toBe(true);
      expect(g.exit.has(node), `${p.id} on ${node} has a Fragile-safe way down`).toBe(true);
    }
  });

  it('every surface the base kit reaches has a Fragile-safe way back to the street (no dead-end roofs)', () => {
    const g = graph();
    const dead = [...g.reach].filter((n) => !g.exit.has(n));
    expect(dead).toEqual([]);
  });

  it('is not permissive: a tall roof with no pad or zip (b-2--2-0, 35.5 m) and the crane jibs are out of reach', () => {
    const g = graph();
    expect(top(byId('b-2--2-0'))).toBe(35.5);
    expect(g.reach.has('b-2--2-0')).toBe(false);
    expect(g.reach.has('harbor-crane-01-jib')).toBe(false);
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
