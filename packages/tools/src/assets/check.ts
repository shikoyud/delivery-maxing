import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetCatalog, CatalogEntry } from '@dm/shared';
import { measureGlb, type Measure } from './measure';

export type Size = CatalogEntry['size'];

export interface AssetsReport {
  /** Catalog ids whose file is not in the packs folder */
  missing: string[];
  /** .glb files (relative to the packs folder) that no catalog entry names */
  extra: string[];
  /** Catalog ids whose file holds no triangles */
  empty: string[];
  sizeChanged: { id: string; was: Size; now: Size; reason: 'footprint' | 'pivot' }[];
  /** Pairs of ids of different packs with the same rounded size and triangle count */
  duplicates: [string, string][];
}

/** A footprint side that grew, or a pivot that moved, by more than this (m) changes how a model sits on its lot */
export const SIZE_TOLERANCE = 0.5;

function listGlb(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.toLowerCase().endsWith('.glb'))
    .map((f) => f.split('\\').join('/'))
    .sort();
}

/** Compares the catalog with the models under `folder`. Entries without a file (status "missing") are known gaps, not findings. */
export async function checkPacks(folder: string, cat: AssetCatalog): Promise<AssetsReport> {
  const onDisk = new Set(listGlb(folder));
  const known = new Set<string>();
  const report: AssetsReport = { missing: [], extra: [], empty: [], sizeChanged: [], duplicates: [] };
  const measured = new Map<string, Measure>();
  for (const e of cat.entries) {
    if (e.file === null) continue;
    known.add(e.file);
    if (!onDisk.has(e.file)) {
      report.missing.push(e.id);
      continue;
    }
    const m = await measureGlb(join(folder, e.file));
    measured.set(e.id, m);
    if (m.tris === 0) {
      report.empty.push(e.id);
      continue;
    }
    if (m.size.w - e.size.w > SIZE_TOLERANCE || m.size.d - e.size.d > SIZE_TOLERANCE) {
      report.sizeChanged.push({ id: e.id, was: e.size, now: m.size, reason: 'footprint' });
    } else if (e.pivot && (Math.abs(m.pivot.x - e.pivot.x) > SIZE_TOLERANCE || Math.abs(m.pivot.z - e.pivot.z) > SIZE_TOLERANCE)) {
      report.sizeChanged.push({ id: e.id, was: e.size, now: m.size, reason: 'pivot' });
    }
  }
  report.extra = [...onDisk].filter((f) => !known.has(f));
  const groups = new Map<string, string[]>();
  for (const [id, m] of measured) {
    if (m.tris === 0 || !(id.startsWith('mega/') || id.startsWith('trop/'))) continue;
    const key = `${m.size.w.toFixed(2)}x${m.size.h.toFixed(2)}x${m.size.d.toFixed(2)}/${m.tris}`;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  for (const ids of groups.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (ids[i]!.split('/')[0] !== ids[j]!.split('/')[0]) report.duplicates.push([ids[i]!, ids[j]!]);
      }
    }
  }
  report.duplicates.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return report;
}

const fmt = (s: Size): string => `${s.w} x ${s.h} x ${s.d}`;

export function formatReport(r: AssetsReport): string {
  const out: string[] = [];
  const section = (title: string, lines: string[]): void => {
    out.push(`${title}: ${lines.length}`);
    for (const l of lines) out.push(`  ${l}`);
  };
  section('missing', r.missing);
  section('extra', r.extra);
  section('empty', r.empty);
  section(
    'sizeChanged',
    r.sizeChanged.map((c) => `${c.id} (${c.reason}) was ${fmt(c.was)} now ${fmt(c.now)}`),
  );
  section(
    'duplicates',
    r.duplicates.map(([a, b]) => `${a} = ${b}`),
  );
  return out.join('\n');
}

