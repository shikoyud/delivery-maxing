import type { SolidKind } from '@dm/shared';

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
  cable: 0x4a5a63,
  post: 0x5f7480,
  rail: 0xe6edf0,
  padDisc: 0x1f9e93,
  padRing: 0xffffff,
  padArrow: 0xfff1a8,
  orb: 0xffd94a,
  chuteStripe: 0xfff6ea,
  plazaRing: 0x1f9e93,
  dropZone: 0x9fdcd4,
  dropZoneRing: 0xfff6ea,
  kioskBody: 0x1f9e93,
  kioskCounter: 0xf7f3ea,
  kioskCanopy: 0xf27166,
  kioskScreen: 0x16323a,
  poiIdle: 0x7d929c,
  poiTarget: 0xf27166,
} as const;

/**
 * One colour per active-order slot (backpack holds up to 5): waypoint beams and the HUD swatches share them.
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
  chute: 0xf28b80,
  hub: 0x1f9e93,
};

/** Facade tints mixed into buildings (cream, pale teal, pale coral, sand, stone). */
export const buildingTints = [0xf3ecdf, 0xa9ddd5, 0xf6b9ae, 0xead9b5, 0xd6dde0, 0x8fcfc6] as const;
