import { vec3 } from '../../src/math/vec3';
import type { Poi } from '../../src/world/mapTypes';
import { testOrderRules } from '../world/fixtures';

/** Player stands at the origin. Street (Manhattan) distances are noted per POI. */
export const offerPlayer = vec3(0, 0, 0);
export const offerRules = testOrderRules(); // bands 150/350, food dropoff 80..400, maxPickupDistance 250

export const offerPois = (): Poi[] => [
  // food pickups: 50 m and 300 m (too far) from the player
  { id: 'fp-near', position: vec3(50, 0, 0), district: 'downtown', kind: 'counter', name: 'Near Noodles', roles: ['foodPickup'], items: ['noodles', 'dumplings'] },
  { id: 'fp-far', position: vec3(300, 0, 0), district: 'downtown', kind: 'counter', name: 'Far Fryer', roles: ['foodPickup'], items: ['fries'] },
  // food dropoffs: 150 m and 40 m from fp-near (the latter is under the 80 m minimum)
  { id: 'df-ok', position: vec3(200, 0, 0), district: 'downtown', kind: 'door', name: '1 Ok St', roles: ['dropoffFood'] },
  { id: 'df-close', position: vec3(50, 0, 40), district: 'downtown', kind: 'door', name: '2 Close St', roles: ['dropoffFood'] },
  // package senders: light (5..20 kg) 60 m away, heavy (30..40 kg) 60 m away
  { id: 'ps-light', position: vec3(0, 0, 60), district: 'downtown', kind: 'counter', name: 'Light Parcels', roles: ['packagePickup'], items: ['parcel'], weightKg: [5, 20] },
  { id: 'ps-heavy', position: vec3(0, 0, -60), district: 'downtown', kind: 'counter', name: 'Heavy Freight', roles: ['packagePickup'], items: ['crate'], weightKg: [30, 40] },
  // package dropoff: 300 m from ps-light
  { id: 'dp-1', position: vec3(300, 0, 60), district: 'downtown', kind: 'door', name: '3 Pkg Ave', roles: ['dropoffPackage'] },
];
