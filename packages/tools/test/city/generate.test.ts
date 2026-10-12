import { readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  chunksOverlapping,
  parseCityMap,
  parsePieceCatalog,
  rotatedHalfExtents,
  solidRect,
  type CityMap,
  type Rect,
  type Solid,
} from '@dm/shared';
import { generateCity } from '../../src/city/generate';
import { parseCitySource } from '../../src/city/source';
import { stableStringify } from '../../src/city/stableJson';
import type { AssetsConfig } from '../../src/assets/pipeline';

// Runs the generator on the real committed inputs.
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), 'utf8'));
const src = parseCitySource(readJson('map/city.source.json'));
const pieces = parsePieceCatalog(readJson('map/pieces.json'));
const assetsCfg = JSON.parse(readFileSync(join(here, '../../assets.config.json'), 'utf8')) as AssetsConfig;

const EPS = 1e-6;
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

  it('roads (top 0.02) and sidewalks (top 0.15) never cross a chunk border', () => {
    const streets = city.solids.filter((s) => s.kind === 'road' || s.kind === 'sidewalk');
    expect(streets.length).toBeGreaterThan(500);
    for (const s of streets) {
      expect(chunksOverlapping(solidRect(s), city.chunkSize), s.id).toHaveLength(1);
      expect(s.center.y + s.size.y / 2, s.id).toBeCloseTo(s.kind === 'road' ? 0.02 : 0.15, 6);
    }
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

  it('ids are prefixed by their district, and the city lists the four quadrants', () => {
    const names = src.districts.map((d) => d.district);
    for (const p of city.props) expect(names.some((n) => p.id.startsWith(`${n}-`)), p.id).toBe(true);
    expect(city.districts.map((d) => d.district).sort()).toEqual(['downtown', 'harbor', 'hillside', 'suburbs']);
  });
});
