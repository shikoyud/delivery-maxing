import { readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  chunksOverlapping,
  movementConfig,
  parseCityMap,
  parsePieceCatalog,
  rotatedHalfExtents,
  solidRect,
  StreetGraph,
  ThiefSystem,
  mulberry32,
  thievesConfig,
  type CityMap,
  type Rect,
  type Solid,
} from '@dm/shared';
import { generateCity } from '../../src/city/generate';
import { arterialLines, landRect } from '../../src/city/layout';
import { parseCitySource } from '../../src/city/source';
import { stableStringify } from '../../src/city/stableJson';
import { arterialGraph } from '../../src/city/streets';
import { placeThiefSpawns } from '../../src/city/thiefSpawns';
import type { AssetsConfig } from '../../src/assets/pipeline';

// Runs the generator on the real committed inputs.
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), 'utf8'));
const src = parseCitySource(readJson('map/city.source.json'));
const pieces = parsePieceCatalog(readJson('map/pieces.json'));
const assetsCfg = JSON.parse(readFileSync(join(here, '../../assets.config.json'), 'utf8')) as AssetsConfig;

const EPS = 1e-6;
/** One sim tick, s. */
const DT = 1 / movementConfig.tickRate;
const overlaps = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
/** Shortest horizontal distance between two rects (0 when they touch or overlap). */
const rectGap = (a: Rect, b: Rect): number =>
  Math.hypot(Math.max(0, b.minX - a.maxX, a.minX - b.maxX), Math.max(0, b.minZ - a.maxZ, a.minZ - b.maxZ));

/** Street solids bucketed by every chunk they touch. */
function chunkIndex(solids: Solid[], size: number): Map<string, Rect[]> {
  const idx = new Map<string, Rect[]>();
  for (const s of solids) {
    const r = solidRect(s);
    for (const k of chunksOverlapping(r, size)) {
      const list = idx.get(k);
      if (list) list.push(r);
      else idx.set(k, [r]);
    }
  }
  return idx;
}
const near = (idx: Map<string, Rect[]>, r: Rect, pad: number, size: number): Rect[] => [
  ...new Set(
    chunksOverlapping({ minX: r.minX - pad, minZ: r.minZ - pad, maxX: r.maxX + pad, maxZ: r.maxZ + pad }, size).flatMap(
      (k) => idx.get(k) ?? [],
    ),
  ),
];

let city: CityMap;
beforeAll(() => {
  city = generateCity(src, pieces);
});

