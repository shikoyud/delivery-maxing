import { bandFor, type Band, type District, type Poi, type PoiKind, type Rect, type Rng, type Solid } from '@dm/shared';
import { namedChecks, type DistrictOutput, type PoiSlot } from './district';
import { GridIndex, MANTLE_STEP_MIN_RISE, obstacleOf } from './kits';
import { contains, flatDistance, sq, v2 } from './layout';
import {
  allowed,
  balconyKit,
  balconyOn,
  CRATE_WIDTH,
  facadeDirs,
  furniture,
  mantleKit,
  nothing,
  padZipKit,
  roofLedge,
  standing,
  type BalconyPlan,
  type Built,
  type Pass,
  type PoiContext,
} from './poiKits';
import { isTilted, Reach, SIDEWALK, Space, YARD } from './poiSpace';
import type { PoiSource } from './source';

export type { PoiContext } from './poiKits';

/** The order of the band checks. */
const BANDS: readonly Band[] = ['short', 'medium', 'long'];
const KINDS: readonly PoiKind[] = ['door', 'mailbox', 'counter', 'balcony'];

// ---- Params ---------------------------------------------------------------------------------------------------

function poiParams(p: PoiSource, ctx: PoiContext): PoiSource {
  const { fail, obj, nums, positive } = namedChecks('city source: pois');
  const { move } = ctx;
  const maxFall = ctx.orders.fragile.maxFallMeters;
  const raw = p as unknown as Record<string, unknown>;
  positive(raw, ['total', 'minSpacing', 'perBandMin', 'bandEstimateFactor', 'elevatedMin', 'featureClearance'], '');
  nums(raw, ['elevatedTarget'], '');
  positive(obj(p.pickWeights, 'pickWeights'), ['street', 'route', 'mantle', 'padZip'], 'pickWeights.');
  if (p.elevatedTarget > 1) fail('elevatedTarget must be at most 1');
  const per = obj(p.perDistrict, 'perDistrict');
  for (const [d, n] of Object.entries(per)) {
    if (!ctx.city.districts.some((x) => x.district === d)) fail(`perDistrict.${d} names no district of the city`);
    if (!Number.isInteger(n) || (n as number) < 0) fail(`perDistrict.${d} must be a whole number`);
  }
  if (Object.values(per).reduce((s: number, n) => s + (n as number), 0) !== p.total) fail('perDistrict must add up to total');
  for (const [k, n] of Object.entries(obj(p.kindMin, 'kindMin'))) {
    if (!KINDS.includes(k as PoiKind)) fail(`kindMin.${k} is not a POI kind`);
    if (!Number.isInteger(n) || (n as number) < 0) fail(`kindMin.${k} must be a whole number`);
  }
  const kits = obj(p.kits, 'kits');
  positive(kits, ['stepRise', 'runUp', 'alongStep', 'standOff'], 'kits.');
  nums(kits, ['dropMargin'], 'kits.');
  const pad = obj(kits.pad, 'kits.pad');
  positive(pad, ['radius'], 'kits.pad.');
  nums(pad, ['apexAbove', 'clearance'], 'kits.pad.');
  if (!Array.isArray(pad.distances) || pad.distances.length === 0 || !pad.distances.every((d) => typeof d === 'number' && d > 0)) {
    fail('kits.pad.distances must list positive numbers');
  }
  const zip = obj(kits.zip, 'kits.zip');
  positive(zip, ['endHeight', 'maxSlope', 'directions', 'runStep', 'runSteps'], 'kits.zip.');
  nums(zip, ['endInset'], 'kits.zip.');
  positive(obj(p.balcony, 'balcony'), ['width', 'depth', 'thickness', 'floorHeight', 'headroom'], 'balcony.');
  const furniture = obj(p.furniture, 'furniture');
  positive(furniture, ['step', 'endClearance'], 'furniture.');
  const mailbox = obj(furniture.mailbox, 'furniture.mailbox');
  positive(mailbox, ['width', 'depth', 'height'], 'furniture.mailbox.');
  nums(mailbox, ['inset'], 'furniture.mailbox.');
  const stall = obj(furniture.stall, 'furniture.stall');
  positive(stall, ['width', 'depth', 'height'], 'furniture.stall.');
  nums(stall, ['gap'], 'furniture.stall.');

  const k = p.kits;
  // Ruling R17: a kit step rises at least the mantle's wall-probe height and at most mantle.maxHeight
  if (k.stepRise < MANTLE_STEP_MIN_RISE || k.stepRise > move.mantle.maxHeight) {
    fail(`kits.stepRise must be within [${MANTLE_STEP_MIN_RISE}, mantle.maxHeight ${move.mantle.maxHeight}] (R17)`);
  }
  if (k.runUp < k.standOff + move.capsule.radius) fail('kits.runUp must hold the climb start (standOff) and the courier');
  if (k.pad.apexAbove > maxFall) fail('kits.pad.apexAbove must keep the fall onto the roof Fragile-safe');
  for (const key of ['directions', 'runSteps'] as const) if (!Number.isInteger(k.zip[key])) fail(`kits.zip.${key} must be a whole number`);
  if (k.zip.endHeight < move.zipLine.hangDrop) fail('kits.zip.endHeight must leave the hang drop under the cable');
  const b = p.balcony;
  if (b.floorHeight < p.elevatedMin || b.floorHeight > maxFall) fail('balcony.floorHeight must be elevated and within a Fragile-safe drop');
  // A courier mantling off side crate steps (CRATE_WIDTH wide against the facade) lands within the slab's depth
  if (b.depth < CRATE_WIDTH / 2 + move.capsule.radius + 0.1 || b.width < CRATE_WIDTH) fail('a balcony must hold a courier off its crate steps');
  const sw = ctx.streets.sidewalkWidth;
  if (p.furniture.mailbox.inset + p.furniture.mailbox.depth > sw / 2 - move.capsule.radius) fail('a mailbox must leave the sidewalk centre free');
  return p;
}

