import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CatalogIndex, layoutToMap, parseCatalog, parseCityLayout } from '@dm/shared';
import catalogJson from '../../../map/catalog.json';
import cityJson from '../../../map/city.layout.json';
import { buildBlockMeshes } from '../src/render/city/blockMeshes';
import { AREA_LIFT, AREA_THICKNESS, areaTiers, buildRegionMeshes, DEPTH_LAYER, MODEL_BASE_MIN } from '../src/render/city/regions';

/** An up-facing triangle of the drawn city: its height, footprint, colour and depth layer (0 wins, higher is pushed back). */
interface Face {
  y: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  color: number;
  layer: number;
  mesh: string;
}

/** The depth layer of a mesh, from its material's polygonOffset (0 when it has none). */
function layerOf(mesh: THREE.Mesh): number {
  const m = mesh.material as THREE.Material;
  return m.polygonOffset ? m.polygonOffsetUnits : 0;
}

/** Every up-facing (normal ≈ +y) triangle of a mesh in world space. */
function upFaces(mesh: THREE.Mesh): Face[] {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  const idx = g.getIndex();
  const n = idx ? idx.count : pos.count;
  const at = (i: number): number => (idx ? idx.getX(i) : i);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const out: Face[] = [];
  mesh.updateMatrixWorld(true);
  for (let i = 0; i + 2 < n; i += 3) {
    const [ia, ib, ic] = [at(i), at(i + 1), at(i + 2)];
    a.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld);
    u.subVectors(b, a);
    v.subVectors(c, a);
    const nrm = u.cross(v);
    const len = nrm.length();
    if (len < 1e-9 || nrm.y / len < 0.999) continue;
    const color = col ? new THREE.Color(col.getX(ia), col.getY(ia), col.getZ(ia)).getHex() : -1;
    out.push({
      y: (a.y + b.y + c.y) / 3,
      minX: Math.min(a.x, b.x, c.x),
      maxX: Math.max(a.x, b.x, c.x),
      minZ: Math.min(a.z, b.z, c.z),
      maxZ: Math.max(a.z, b.z, c.z),
      color,
      layer: layerOf(mesh),
      mesh: mesh.name,
    });
  }
  return out;
}

const EDGE = 0.02; // footprints that only touch along an edge do not overlap
const overlap = (p: Face, q: Face): boolean =>
  p.minX + EDGE < q.maxX && q.minX + EDGE < p.maxX && p.minZ + EDGE < q.maxZ && q.minZ + EDGE < p.maxZ;

/**
 * Two drawn surfaces fight when they lie within `gap` of one another in height and the one that should show
 * (the higher) is not the one the depth test favours: same layer and a different colour, or the higher one is
 * in a layer pushed further back than the lower one.
 */
function fights(p: Face, q: Face, gap: number): boolean {
  if (!overlap(p, q) || Math.abs(p.y - q.y) > gap) return false;
  const [lo, hi] = p.y <= q.y ? [p, q] : [q, p];
  if (hi.layer === lo.layer) return hi.color !== lo.color; // within a layer only the colour tells them apart: ambiguous
  if (hi.y - lo.y < 1e-4) return false; // level, in different layers: the nearer layer always wins
  return hi.layer > lo.layer; // the higher surface is pushed further back: it loses at distance
}

describe('the drawn city has no two flat surfaces fighting in the depth buffer (SP5 playtest: striped streets)', () => {
  it('scans every up-facing triangle of the regions and block placeholders', () => {
    const cat = new CatalogIndex(parseCatalog(catalogJson));
    const map = layoutToMap(parseCityLayout(cityJson), cat);
    const faces: Face[] = [];
    for (const [, group] of buildRegionMeshes(map, 400)) group.traverse((o) => void (o instanceof THREE.Mesh && faces.push(...upFaces(o))));
    for (const [, mesh] of buildBlockMeshes(map, cat)) faces.push(...upFaces(mesh));
    expect(faces.length).toBeGreaterThan(1000);

    // bin by height (2 cm) so only neighbouring heights are compared
    const BIN = 0.02;
    const bins = new Map<number, Face[]>();
    for (const f of faces) {
      const k = Math.floor(f.y / BIN);
      (bins.get(k) ?? bins.set(k, []).get(k)!).push(f);
    }
    const seen = new Set<string>();
    const problems: string[] = [];
    for (const [k, list] of bins) {
      const near = [...list, ...(bins.get(k + 1) ?? [])];
      for (const p of list) {
        for (const q of near) {
          if (p === q || !fights(p, q, BIN)) continue;
          const key = `${p.mesh}|${q.mesh}|${p.color}|${q.color}|${Math.round(Math.min(p.minX, q.minX) / 10)}|${Math.round(Math.min(p.minZ, q.minZ) / 10)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          problems.push(
            `${p.mesh} (layer ${p.layer}, #${p.color.toString(16)}, y ${p.y.toFixed(3)}) vs ${q.mesh} (layer ${q.layer}, #${q.color.toString(16)}, y ${q.y.toFixed(3)}) near x ${Math.round(Math.max(p.minX, q.minX))}, z ${Math.round(Math.max(p.minZ, q.minZ))}`,
          );
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    // the pack models stand on the flats: the top flat tier of the city stays under their lowest base plate
    const maxTier = Math.max(0, ...areaTiers(map.layout.areas).map(([, t]) => t));
    expect(maxTier).toBeLessThanOrEqual(2);
    expect(AREA_LIFT + maxTier * (AREA_LIFT + AREA_THICKNESS) + AREA_THICKNESS).toBeLessThan(MODEL_BASE_MIN);
    expect(DEPTH_LAYER.ground(1)).toBeGreaterThan(DEPTH_LAYER.terrain(1));
    expect(DEPTH_LAYER.terrain(1)).toBeGreaterThan(DEPTH_LAYER.flats(0, 1));
    expect(DEPTH_LAYER.solids).toBeGreaterThan(DEPTH_LAYER.streets);
    expect(DEPTH_LAYER.flats(0, 1)).toBeGreaterThan(DEPTH_LAYER.flats(1, 1));
  });
});
