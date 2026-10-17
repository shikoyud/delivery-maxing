import * as THREE from 'three';
import type { CatalogCategory } from '@dm/shared';
import { hashId } from '../greyboxMeshes';

/**
 * Placeholder box colour per catalog category (city design §7.3, Decision 7): food warm, shops coral, residential
 * cream, offices glass-blue, civic white, leisure green, industrial grey, service teal, landmarks gold. The non-building
 * categories only show up as props.
 */
const CATEGORY_COLORS: Record<CatalogCategory, number> = {
  food: 0xe8873a,
  shop: 0xe56f6f,
  residential: 0xeee3c8,
  office: 0x7fa7d6,
  civic: 0xf7f7f4,
  leisure: 0x7cc08a,
  industrial: 0x9a9da1,
  service: 0x3fa9a0,
  landmark: 0xd9b23c,
  prop: 0x8fb8b3,
  road: 0x6c6f73,
  terrain: 0x8f9a86,
  nature: 0x5f9a58,
  vehicle: 0x3d7fe0,
  orderItem: 0xd8b98a,
  courierVehicle: 0x1f9e93,
  fx: 0xffffff,
};

/** A catalog category's placeholder colour. */
export function categoryColor(category: CatalogCategory): number {
  return CATEGORY_COLORS[category];
}

/** Lightness drop of a `missing/` id (a model the packs lack), plus up to MISSING_HATCH more by its lot's hash. */
const MISSING_DARKEN = 0.14;
const MISSING_HATCH = 0.08;
/** ±lightness jitter by the lot's hash so neighbouring boxes of one category still read apart. */
const JITTER = 0.06;

/**
 * A lot box's colour: its category's, jittered by a hash of the lot id. A lot whose asset is a `missing/` id draws
 * darker, the amount varying per lot (by `hashId`), so the models still to be made stand out as a darker hatch.
 */
export function lotColor(lotId: string, assetId: string, category: CatalogCategory): THREE.Color {
  const h = hashId(lotId);
  const c = new THREE.Color(categoryColor(category));
  const jitter = ((h & 0xff) / 255 - 0.5) * JITTER;
  const missing = assetId.startsWith('missing/') ? MISSING_DARKEN + (((h >>> 8) & 0xff) / 255) * MISSING_HATCH : 0;
  return c.offsetHSL(0, 0, jitter - missing);
}