// ---- Candidates -----------------------------------------------------------------------------------------------

/** What a candidate costs to build: nothing (street, route), crate steps (mantle) or a pad and a zip line (padZip). */
type Cost = keyof PoiSource['pickWeights'];

/** A POI candidate: its slot, estimated band, cost, and how to build what it needs (null when it cannot be built). */
interface Candidate { slot: PoiSlot; band: Band; cost: Cost; build: (id: string) => Built | null }

function candidate(w: Pass, slot: PoiSlot, cost: Cost, build: (id: string) => Built | null): Candidate {
  const { center } = w.ctx.plaza;
  const band = bandFor(flatDistance(slot.position, center) * w.p.bandEstimateFactor, w.ctx.orders.bands.city);
  return { slot, band, cost, build };
}

/** The district holding `p` (the first listed whose rect does), or null. */
function districtAt(w: Pass, p: { x: number; z: number }): District | null {
  return w.ctx.city.districts.find((d) => contains(d.rect, p.x, p.z))?.district ?? null;
}

const inPlaza = (w: Pass, p: { x: number; z: number }): boolean => flatDistance(p, w.ctx.plaza.center) < w.ctx.plaza.clearRadius;

/**
 * The districts' slots: street doors (a courier stands there), route slots the navigation links already reach both
 * ways, and kit slots (roofs) that get an access kit.
 */
function slotCandidates(w: Pass, slots: readonly PoiSlot[]): Candidate[] {
  const out: Candidate[] = [];
  for (const slot of slots) {
    if (inPlaza(w, slot.position)) continue;
    if (slot.access === 'kit') {
      const roof = roofLedge(w, slot);
      if (!roof) continue;
      const { ledge, kit } = roof;
      const build = kit === 'mantle' ? (id: string) => mantleKit(w, ledge, id) : (id: string) => padZipKit(w, ledge, slot.position, id);
      out.push(candidate(w, slot, kit, (id) => (standing(w, slot.position) ? build(id) : null)));
    } else if (slot.access === 'street' || w.reach.both(slot.position)) {
      out.push(candidate(w, slot, slot.access, () => (standing(w, slot.position) ? nothing() : null)));
    }
  }
  return out;
}

