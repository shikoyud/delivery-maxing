import { StreetGraph, type CityMap, type DistrictArea, type Rng, type ThiefSpawn, type ThievesConfig, type Vec3 } from '@dm/shared';
import { contains } from './layout';

/** The quadrant holding p (the first listed, on a shared border). */
function districtOf(p: Vec3, areas: readonly DistrictArea[]): DistrictArea {
  const area = areas.find((a) => contains(a.rect, p.x, p.z));
  if (!area) throw new Error(`street node at (${p.x}, ${p.z}) lies in no district`);
  return area;
}

/** Picks `n` distinct ids from `pool` (in pool order, uniformly at random); throws when the pool is too small. */
function pick(pool: readonly string[], n: number, rng: Rng, what: string): string[] {
  if (pool.length < n) throw new Error(`thief spawns: ${what} has ${pool.length} usable street nodes, needs ${n}`);
  const left = [...pool];
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(left.splice(Math.floor(rng() * left.length), 1)[0]!);
  return out;
}

/**
 * Thief spawns (spec §7.3 density): `perDistrict` on random street nodes of each quadrant, then `longStreetExtra` on
 * ends of `long` edges. Every spawn node is distinct and one thieves may use (no plaza node, outside the HUB
 * exclusion, with a street to walk on). Ids are `thief-<district>-<n>` and `thief-long-<n>`.
 */
export function placeThiefSpawns(city: CityMap, cfg: ThievesConfig, rng: Rng): ThiefSpawn[] {
  const graph = new StreetGraph(city.streets, city.hub, cfg.plazaMargin);
  const usable = city.streets.nodes.filter((n) => graph.isThiefNode(n.id) && graph.neighbours(n.id).length > 0);
  const used = new Set<string>();
  const spawns: ThiefSpawn[] = [];
  const add = (node: string, id: string): void => {
    used.add(node);
    spawns.push({ id, node, district: districtOf(graph.position(node), city.districts).district });
  };

  for (const area of city.districts) {
    const n = cfg.perDistrict[area.district as keyof ThievesConfig['perDistrict']] ?? 0;
    const pool = usable.filter((s) => districtOf(s.p, city.districts) === area).map((s) => s.id);
    pick(pool, n, rng, area.district).forEach((node, i) => add(node, `thief-${area.district}-${i}`));
  }

  const longEnds = new Set(city.streets.edges.filter((e) => e.long).flatMap((e) => [e.a, e.b]));
  const pool = usable.filter((s) => longEnds.has(s.id) && !used.has(s.id)).map((s) => s.id);
  pick(pool, cfg.longStreetExtra, rng, 'the long streets').forEach((node, i) => add(node, `thief-long-${i}`));
  return spawns;
}
