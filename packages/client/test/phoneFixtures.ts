import type { HudModel, HudOffer, HudOrder } from '../src/ui/hudModel';

/** Hand-built HUD models for the phone tests. */
export function offer(id: string, over: Partial<HudOffer> = {}): HudOffer {
  return {
    id,
    kind: 'food',
    pickup: { x: 10, y: 0, z: -20 },
    pickupText: `Pick up ramen from Noodle Bar ${id}`,
    dropoffText: `Deliver to Elm Flats ${id}`,
    band: 'short',
    weightKg: null,
    secondsLeft: 14.2,
    reward: { points: 2, coins: 20 },
    acceptStatus: 'ok',
    ...over,
  };
}

export function order(id: string, over: Partial<HudOrder> = {}): HudOrder {
  return {
    id,
    kind: 'package',
    item: 'parcel',
    stage: `Deliver to Oak Court ${id}`,
    targetName: `Oak Court ${id}`,
    target: { x: 0, y: 0, z: 0 },
    distance: 120,
    prep: null,
    timer: { secondsLeft: 65, late: false },
    express: null,
    weightKg: 4,
    fragileIntact: null,
    route: null,
    ...over,
  };
}

export function model(over: Partial<HudModel> = {}): HudModel {
  return {
    totals: { points: 0, coins: 0, deliveries: 0 },
    load: { usedSlots: 0, slots: 3, carriedKg: 0, maxPackageKg: 50 },
    lockoutLeft: 0,
    orders: [],
    offers: [],
    safeZone: null,
    stamina: 1,
    garage: [],
    nextStop: null,
    ride: null,
    prompt: null,
    ...over,
  };
}
