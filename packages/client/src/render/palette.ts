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
} as const;

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
