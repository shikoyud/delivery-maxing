import { expect, test } from 'vitest';
import { cityConfig, dropoffText, layoutToMap, mulberry32, itemPhrase, namesConfig, pickupText, vec3, type Lot, type Vec3 } from '@dm/shared';
import { readCatalog } from '../../src/city/files';
import { generateLayout } from '../../src/city/generate';
import { assignDoors, pickPois } from '../../src/city/pois';
import { REPO } from '../../src/nav/files';

const cat = readCatalog(REPO);
const layout = generateLayout(cityConfig, namesConfig, cat);
const pois = layoutToMap(layout, cat).pois;
const cap = cityConfig.pois;

const lot = (over: Partial<Lot>): Lot => ({
  id: 'lot-t',
  asset: 'mega/Bakery_01',
  rect: { minX: 100, minZ: 320, maxX: 105, maxZ: 326 },
  y: 10,
  facing: 'S',
  level: 'L1',
  district: 'downtown',
  block: 'blk',
  name: 'Crumb & Co. Bakery',
  address: '14 Market St',
  door: null,
  upperDoor: null,
  prop: false,
  open: false,
  ...over,
});

test('assignDoors: the door is centred on the facing edge, 0.5 m outside the rect, at the lot base', () => {
  const off = cityConfig.door.offset;
  expect(off).toBe(0.5);
  const [s, n, e, w] = assignDoors(
    (['S', 'N', 'E', 'W'] as const).map((facing) => lot({ id: `lot-${facing}`, facing })),
    cat,
    cityConfig,
  );
  expect(s!.door).toEqual(vec3(102.5, 10, 319.5));
  expect(n!.door).toEqual(vec3(102.5, 10, 326.5));
  expect(e!.door).toEqual(vec3(105.5, 10, 323));
  expect(w!.door).toEqual(vec3(99.5, 10, 323));
});

test('assignDoors: props, open lots and lots without catalog roles get no door', () => {
  const out = assignDoors(
    [lot({ id: 'a', prop: true }), lot({ id: 'b', open: true }), lot({ id: 'c', asset: 'mega/Factory_01' })],
    cat,
    cityConfig,
  );
  expect(out.map((l) => l.door)).toEqual([null, null, null]);
});

test('pickPois caps pickups; the rest of the restaurants and shops keep only their dropoff roles', () => {
  const food = pois.filter((p) => p.roles.includes('foodPickup'));
  const pkg = pois.filter((p) => p.roles.includes('packagePickup'));
  expect(food.length).toBeLessThanOrEqual(cap.foodPickupCap);
  expect(pkg.length).toBeLessThanOrEqual(cap.packagePickupCap);
  // the caps are what limits pickups (the city has more restaurants and shops than that)
  expect(food.length).toBeGreaterThan(cap.foodPickupCap * 0.9);
  expect(pkg.length).toBeGreaterThan(cap.packagePickupCap * 0.6);
  const narrowed = layout.lots.filter((l) => l.door && l.roles);
  expect(narrowed.length).toBeGreaterThan(0);
  for (const l of narrowed) {
    expect(l.roles!.length).toBeGreaterThan(0);
    expect(l.roles!.every((r) => r.startsWith('dropoff'))).toBe(true);
  }
  // every pickup names its items for the order text
  for (const p of [...food, ...pkg]) expect(p.items?.length).toBeGreaterThan(0);
});

test('every two doors are at least doorSpacing apart', () => {
  const doors: Vec3[] = pois.map((p) => p.position);
  for (let i = 0; i < doors.length; i++) {
    for (let j = i + 1; j < doors.length; j++) {
      const a = doors[i]!;
      const b = doors[j]!;
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), `${pois[i]!.id} / ${pois[j]!.id}`).toBeGreaterThanOrEqual(cap.doorSpacing);
    }
  }
});

test('every door is 0.5 m outside its lot rect on the facing side, centred on the front', () => {
  const withDoor = layout.lots.filter((l) => l.door);
  expect(withDoor.length).toBeGreaterThan(500);
  for (const l of withDoor) {
    const d = l.door!;
    const r = l.rect;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const want = { S: [cx, r.minZ - 0.5], N: [cx, r.maxZ + 0.5], E: [r.maxX + 0.5, cz], W: [r.minX - 0.5, cz] }[l.facing];
    expect([d.x, d.z], l.id).toEqual(want);
    expect(d.y).toBe(l.y);
  }
});

test('slope lots keep their upper door; no lot keeps a door without a POI role', () => {
  const slope = layout.lots.filter((l) => l.district === 'slope');
  expect(slope.length).toBeGreaterThan(0);
  for (const l of slope) expect(l.upperDoor, l.id).not.toBeNull();
  for (const l of layout.lots.filter((x) => x.door)) {
    expect(l.prop).toBe(false);
    expect((l.roles ?? cat.get(l.asset).poi?.roles ?? []).length).toBeGreaterThan(0);
  }
});

test('the total is 700-800 doors', () => {
  expect(pois.length).toBeGreaterThanOrEqual(700);
  expect(pois.length).toBeLessThanOrEqual(cap.target);
});

test('pickPois is deterministic and stops at target', () => {
  const bare = layout.lots.map((l): Lot => {
    const c: Lot = { ...l, door: null };
    delete c.roles;
    return c;
  });
  const doored = assignDoors(bare, cat, cityConfig);
  const a = pickPois(doored, cat, cityConfig, mulberry32(7));
  const b = pickPois(doored, cat, cityConfig, mulberry32(7));
  expect(a).toEqual(b);
  const small = pickPois(doored, cat, { ...cityConfig, pois: { ...cap, target: 200 } }, mulberry32(7));
  const count = small.filter((l) => l.door).length + small.filter((l) => l.upperDoor).length;
  expect(count).toBeLessThanOrEqual(200);
});

test('order texts of the generated city name businesses and addresses, never a catalog id', () => {
  const rng = mulberry32(5);
  for (const p of pois) {
    expect(p.name, p.id).not.toMatch(/^(mega|trop|missing)\//);
    expect(p.address, p.id).toMatch(/^\d+ \S/);
    const text = p.roles.some((r) => r.endsWith('Pickup')) ? pickupText(p, itemPhrase(p.items![0]!, rng), null) : dropoffText(p);
    expect(text).not.toMatch(/(mega|trop|missing)\//);
    expect(text).toContain(p.address!);
  }
});
