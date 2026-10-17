import type { AccessKind, SolidKind } from '@dm/shared';

/**
 * Fictional courier palette (teal and coral on warm sand). Never orange on black (spec §16 branding).
 * Colours are art, not tuning, so they live here rather than in config/.
 */
export const palette = {
  sky: 0xbfe3ea,
  hemiSky: 0xdff4f7,
  hemiGround: 0x9a8f7c,
  sun: 0xfff3e0,
  water: 0x2a8c9e,
  gridLine: 0xc4bba6,
  teal: 0x1f9e93,
  coral: 0xf27166,
  /** Skateboard wheels. */
  wheel: 0xe6edf0,
  /** POI door markers by role: food pickup, package pickup, dropoff. */
  poiFood: 0xf2913d,
  poiPackage: 0x8a6cf0,
  poiDrop: 0x8d9aa1,
  /** Hospital block and its cross; the safe-zone ring. */
  hospital: 0xf7f6f2,
  hospitalCross: 0xd93a3a,
  safeZone: 0x5fc9a8,
  /** Cardboard parcels on the courier's back. */
  parcel: 0xd8b98a,
  /** Vehicle placeholders: tyres, metal trim (hubs, bars, forks), seats, glass, lights. */
  tyre: 0x33393d,
  trim: 0xb8c2c7,
  seat: 0x4a4f55,
  glass: 0xa9dde6,
  headlight: 0xfff6d8,
  taillight: 0xd93a3a,
  /** Vehicle bodies: a coral deck, a teal bicycle, a blue motorbike and a teal-and-cream car. */
  skateDeck: 0xf27166,
  bicycleFrame: 0x1f9e93,
  motorbikeBody: 0x3d7fe0,
  carBody: 0x1f9e93,
  carRoof: 0xf3ecdf,
  /** Gas stations: the FUEL sign (cream letters on teal) and the refuel glow around each pump point. */
  fuelSign: 0x1f9e93,
  fuelLetters: 0xf7f6f2,
  pumpGlow: 0x7ff0c8,
} as const;

/** Access-zone overlay (F3) colour per zone kind. */
export const accessZoneColors: Record<AccessKind, number> = {
  alley: 0x8a6cf0,
  steepLane: 0xf2c94c,
  stairs: 0xd93a3a,
  path: 0x5fc9a8,
};

/** The F4 map debug view (ui/mapDebug): lots with POI roles by straight-line distance band from the player. */
export const mapDebugColors = {
  short: 0x2ec4b6,
  medium: 0xf5a524,
  long: 0x9b6bff,
} as const;

/** The F4 view's overlays: chunk grid lines, the physics-loaded chunks' tint and the accent of a lot label without roles. */
export const mapDebugOverlay = { grid: 0xffffff, loadedChunk: 0x3d7fe0, plainLot: 0xb8c4c8 } as const;

/**
 * One colour per active-order slot (the car, the largest carrier, holds 5): waypoint beams and the HUD swatches share them.
 * Ordered so the first slots read best against the sky and the sand.
 */
export const slotColors = [0xf27166, 0x8a6cf0, 0x16b3a4, 0xe25c9e, 0x3d7fe0] as const;

export const cssHex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Base colour per solid kind; each solid is tinted around it by a hash of its id. */
export const kindColor: Record<SolidKind, number> = {
  ground: 0xd9d1c0,
  building: 0xe8e1d3,
  prop: 0x8fb8b3,
  ramp: 0x6fc2b8,
  hospital: 0xf7f6f2,
  road: 0x9a9a98,
  terrain: 0x8f9a86,
  parapet: 0xb9b2a3,
  stairs: 0xc9c2b2,
  water: 0x1f6f80,
};

/**
 * City region geometry (render/city/regions.ts): asphalt for roads, ramps and stairs with a lighter sidewalk strip
 * along each long side, and the flat colours of the layout's ground areas (sand, piers and parks read apart).
 */
export const cityPalette = {
  asphalt: 0x4a4e52,
  sidewalk: 0xbdb7aa,
  sand: 0xe3d3a4,
  pier: 0x9c8466,
  breakwater: 0x9a9893,
  park: 0x8fbf7a,
  sports: 0x6fae6a,
  plaza: 0xd9d2c3,
  parking: 0x8d9093,
  quay: 0xb3ada2,
  containerYard: 0xa7a39a,
  rail: 0x7d746a,
  boardwalk: 0xb58e62,
  marina: 0xa99c87,
  hospitalLot: 0xe4e1d8,
  gasLot: 0x9a9c9e,
} as const;

/** Facade tints mixed into buildings (cream, pale teal, pale coral, sand, stone). */
export const buildingTints = [0xf3ecdf, 0xa9ddd5, 0xf6b9ae, 0xead9b5, 0xd6dde0, 0x8fcfc6] as const;
