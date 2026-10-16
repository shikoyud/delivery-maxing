import { vec3, type CatalogIndex, type CityConfig, type Lot, type PoiRole, type Rng, type Vec3 } from '@dm/shared';

// Doors and POIs (city design section 6, the prototype's POI pass). Every building with catalog POI roles gets a
// front door; pickPois then keeps the doors the game uses: the slope walk-ups' upper doors, pickups up to the caps,
// then dropoffs, each at least `doorSpacing` from every door already kept, up to `target` doors in all.

const isPickup = (r: PoiRole): boolean => r === 'foodPickup' || r === 'packagePickup';

/** The roles a lot's door takes: its own (narrowed by pickPois) or the catalog's. */
function rolesOf(lot: Lot, cat: CatalogIndex): PoiRole[] {
  return lot.roles ?? cat.get(lot.asset).poi?.roles ?? [];
}

/**
 * A door for every building with POI roles (props, open lots and role-less buildings get none): centred on the lot's
 * `facing` edge, `door.offset` (0.5 m) outside the rect on the sidewalk, at the lot's base height.
 */
export function assignDoors(lots: Lot[], cat: CatalogIndex, cfg: CityConfig): Lot[] {
  const off = cfg.door.offset;
  return lots.map((lot): Lot => {
    if (lot.prop || lot.open || rolesOf(lot, cat).length === 0) return { ...lot, door: null };
    const r = lot.rect;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const at = { S: [cx, r.minZ - off], N: [cx, r.maxZ + off], E: [r.maxX + off, cz], W: [r.minX - off, cz] }[lot.facing];
    return { ...lot, door: vec3(at[0]!, lot.y, at[1]!) };
  });
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/**
 * Chooses the doors the game uses (the prototype's selection). Spacing is measured in 3D, so a walk-up's front door
 * on the lower street and its upper door 14 m above count as two doors.
 *  1. every upper door (food-only dropoffs on the slope walk-ups) is kept;
 *  2. pickups, package senders first, each kind up to its cap (`foodPickupCap`, `packagePickupCap`); a restaurant or
 *     shop past the cap, or too close to a kept door, falls through to step 3 with only its dropoff roles;
 *  3. dropoffs, in random order, until `target` doors are kept.
 * A lot whose front door is not kept gets `door: null`; a kept door whose roles are narrower than the catalog's
 * records them in `roles`.
 */
export function pickPois(lots: Lot[], cat: CatalogIndex, cfg: CityConfig, rng: Rng): Lot[] {
  const { foodPickupCap, packagePickupCap, target, doorSpacing } = cfg.pois;
  const kept: Vec3[] = [];
  const minSq = doorSpacing * doorSpacing;
  const farEnough = (p: Vec3): boolean => kept.every((q) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2 >= minSq);

  for (const lot of lots) if (lot.upperDoor) kept.push(lot.upperDoor.position);
  if (kept.length > target) throw new Error(`pois: ${kept.length} upper doors exceed the target of ${target}`);

  const out = new Map<string, { door: Vec3; roles: PoiRole[] }>();
  const candidates = shuffle(lots.filter((l) => l.door), rng);
  const pickups = candidates.filter((l) => rolesOf(l, cat).some(isPickup));
  // package senders first (they are fewer and need car roads), as the prototype
  pickups.sort((a, b) => Number(!rolesOf(a, cat).includes('packagePickup')) - Number(!rolesOf(b, cat).includes('packagePickup')));
  const fallThrough = new Set<string>();
  let food = 0;
  let pkg = 0;
  for (const lot of pickups) {
    const roles = rolesOf(lot, cat);
    const isPkg = roles.includes('packagePickup');
    const room = isPkg ? pkg < packagePickupCap : food < foodPickupCap;
    if (room && kept.length < target && farEnough(lot.door!)) {
      if (isPkg) pkg++;
      else food++;
      kept.push(lot.door!);
      out.set(lot.id, { door: lot.door!, roles });
    } else {
      fallThrough.add(lot.id);
    }
  }
  for (const lot of candidates) {
    if (kept.length >= target) break;
    if (out.has(lot.id)) continue;
    const roles = fallThrough.has(lot.id) ? rolesOf(lot, cat).filter((r) => !isPickup(r)) : rolesOf(lot, cat);
    if (roles.length === 0 || !farEnough(lot.door!)) continue;
    kept.push(lot.door!);
    out.set(lot.id, { door: lot.door!, roles });
  }

  return lots.map((lot): Lot => {
    const k = out.get(lot.id);
    const rest: Lot = { ...lot };
    delete rest.roles;
    if (!k) return { ...rest, door: null };
    const catalog = cat.get(lot.asset).poi?.roles ?? [];
    const same = k.roles.length === catalog.length && k.roles.every((r) => catalog.includes(r));
    return same ? { ...rest, door: k.door } : { ...rest, door: k.door, roles: k.roles };
  });
}