/**
 * Balcony slots: one per building tall enough for a balcony a floor up with headroom above it, on its first facade
 * (front, back, then the sides) whose body colliders (upright, standing on the ground) are at least the balcony's width
 * across, with room for the slab.
 */
function balconyCandidates(w: Pass): Candidate[] {
  const { city, pieces } = w.ctx;
  const b = w.p.balcony;
  const byProp = new Map<string, Solid[]>();
  for (const s of city.solids) {
    if (!s.hidden || s.kind !== 'building') continue;
    const prop = s.id.replace(/-c\d+$/, '');
    const list = byProp.get(prop);
    if (list) list.push(s);
    else byProp.set(prop, [s]);
  }
  const out: Candidate[] = [];
  for (const prop of city.props) {
    if (pieces[prop.piece]?.kind !== 'building') continue;
    const base = prop.position.y;
    const floor = base + b.floorHeight;
    const bodies = (byProp.get(prop.id) ?? [])
      .filter((s) => !isTilted(s) && s.center.y - s.size.y / 2 <= base + 0.1 && s.center.y + s.size.y / 2 >= floor + b.headroom)
      .map((s) => obstacleOf(s).rect);
    if (bodies.length === 0) continue;
    // One balcony per building: on the first facade (front, back, then the sides) with room for it
    const plan = facadeDirs(prop.rotY)
      .map((dir) => balconyOn(bodies, dir, floor, w))
      .find((x): x is BalconyPlan => !!x && allowed(w, x.rect) && w.space.free(x.rect, x.bottom, x.top + w.ctx.move.capsule.height + 0.1));
    if (!plan) continue;
    const position = v2({ x: (plan.rect.minX + plan.rect.maxX) / 2, y: floor, z: (plan.rect.minZ + plan.rect.maxZ) / 2 });
    const district = districtAt(w, position);
    if (!district || inPlaza(w, position)) continue;
    out.push(candidate(w, { position, kind: 'balcony', elevated: true, district, access: 'kit' }, 'mantle', (id) => balconyKit(w, plan, id)));
  }
  return out;
}

/**
 * Street furniture slots every furniture.step m along each flat, axis-aligned street edge (none near its ends), on
 * both sides, mailboxes and stalls in turn. The POI stands in the middle of the sidewalk: beside a mailbox at its outer
 * edge, or in front of a stall (a counter) just beyond it.
 */
function furnitureCandidates(w: Pass): Candidate[] {
  const { city, streets } = w.ctx;
  const f = w.p.furniture;
  const nodes = new Map(city.streets.nodes.map((n) => [n.id, n]));
  const out: Candidate[] = [];
  let turn = 0;
  for (const e of city.streets.edges) {
    const a = nodes.get(e.a)!.p;
    const b = nodes.get(e.b)!.p;
    if (nodes.get(e.a)!.plaza || nodes.get(e.b)!.plaza || a.y !== b.y || (a.x !== b.x && a.z !== b.z)) continue;
    const len = Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
    const u = { x: Math.sign(b.x - a.x), z: Math.sign(b.z - a.z) };
    const c = { x: Math.abs(u.z), z: Math.abs(u.x) };
    const hw = e.halfWidth;
    const at = (s: number, across: number): { x: number; z: number } => ({ x: a.x + u.x * s + c.x * across, z: a.z + u.z * s + c.z * across });
    /** The rect `s0`…`s1` along the edge and `c0`…`c1` across it. */
    const rectAt = (s0: number, s1: number, c0: number, c1: number): Rect => {
      const p = at(s0, c0);
      const q = at(s1, c1);
      return { minX: Math.min(p.x, q.x), maxX: Math.max(p.x, q.x), minZ: Math.min(p.z, q.z), maxZ: Math.max(p.z, q.z) };
    };
    for (let s = f.endClearance; s <= len - f.endClearance + 1e-9; s += f.step) {
      for (const side of [1, -1]) {
        const kind: PoiKind = turn++ % 2 === 0 ? 'mailbox' : 'counter';
        const position = v2({ ...at(s, side * (hw - streets.sidewalkWidth / 2)), y: a.y + streets.sidewalkTop });
        const district = districtAt(w, position);
        if (!district || inPlaza(w, position)) continue;
        const outer = side * hw;
        const build =
          kind === 'mailbox'
            ? (id: string): Built | null => {
              const m = f.mailbox;
              const edge = outer - side * m.inset;
              const rect = rectAt(s - m.width / 2, s + m.width / 2, edge, edge - side * m.depth);
              return furniture(w, `${id}-mailbox`, rect, position, position.y, m.height, SIDEWALK);
            }
            : (id: string): Built | null => {
              const st = f.stall;
              const rect = rectAt(s - st.width / 2, s + st.width / 2, outer + side * st.gap, outer + side * (st.gap + st.depth));
              return furniture(w, `${id}-stall`, rect, position, a.y, st.height, YARD);
            };
        out.push(candidate(w, { position, kind, elevated: false, district, access: 'street' }, 'street', build));
      }
    }
  }
  return out;
}

