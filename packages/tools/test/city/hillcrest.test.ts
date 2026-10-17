import { expect, test } from 'vitest';
import { cityConfig as cfg, mulberry32, namesConfig, type Rect } from '@dm/shared';
import { readCatalog } from '../../src/city/files';
import { buildHillcrest, driveZ } from '../../src/city/hillcrest';
import { REPO } from '../../src/nav/files';

const cat = readCatalog(REPO);
const hc = buildHillcrest(cfg, mulberry32(9), cat, namesConfig);
const EPS = 1e-6;
const overlaps = (a: Rect, b: Rect): boolean => a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;
const h = cfg.hillcrest;

test('Hillcrest Drive: 121 points every 10 m on z = driveZ + amplitude sin(2 pi x / period), 10 m wide, at the ridge height', () => {
  const pts = hc.curvedRoad.polyline;
  expect(pts).toHaveLength(121);
  expect(hc.curvedRoad.width).toBe(10);
  pts.forEach((p, i) => {
    expect(p.x).toBe(i * 10);
    expect(p.z).toBeCloseTo(1118 + 22 * Math.sin((2 * Math.PI * p.x) / 420), 9);
    expect(p.y).toBe(cfg.levels.ridge.y);
  });
  expect(driveZ(105, cfg)).toBeCloseTo(1118 + 22, 9);
});

test('lots never overlap each other or the drive, and stay on the ridge', () => {
  const lots = hc.lots;
  expect(lots.length).toBeGreaterThan(100);
  for (let i = 0; i < lots.length; i++) for (let j = i + 1; j < lots.length; j++) expect(overlaps(lots[i]!.rect, lots[j]!.rect)).toBe(false);
  // the drive's footprint: the centre line +- half the width measured square to it, sampled every 0.1 m
  const half = h.driveWidth / 2;
  for (const l of lots) {
    expect(l.rect.minZ).toBeGreaterThanOrEqual(cfg.levels.ridge.z0);
    expect(l.rect.maxZ).toBeLessThanOrEqual(h.cliff.z0);
    expect(l.y).toBe(cfg.levels.ridge.y);
    for (let x = l.rect.minX - half; x <= l.rect.maxX + half; x += 0.1) {
      const z = driveZ(x, cfg);
      const slope = (driveZ(x + 0.01, cfg) - driveZ(x - 0.01, cfg)) / 0.02;
      const n = Math.hypot(1, slope);
      // the edge point square to the centre line at x: (x -+ half * slope / n, z +- half / n)
      for (const s of [-1, 1]) {
        const ex = x - (s * half * slope) / n;
        const ez = z + (s * half) / n;
        const inX = ex > l.rect.minX + EPS && ex < l.rect.maxX - EPS;
        if (inX) expect(ez > l.rect.minZ && ez < l.rect.maxZ, `${l.id} at x ${ex}`).toBe(false);
      }
      if (x > l.rect.minX && x < l.rect.maxX) expect(z > l.rect.minZ && z < l.rect.maxZ).toBe(false);
    }
  }
  const north = lots.filter((l) => l.facing === 'S');
  const south = lots.filter((l) => l.facing === 'N');
  expect(north.length).toBeGreaterThan(50);
  expect(south.length).toBeGreaterThan(50);
  for (const l of lots) {
    const w = l.rect.maxX - l.rect.minX;
    const d = l.rect.maxZ - l.rect.minZ;
    expect(w).toBeLessThanOrEqual(h.lot);
    expect(d).toBeLessThanOrEqual(h.depth);
  }
});

test('the park gap has no lots; the lookout park, the gas station and the cliff', () => {
  for (const l of hc.lots) expect(l.rect.maxX <= h.parkX0 || l.rect.minX >= h.parkX1, l.id).toBe(true);
  const parks = hc.areas.filter((a) => a.kind === 'park');
  expect(parks.length).toBeGreaterThanOrEqual(1);
  for (const p of parks) {
    expect(p.rect.minX).toBe(h.parkX0);
    expect(p.rect.maxX).toBe(h.parkX1);
    // the park leaves the drive itself open to cars
    for (let x = h.parkX0; x <= h.parkX1; x += 1) {
      const z = driveZ(x, cfg);
      expect(z + h.driveWidth / 2 <= p.rect.minZ + EPS || z - h.driveWidth / 2 >= p.rect.maxZ - EPS).toBe(true);
    }
  }
  expect(hc.gasStation.name).toBe('Ridge Fuel');
  expect(hc.gasStation.position.y).toBe(48);
  const cliff = hc.areas.filter((a) => a.kind === 'cliff');
  expect(cliff.map((a) => [a.rect, a.y])).toEqual([[{ minX: 0, minZ: 1180, maxX: 1200, maxZ: 1200 }, 60]]);
  for (const l of hc.lots) expect(hc.fronts.get(l.id)?.name).toBe('Hillcrest Drive');
});
