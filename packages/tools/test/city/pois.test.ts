import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bandFor, ordersConfig, parsePieceCatalog, type PoiKind } from '@dm/shared';
import { generateCityWithReport } from '../../src/city/generate';
import { parseCitySource } from '../../src/city/source';

// The POI pass on the generated city (real committed inputs).
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), 'utf8'));
const src = parseCitySource(readJson('map/city.source.json'));
const pieces = parsePieceCatalog(readJson('map/pieces.json'));
const { city } = generateCityWithReport(src, pieces);
const { pois } = city;
const q = src.pois;
const hub = city.hub.center;
const flat = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

describe('POI candidates', () => {
  it('150 POIs, ids unique', () => {
    expect(pois.length).toBe(q.total);
    expect(q.total).toBe(150);
    expect(new Set(pois.map((p) => p.id)).size).toBe(pois.length);
    for (const p of pois) {
      expect(p.id, p.id).toMatch(/^poi-(downtown|harbor|hillside|suburbs)-\d{2}$/);
      expect(p.id.startsWith(`poi-${p.district}-`), p.id).toBe(true);
      expect(typeof p.elevated, p.id).toBe('boolean');
    }
  });

  it('≥ 45% elevated', () => {
    expect(q.elevatedTarget).toBe(0.45);
    expect(pois.filter((p) => p.elevated).length / pois.length).toBeGreaterThanOrEqual(q.elevatedTarget);
  });

  it('every district meets its quota', () => {
    const counts: Record<string, number> = {};
    for (const p of pois) counts[p.district] = (counts[p.district] ?? 0) + 1;
    expect(counts).toEqual(q.perDistrict);
  });

  it('no two POIs within 25 m', () => {
    expect(q.minSpacing).toBe(25);
    const close: string[] = [];
    for (let i = 0; i < pois.length; i++) {
      for (let j = i + 1; j < pois.length; j++) {
        const d = flat(pois[i]!.position, pois[j]!.position);
        if (d < q.minSpacing) close.push(`${pois[i]!.id} ${pois[j]!.id} ${d.toFixed(1)} m`);
      }
    }
    expect(close).toEqual([]);
    // …and none in the hub plaza's clear circle
    for (const p of pois) expect(flat(p.position, hub), p.id).toBeGreaterThanOrEqual(src.hub.clearRadius);
  });

  it('≥ 20 POIs per estimated band', () => {
    // Straight line from the hub × 1.25 (the navmesh confirms in Task 14), on the city bands
    expect(ordersConfig.bands.city).toEqual({ shortMax: 500, mediumMax: 1200 });
    const counts = { short: 0, medium: 0, long: 0 };
    for (const p of pois) counts[bandFor(flat(p.position, hub) * q.bandEstimateFactor, ordersConfig.bands.city)]++;
    expect(q.bandEstimateFactor).toBe(1.25);
    for (const [band, n] of Object.entries(counts)) expect(n, band).toBeGreaterThanOrEqual(q.perBandMin);
  });

  it('every POI kind appears', () => {
    const kinds = new Set<PoiKind>(pois.map((p) => p.kind));
    expect([...kinds].sort()).toEqual(['balcony', 'counter', 'door', 'mailbox']);
    for (const [kind, min] of Object.entries(q.kindMin)) expect(pois.filter((p) => p.kind === kind).length, kind).toBeGreaterThanOrEqual(min);
    // Balconies are elevated; mailboxes and counters stand at street level
    for (const p of pois) {
      if (p.kind === 'balcony') expect(p.elevated, p.id).toBe(true);
      if (p.kind === 'mailbox' || p.kind === 'counter') expect(p.elevated, p.id).toBe(false);
    }
  });
});