// ---- Selection ------------------------------------------------------------------------------------------------

/**
 * A seeded weighted shuffle (Efraimidis–Spirakis): each candidate draws the key u^(1 / weight) and they are taken by
 * descending key, so a candidate of weight w comes up about w times as early as one of weight 1.
 */
function weightedOrder(cands: Candidate[], weight: (c: Candidate) => number, rng: Rng): Candidate[] {
  const keyed = cands.map((c) => ({ c, key: rng() ** (1 / weight(c)) }));
  return keyed.sort((a, b) => b.key - a.key).map((k) => k.c);
}

/**
 * Picks the POIs: per district, ceil(quota × elevatedTarget) elevated and the rest at street level, minSpacing apart.
 * Candidates are taken in a seeded order: first enough of each kindMin kind, then enough in each estimated band, then
 * the rest. A candidate is taken only when what it needs can be built; that is built at once (so later sites see it).
 */
function select(w: Pass, cands: Candidate[]): { pois: Poi[]; built: Built[] } {
  const p = w.p;
  const left = new Map<District, { elevated: number; street: number }>();
  for (const [d, n] of Object.entries(p.perDistrict) as [District, number][]) {
    const elevated = Math.ceil(n * p.elevatedTarget - 1e-9);
    left.set(d, { elevated, street: n - elevated });
  }
  const count = new Map<District, number>();
  const taken = new GridIndex<{ rect: Rect }>(p.minSpacing);
  const dead = new Set<Candidate>();
  const pois: Poi[] = [];
  const built: Built[] = [];
  const kinds = new Map<PoiKind, number>();
  const bands = new Map<Band, number>();

  const take = (c: Candidate): void => {
    if (dead.has(c)) return;
    const { slot } = c;
    const q = left.get(slot.district);
    const type = slot.elevated ? 'elevated' : 'street';
    if (!q || q[type] === 0) return;
    const spot = sq(slot.position, 0);
    if (taken.near(spot, p.minSpacing).some((t) => flatDistance({ x: t.rect.minX, z: t.rect.minZ }, slot.position) < p.minSpacing)) return;
    const n = count.get(slot.district) ?? 0;
    const id = `poi-${slot.district}-${String(n).padStart(2, '0')}`;
    const b = c.build(id);
    dead.add(c);
    if (!b) return;
    for (const s of b.solids) w.space.addSolid(s);
    for (const m of b.marks) w.space.mark(m);
    for (const [x, y] of b.lines) w.space.markLine(x, y);
    // Later kits keep clear of this POI too
    w.space.mark(slot.position);
    built.push(b);
    pois.push({ id, position: slot.position, district: slot.district, kind: slot.kind, elevated: slot.elevated });
    taken.add({ rect: spot });
    q[type]--;
    count.set(slot.district, n + 1);
    kinds.set(slot.kind, (kinds.get(slot.kind) ?? 0) + 1);
    bands.set(c.band, (bands.get(c.band) ?? 0) + 1);
  };

  for (const [kind, min] of Object.entries(p.kindMin) as [PoiKind, number][]) {
    for (const c of cands) if (c.slot.kind === kind && (kinds.get(kind) ?? 0) < min) take(c);
  }
  for (const band of BANDS) for (const c of cands) if (c.band === band && (bands.get(band) ?? 0) < p.perBandMin) take(c);
  for (const c of cands) take(c);

  for (const [d, q] of left) {
    if (q.elevated > 0 || q.street > 0) throw new Error(`POI pass: district ${d} is short of ${q.elevated} elevated and ${q.street} street POIs`);
  }
  for (const [kind, min] of Object.entries(p.kindMin) as [PoiKind, number][]) {
    if ((kinds.get(kind) ?? 0) < min) throw new Error(`POI pass: only ${kinds.get(kind) ?? 0} ${kind} POIs (need ${min})`);
  }
  for (const band of BANDS) {
    if ((bands.get(band) ?? 0) < p.perBandMin) throw new Error(`POI pass: only ${bands.get(band) ?? 0} POIs in the ${band} band (need ${p.perBandMin})`);
  }
  return { pois, built };
}

