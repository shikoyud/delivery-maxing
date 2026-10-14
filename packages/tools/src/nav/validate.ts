import { baySlot, navConfig, RIDE_TIERS, type MapData, type NavConfig, type NavRouter, type Poi, type Vec3, type VehicleTier } from '@dm/shared';

// The greybox's navigation checks, run by `pnpm map:check` on the committed navmeshes.

const fmt = (p: Vec3): string => `(${p.x}, ${p.y}, ${p.z})`;
const isPackageDoor = (p: Poi): boolean => p.roles.includes('packagePickup') || p.roles.includes('dropoffPackage');

/**
 * How far a courier walks from where a car stops to `door`: 0 when the car reaches the door, the foot path length
 * from the car mesh's closest reachable point otherwise, Infinity when no car route from `carStart` gets near.
 */
export function footFromCar(router: NavRouter, carStart: Vec3, door: Vec3): number {
  const route = router.routeToDoor('car', carStart, door);
  if (!route) return Infinity;
  return route.footLeg ? router.distance('walk', route.footLeg[0], door) : 0;
}

/**
 * Every navigation problem of `map` on `router`'s meshes, one message per failure: a POI door not reachable on foot
 * from a hospital spawn, or the spawn not reachable back from it; a package door farther than
 * nav.carRoadMaxDoorDistance on foot from the car mesh; more than nav.maxFoodOffCarShare of the food dropoffs that far;
 * a pump or a bay slot off the car or motorbike mesh, or not reachable on it from a hospital bay.
 */
export function validateGreyboxNav(map: MapData, router: NavRouter, nav: NavConfig = navConfig): string[] {
  const messages: string[] = [];
  const tol = nav.reachTolerance;
  const maxFoot = nav.carRoadMaxDoorDistance;

  for (const poi of map.pois) {
    for (const h of map.hospitals) {
      if (!Number.isFinite(router.distance('walk', h.spawn, poi.position))) {
        messages.push(`${poi.id}: door ${fmt(poi.position)} not reachable on foot from the ${h.id} spawn`);
      }
      if (!Number.isFinite(router.distance('walk', poi.position, h.spawn))) {
        messages.push(`${poi.id}: the ${h.id} spawn not reachable on foot from door ${fmt(poi.position)}`);
      }
    }
  }

  const bays = map.hospitals.map((h) => ({ id: h.id, at: baySlot(h, 0).position }));
  const carStart = bays[0]?.at;
  if (carStart) {
    const foot = new Map(map.pois.map((p) => [p.id, footFromCar(router, carStart, p.position)]));
    for (const p of map.pois.filter(isPackageDoor)) {
      const d = foot.get(p.id)!;
      if (d <= maxFoot) continue;
      const far = Number.isFinite(d) ? `${d.toFixed(1)} m on foot from the car mesh` : 'not reachable on foot from any car stop';
      messages.push(`${p.id}: package door is ${far} (max ${maxFoot} m)`);
    }
    const food = map.pois.filter((p) => p.roles.includes('dropoffFood'));
    const far = food.filter((p) => foot.get(p.id)! > maxFoot);
    if (far.length > nav.maxFoodOffCarShare * food.length) {
      messages.push(
        `food dropoffs: ${far.length} of ${food.length} are more than ${maxFoot} m on foot from the car mesh ` +
          `(max share ${nav.maxFoodOffCarShare}): ${far.map((p) => p.id).join(', ')}`,
      );
    }
  }

  const spots: { label: string; at: Vec3 }[] = [
    ...map.gasStations.flatMap((g) => g.pumps.map((at, i) => ({ label: `${g.id} pump ${i}`, at }))),
    ...map.hospitals.flatMap((h) => RIDE_TIERS.map((_, i) => ({ label: `${h.id} bay slot ${i}`, at: baySlot(h, i).position }))),
  ];
  const tiers: VehicleTier[] = ['car', 'motorbike'];
  for (const tier of tiers) {
    for (const s of spots) {
      const on = router.closestPoint(tier, s.at);
      if (!on || Math.hypot(on.x - s.at.x, on.z - s.at.z) > tol || Math.abs(on.y - s.at.y) > tol) {
        messages.push(`${s.label}: ${fmt(s.at)} is not on the ${tier} mesh`);
        continue;
      }
      for (const b of bays) {
        if (!Number.isFinite(router.distance(tier, b.at, s.at))) {
          messages.push(`${s.label}: not reachable by ${tier} from the ${b.id} bay`);
        }
      }
    }
  }
  return messages;
}