describe('generateCity on map/city.source.json', () => {
  it('same seed → byte-identical JSON', () => {
    expect(stableStringify(generateCity(src, pieces))).toBe(stableStringify(city));
  });

  it('a different seed changes the placement', () => {
    expect(stableStringify(generateCity({ ...src, seed: src.seed + 1 }, pieces))).not.toBe(stableStringify(city));
  });

  it('parseCityMap accepts the output', () => {
    expect(() => parseCityMap(JSON.parse(stableStringify(city)), pieces)).not.toThrow();
    expect(city.chunkSize).toBe(100);
    expect(city.kind).toBe('city');
  });

  it('every coordinate is rounded to 0.01', () => {
    const bad: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (typeof v === 'number') {
        if (Math.abs(Math.round(v * 100) - v * 100) > 1e-6) bad.push(`${path}=${v}`);
      } else if (Array.isArray(v)) v.forEach((e, i) => walk(e, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, e] of Object.entries(v)) walk(e, `${path}.${k}`);
    };
    walk(city, 'city');
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('the street graph is connected from the node nearest the hub', () => {
    const { nodes, edges } = city.streets;
    const c = city.hub.center;
    const start = nodes.reduce((a, b) => (Math.hypot(b.p.x - c.x, b.p.z - c.z) < Math.hypot(a.p.x - c.x, a.p.z - c.z) ? b : a));
    const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
    for (const e of edges) {
      adj.get(e.a)!.push(e.b);
      adj.get(e.b)!.push(e.a);
    }
    const seen = new Set([start.id]);
    const queue = [start.id];
    while (queue.length) {
      for (const n of adj.get(queue.shift()!)!) {
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    expect(nodes.length).toBeGreaterThan(100);
    expect(nodes.filter((n) => !seen.has(n.id)).map((n) => n.id)).toEqual([]);
  });

  it('no building collider overlaps a road, sidewalk or the plaza circle', () => {
    const size = city.chunkSize;
    const idx = chunkIndex(city.solids.filter((s) => s.kind === 'road' || s.kind === 'sidewalk'), size);
    const { center, plazaRadius } = city.hub;
    const hits: string[] = [];
    const colliders = city.solids.filter((s) => s.kind === 'building' && s.hidden);
    expect(colliders.length).toBeGreaterThanOrEqual(1500);
    for (const s of colliders) {
      const r = solidRect(s);
      if (near(idx, r, 0, size).some((q) => overlaps(r, q))) hits.push(`${s.id} overlaps a street`);
      const plaza = { minX: center.x, minZ: center.z, maxX: center.x, maxZ: center.z };
      if (rectGap(r, plaza) < plazaRadius) hits.push(`${s.id} is inside the plaza`);
    }
    expect(hits.slice(0, 5)).toEqual([]);
  });

  it('every chunk inside the land area has a ground tile, and none lies beyond a water edge', () => {
    const size = city.chunkSize;
    const half = city.size / 2;
    const quay = half - src.boundary.quayInset;
    const tiles = city.solids.filter((s) => s.kind === 'ground' && s.id.startsWith('ground-'));
    for (const t of tiles) {
      const r = solidRect(t);
      // East and south are water: no ground past the quay line
      expect(r.maxX, t.id).toBeLessThanOrEqual(quay + EPS);
      expect(r.maxZ, t.id).toBeLessThanOrEqual(quay + EPS);
      expect(t.center.y + t.size.y / 2, t.id).toBeCloseTo(0, 6);
    }
    const covered = new Set<string>();
    for (const t of tiles) {
      const r = solidRect(t);
      const keys = chunksOverlapping(r, size);
      expect(keys, t.id).toHaveLength(1);
      const [cx, cz] = keys[0]!.split(',').map(Number) as [number, number];
      const want = { minX: cx * size, minZ: cz * size, maxX: Math.min((cx + 1) * size, quay), maxZ: Math.min((cz + 1) * size, quay) };
      expect(r, t.id).toEqual(want);
      covered.add(keys[0]!);
    }
    for (let cx = -half / size; cx < half / size; cx++) {
      for (let cz = -half / size; cz < half / size; cz++) {
        if (cx * size < quay && cz * size < quay) expect(covered.has(`${cx},${cz}`), `${cx},${cz}`).toBe(true);
      }
    }
    expect(covered.size).toBe(tiles.length);
  });

  it('cliffs stand inside the north and west edges in segments of at most 100 m, cliffHeight tall', () => {
    const half = city.size / 2;
    const cliffs = city.solids.filter((s) => s.kind === 'cliff');
    expect(cliffs.length).toBeGreaterThanOrEqual(40);
    for (const c of cliffs) {
      const r = solidRect(c);
      expect(Math.max(r.maxX - r.minX, r.maxZ - r.minZ), c.id).toBeLessThanOrEqual(100 + EPS);
      expect(r.minX >= -half - EPS && r.maxX <= half + EPS && r.minZ >= -half - EPS && r.maxZ <= half + EPS, c.id).toBe(true);
      expect(r.minZ <= -half + EPS || r.minX <= -half + EPS, `${c.id} hugs the north or west edge`).toBe(true);
      expect(c.center.y + c.size.y / 2, c.id).toBeCloseTo(src.boundary.cliffHeight, 6);
    }
    // The whole north and west edges are walled (the west cliff starts where the north one ends)
    const len = (edge: 'north' | 'west') =>
      cliffs.filter((c) => c.id.startsWith(`cliff-${edge}-`)).map(solidRect)
        .reduce((sum, r) => sum + (edge === 'north' ? r.maxX - r.minX : r.maxZ - r.minZ), 0);
    expect(len('north')).toBeCloseTo(city.size, 6);
    expect(len('west')).toBeCloseTo(city.size - src.boundary.cliffDepth, 6);
  });

  it('flat roads (top 0.02 above their street level) and sidewalks (0.15) never cross a chunk border', () => {
    const streets = city.solids.filter((s) => s.kind === 'road' || s.kind === 'sidewalk');
    const levels = new Set(city.streets.nodes.map((n) => n.p.y));
    // Sloped road slabs are Hillside's steep-street ramps (its content test checks them)
    const sloped = streets.filter((s) => s.rotationDeg);
    expect(sloped.length).toBeGreaterThan(0);
    expect(sloped.every((s) => s.kind === 'road' && s.id.startsWith('hillside-'))).toBe(true);
    const flat = streets.filter((s) => !s.rotationDeg);
    expect(flat.length).toBeGreaterThan(500);
    for (const s of flat) {
      expect(chunksOverlapping(solidRect(s), city.chunkSize), s.id).toHaveLength(1);
      // A slab is centred on its street level and reaches as far above it as below
      expect(levels.has(s.center.y), `${s.id} at a street level`).toBe(true);
      expect(s.size.y / 2, s.id).toBeCloseTo(s.kind === 'road' ? 0.02 : 0.15, 6);
    }
    expect(flat.filter((s) => s.center.y === 0).length).toBeGreaterThan(500);
  });

  it('the hub ports the SP1 plaza, kiosk and drop zone, with a checkpoint at the spawn', () => {
    const { hub } = city;
    expect(hub.center).toEqual({ x: 0, y: 0, z: 0 });
    expect([hub.plazaRadius, hub.dropZoneRadius, hub.zoneHeight, hub.kioskRange, hub.spawnYaw]).toEqual([30, 6, 6, 3, 0]);
    expect(hub.kiosk).toEqual({ x: 0, y: 0, z: -8 });
    expect(hub.spawn.x).toBe(0);
    expect(hub.spawn.z).toBe(5);
    expect(hub).not.toHaveProperty('clearRadius');
    const kiosk = city.solids.find((s) => s.id === 'hub-kiosk')!;
    expect(kiosk).toMatchObject({ kind: 'hub', center: { x: 0, y: 0.53, z: -8 }, size: { x: 2.3, y: 1.05, z: 1.1 } });
    // The paving covers the plaza circle, and lots keep clear of its corners
    const paving = solidRect(city.solids.find((s) => s.id === 'hub-plaza')!);
    expect(paving).toEqual({ minX: -30, minZ: -30, maxX: 30, maxZ: 30 });
    expect(src.hub.clearRadius).toBeGreaterThan(Math.hypot(30, 30));
    expect(city.checkpoints.some((c) => c.position.x === hub.spawn.x && c.position.z === hub.spawn.z)).toBe(true);
  });

  it('a checkpoint stands at every arterial intersection on land', () => {
    const { pitch } = src.arterials;
    const at = new Set(city.checkpoints.map((c) => `${c.position.x},${c.position.z}`));
    for (let x = -800; x <= 800; x += pitch) {
      for (let z = -800; z <= 800; z += pitch) if (x !== 0 || z !== 0) expect(at.has(`${x},${z}`), `${x},${z}`).toBe(true);
    }
  });

  it('filler density: at least 1,500 building props', () => {
    const buildings = city.props.filter((p) => pieces[p.piece]!.kind === 'building');
    expect(buildings.length).toBeGreaterThanOrEqual(1500);
    expect(city.props.every((p) => pieces[p.piece]!.kind !== 'character')).toBe(true);
  });

  it('props use only the ten non-sign palettes, and each district gets several', () => {
    const tenNonSign = assetsCfg.palettes.map((p) => basename(p, extname(p))).slice(0, 10);
    expect(tenNonSign).not.toContain('Texture_Signs');
    expect(src.buildingPalettes).toEqual(tenNonSign);
    for (const p of city.props) expect(tenNonSign, p.id).toContain(p.palette);
    for (const d of src.districts) {
      expect(new Set(city.props.filter((p) => p.id.startsWith(`${d.district}-`)).map((p) => p.palette)).size).toBeGreaterThan(5);
    }
  });

  it('each prop has hidden collider solids matching its piece colliders under rotY and scale', () => {
    const solids = new Map(city.solids.map((s) => [s.id, s]));
    for (const p of city.props) {
      const piece = pieces[p.piece]!;
      const a = (p.rotY * Math.PI) / 180;
      piece.colliders.forEach((c, k) => {
        const s = solids.get(`${p.id}-c${k}`);
        expect(s, `${p.id}-c${k}`).toBeDefined();
        expect(s!.hidden).toBe(true);
        // World AABB of the piece collider, by rotating its local AABB about y
        const h = rotatedHalfExtents({ x: (c.size.x * p.scale) / 2, y: (c.size.y * p.scale) / 2, z: (c.size.z * p.scale) / 2 }, c.rotationDeg);
        const cx = p.position.x + (c.center.x * Math.cos(a) + c.center.z * Math.sin(a)) * p.scale;
        const cz = p.position.z + (-c.center.x * Math.sin(a) + c.center.z * Math.cos(a)) * p.scale;
        const [hx, hz] = p.rotY % 180 === 0 ? [h.x, h.z] : [h.z, h.x];
        const got = solidRect(s!);
        const gotH = rotatedHalfExtents({ x: s!.size.x / 2, y: s!.size.y / 2, z: s!.size.z / 2 }, s!.rotationDeg);
        expect(got.minX, s!.id).toBeCloseTo(cx - hx, 1);
        expect(got.maxZ, s!.id).toBeCloseTo(cz + hz, 1);
        expect(s!.center.y - gotH.y, s!.id).toBeCloseTo(p.position.y + (c.center.y * p.scale) - h.y, 1);
      });
    }
  });

  it('every building faces its nearest street', () => {
    const size = city.chunkSize;
    const idx = chunkIndex(city.solids.filter((s) => s.kind === 'road' || s.kind === 'sidewalk'), size);
    const bad: string[] = [];
    for (const p of city.props) {
      const piece = pieces[p.piece]!;
      if (piece.kind !== 'building') continue;
      const [hx, hz] = p.rotY % 180 === 0 ? [piece.size.x / 2, piece.size.z / 2] : [piece.size.z / 2, piece.size.x / 2];
      const r = { minX: p.position.x - hx * p.scale, maxX: p.position.x + hx * p.scale, minZ: p.position.z - hz * p.scale, maxZ: p.position.z + hz * p.scale };
      // Door direction (+z rotated by rotY): 0 → +z, 90 → +x, 180 → −z, 270 → −x
      const inFront = (q: Rect): boolean =>
        p.rotY === 0 ? q.minZ >= r.maxZ - EPS : p.rotY === 90 ? q.minX >= r.maxX - EPS : p.rotY === 180 ? q.maxZ <= r.minZ + EPS : q.maxX <= r.minX + EPS;
      const cands = near(idx, r, 30, size);
      const best = Math.min(...cands.map((q) => rectGap(r, q)));
      const front = Math.min(...cands.filter(inFront).map((q) => rectGap(r, q)));
      if (!(front <= best + 0.01)) bad.push(`${p.id} rotY ${p.rotY}: front ${front.toFixed(2)} > nearest ${best.toFixed(2)}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('district params fail fast on zero sizes or loop steps and on kit rises below the R17 floor', () => {
    const withParams = (district: string, patch: (p: Record<string, unknown>) => void): typeof src => {
      const copy = structuredClone(src);
      patch(copy.districts.find((d) => d.district === district)!.params);
      return copy;
    };
    const cases: [string, (p: Record<string, unknown>) => void, RegExp][] = [
      ['harbor', (p) => ((p.zip as Record<string, number>).apronStep = 0), /zip\.apronStep must be positive/],
      ['harbor', (p) => ((p.container as Record<string, number>).width = 0), /container\.width must be positive/],
      ['harbor', (p) => (p.stepRise = 0.8), /stepRise must be within/],
      ['harbor', (p) => (p.stepRise = 1.2), /1-tier stack's mantle steps rise 0.86 m/],
      ['downtown', (p) => (p.skipMin = 0), /skipMin must be positive/],
      ['downtown', (p) => (p.pitch = 0), /pitch must be positive/],
      ['hillside', (p) => ((p.stairs as Record<string, number>).rise = 0), /stairs\.rise must be positive/],
      ['hillside', (p) => ((p.chute as Record<string, number>).maxSegment = 0), /chute\.maxSegment must be positive/],
      ['hillside', (p) => (p.featureWidth = 0), /featureWidth must be positive/],
      ['suburbs', (p) => ((p.skatepark as Record<string, number>).runUp = 0), /skatepark\.runUp must be positive/],
      // 5 ground rails + 2 funboxes (one deck rail each) = 7 < 8
      ['suburbs', (p) => (p.skatepark as { rails: unknown[] }).rails.splice(5), /the skatepark needs at least 8 rails/],
      ['suburbs', (p) => ((p.skatepark as { transition: { deg: number }[] }).transition[1]!.deg = 52), /skatepark ramps must be under 50°/],
      ['suburbs', (p) => ((p.skatepark as Record<string, { x: number; z: number }>).cellAt = { x: -900, z: 300 }), /arterials on all sides/],
    ];
    for (const [district, patch, why] of cases) expect(() => generateCity(withParams(district, patch), pieces), String(why)).toThrow(why);
  });

  it('ids are prefixed by their district, and the city lists the four quadrants', () => {
    const names = src.districts.map((d) => d.district);
    for (const p of city.props) expect(names.some((n) => p.id.startsWith(`${n}-`)), p.id).toBe(true);
    expect(city.districts.map((d) => d.district).sort()).toEqual(['downtown', 'harbor', 'hillside', 'suburbs']);
  });

  it('arterial edges whose midpoint lies more than longMinHubDistance from the hub are long; no other edge is', () => {
    const land = landRect(src);
    const hub = city.hub;
    const art = arterialGraph(land, arterialLines(src, land), hub, src.hub.clearRadius, src.arterials.longMinHubDistance);
    const pos = new Map(art.nodes.map((n) => [n.id, n.p]));
    const wrong = art.edges.filter((e) => {
      const [a, b] = [pos.get(e.a)!, pos.get(e.b)!];
      const far = Math.hypot((a.x + b.x) / 2 - hub.center.x, (a.z + b.z) / 2 - hub.center.z) > src.arterials.longMinHubDistance;
      return e.long !== far;
    });
    expect(wrong).toEqual([]);
    expect(art.edges.filter((e) => e.long).length).toBeGreaterThan(10);
    // The merged city keeps them (split where local streets join), and only on arterial lines
    const { xs, zs } = arterialLines(src, land);
    const cityPos = new Map(city.streets.nodes.map((n) => [n.id, n.p]));
    const long = city.streets.edges.filter((e) => e.long);
    expect(long.length).toBeGreaterThanOrEqual(art.edges.filter((e) => e.long).length);
    for (const e of long) {
      const [a, b] = [cityPos.get(e.a)!, cityPos.get(e.b)!];
      const onLine = (a.x === b.x && xs.includes(a.x)) || (a.z === b.z && zs.includes(a.z));
      expect(onLine, `${e.a}-${e.b}`).toBe(true);
    }
  });

  it('thief spawns fail fast when perDistrict has no count for a district', () => {
    const perDistrict: Partial<typeof thievesConfig.perDistrict> = { ...thievesConfig.perDistrict };
    delete perDistrict.suburbs;
    const cfg = { ...thievesConfig, perDistrict: perDistrict as typeof thievesConfig.perDistrict };
    expect(() => placeThiefSpawns(city, cfg, mulberry32(1))).toThrow(/perDistrict has no count for suburbs/);
  });

  it('thief spawns: perDistrict in each quadrant, then longStreetExtra on long streets; distinct thief nodes', () => {
    const graph = new StreetGraph(city.streets, city.hub, thievesConfig.plazaMargin);
    const longNodes = new Set(city.streets.edges.filter((e) => e.long).flatMap((e) => [e.a, e.b]));
    const per = thievesConfig.perDistrict;
    const total = Object.values(per).reduce((a, b) => a + b, 0) + thievesConfig.longStreetExtra;
    expect(city.thiefSpawns).toHaveLength(total);
    expect(new Set(city.thiefSpawns.map((t) => t.node)).size).toBe(total);
    for (const d of city.districts) {
      const own = city.thiefSpawns.filter((t) => t.id.startsWith(`thief-${d.district}-`));
      expect(own, d.district).toHaveLength(per[d.district as keyof typeof per]);
    }
    const extra = city.thiefSpawns.filter((t) => t.id.startsWith('thief-long-'));
    expect(extra).toHaveLength(thievesConfig.longStreetExtra);
    for (const t of extra) expect(longNodes.has(t.node), t.id).toBe(true);
    for (const t of city.thiefSpawns) {
      expect(graph.isThiefNode(t.node), t.id).toBe(true);
      expect(graph.neighbours(t.node).length, t.id).toBeGreaterThan(0);
      const p = graph.position(t.node);
      const home = city.districts.find((d) => p.x >= d.rect.minX && p.x <= d.rect.maxX && p.z >= d.rect.minZ && p.z <= d.rect.maxZ);
      expect(t.district, t.id).toBe(home?.district);
    }
  });

  it('thieves stay on the street strips and out of the plaza over two minutes of patrol and chases', () => {
    const graph = new StreetGraph(city.streets, city.hub, thievesConfig.plazaMargin);
    const sys = new ThiefSystem(city, thievesConfig, mulberry32(5));
    const exclusion = city.hub.plazaRadius + thievesConfig.plazaMargin;
    // Height changes only along a street: per tick at most the steepest slope times the fastest step
    const maxDy = graph.maxSlope * thievesConfig.chaseSpeed * DT + 1e-6;
    let lastY = sys.thieves.map((t) => t.position.y);
    const bad: string[] = [];
    let chases = 0;
    for (let i = 1; i <= 120 * 30; i++) {
      // A carrying courier stands beside a different thief every 10 s
      const near = sys.thieves[Math.floor(i / 300) % sys.thieves.length]!.position;
      const courier = { position: { x: near.x + 8, y: near.y, z: near.z + 3 }, carrying: 1, inPlaza: false };
      chases += sys.step(1 / 30, i / 30, courier, () => true).filter((e) => e.kind === 'chaseStarted').length;
      for (const t of sys.thieves) {
        const q = graph.project(t.position).p;
        if (Math.hypot(q.x - t.position.x, q.z - t.position.z) > 1e-6) bad.push(`${t.id} off the streets at tick ${i}`);
        if (Math.hypot(t.position.x - city.hub.center.x, t.position.z - city.hub.center.z) < exclusion - 1e-6) bad.push(`${t.id} in the plaza`);
      }
      sys.thieves.forEach((t, k) => {
        if (Math.abs(t.position.y - lastY[k]!) > maxDy) bad.push(`${t.id} changed height by ${t.position.y - lastY[k]!} at tick ${i}`);
      });
      lastY = sys.thieves.map((t) => t.position.y);
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(chases).toBeGreaterThan(5);
  });

  it('a thief chasing past the side of any arterial strip keeps its street level (terraces and bridges beside it)', () => {
    const graph = new StreetGraph(city.streets, city.hub, thievesConfig.plazaMargin);
    const sys = new ThiefSystem({ ...city, thiefSpawns: city.thiefSpawns.slice(0, 1) }, thievesConfig, mulberry32(5));
    const thief = sys.thieves[0]!;
    const maxDy = graph.maxSlope * thievesConfig.chaseSpeed * DT + 1e-6;
    const { xs, zs } = arterialLines(src, landRect(src));
    const pos = new Map(city.streets.nodes.map((n) => [n.id, n]));
    const bad: string[] = [];
    let sites = 0;
    let ledges = 0;
    for (const e of city.streets.edges) {
      const [a, b] = [pos.get(e.a)!, pos.get(e.b)!];
      if (a.plaza || b.plaza) continue;
      const alongX = a.p.z === b.p.z && zs.includes(a.p.z);
      if (!alongX && !(a.p.x === b.p.x && xs.includes(a.p.x))) continue;
      const len = Math.hypot(b.p.x - a.p.x, b.p.z - a.p.z);
      // Every 5 m along the edge, on both sides: the thief on the strip's side, a courier 5 m beyond it at its height
      for (let s = 2.5; s < len; s += 5) {
        const f = s / len;
        const c = { x: a.p.x + (b.p.x - a.p.x) * f, y: a.p.y + (b.p.y - a.p.y) * f, z: a.p.z + (b.p.z - a.p.z) * f };
        for (const side of [-1, 1]) {
          const n = alongX ? { x: 0, z: side } : { x: side, z: 0 };
          const at = { x: c.x + n.x * e.halfWidth, y: c.y, z: c.z + n.z * e.halfWidth };
          const courier = { x: c.x + n.x * (e.halfWidth + 5), y: c.y, z: c.z + n.z * (e.halfWidth + 5) };
          const step = thievesConfig.chaseSpeed * DT;
          if (Math.abs(graph.project({ x: at.x + n.x * step, y: at.y, z: at.z + n.z * step }).p.y - at.y) > 1) ledges++;
          Object.assign(thief, { mode: 'chase', position: at, chaseTime: 0, aboveTime: 0, route: [] });
          sys.step(DT, 1000, { position: courier, carrying: 1, inPlaza: false }, () => true);
          sites++;
          if (Math.abs(thief.position.y - at.y) > maxDy) bad.push(`${e.a}-${e.b} at ${s.toFixed(1)} m: y ${at.y} → ${thief.position.y}`);
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(sites).toBeGreaterThan(5000);
    // The probe does pass terraces and bridges an unrestricted projection would jump onto
    expect(ledges).toBeGreaterThan(50);
  });
});