/** Marks the city's movement features (and what the districts report) for the site searches to keep clear of. */
function markFeatures(space: Space, ctx: PoiContext): void {
  const { city, keepClear } = ctx;
  for (const pad of city.jumpPads) space.mark(pad.position);
  for (const z of city.zipLines) space.markLine(z.a, z.b);
  for (const r of city.rails) for (let k = 1; k < r.points.length; k++) space.markLine(r.points[k - 1]!, r.points[k]!);
  for (const c of city.checkpoints) space.mark(c.position);
  for (const l of city.navLinks) {
    if (l.kind === 'pad') space.markLine(l.from, l.to);
    space.mark(l.from);
    space.mark(l.to);
  }
  for (const p of keepClear.points) space.mark(p);
  for (const [a, b] of keepClear.segments) space.markLine(a, b);
}

/**
 * The POI pass (Task 13): picks `pois.total` POIs from the districts' slots, balconies on building facades and street
 * furniture spots (see `select`), and builds what each needs: an access kit for an elevated POI the districts do not
 * already reach both ways (a balcony; a roof ≤ 7 m above the ground beside it gets mantle steps up and a drop link down,
 * a higher one a pad up and a zip line down to street level), a mailbox or a stall. Ids are `poi-<district>-<nn>` in
 * pick order. `extras` holds the kits' solids, pads, zip lines and navigation links, and `report.poiKits` the kits.
 * Throws when a quota cannot be met or an elevated POI is not reached both ways by the navigation links.
 */
export function placePois(slots: readonly PoiSlot[], ctx: PoiContext): { pois: Poi[]; extras: Partial<DistrictOutput> } {
  const p = poiParams(ctx.params, ctx);
  const space = new Space(ctx.city.chunkSize / 4);
  for (const s of ctx.city.solids) space.addSolid(s);
  markFeatures(space, ctx);
  const w: Pass = { ctx, p, space, reach: new Reach(space, ctx.city.navLinks), maxFall: ctx.orders.fragile.maxFallMeters };

  const all = [...slotCandidates(w, slots), ...balconyCandidates(w), ...furnitureCandidates(w)];
  const cands = weightedOrder(all, (c) => p.pickWeights[c.cost], ctx.rng);
  const { pois, built } = select(w, cands);

  const navLinks = built.flatMap((b) => b.navLinks);
  const reach = new Reach(space, [...ctx.city.navLinks, ...navLinks]);
  for (const poi of pois) {
    if (poi.elevated && !reach.both(poi.position)) throw new Error(`POI pass: ${poi.id} is not reached both ways by the navigation links`);
  }
  pois.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    pois,
    extras: {
      solids: built.flatMap((b) => b.solids),
      jumpPads: built.flatMap((b) => b.jumpPads),
      zipLines: built.flatMap((b) => b.zipLines),
      navLinks,
      report: { poiKits: built.flatMap((b) => (b.kit ? [b.kit] : [])) },
    },
  };
}
