import * as THREE from 'three';
import { COSMETIC_SLOTS, type CosmeticSlot, type Finish, type ShopItemId } from '@dm/shared';
import { wornItem, type Wardrobe } from '../economy/wardrobe';
import { palette } from './palette';

/**
 * How the cosmetics look (Decision 4): outfit colours on the courier's main material, vehicle paint on every ride's
 * body, bag colours on the carried boxes, phone cases on the phone's frame, and the three premium finishes for the
 * outfit and the paint.
 */

/** A colour, or a premium finish. `color: null` is the free factory paint: each ride keeps its own SP5 colours. */
export type Paint = { color: number | null } | { finish: Finish };

/** What the courier, the vehicles and the phone wear. */
export interface Look {
  outfit: Paint;
  vehicle: Paint;
  /** The carried boxes' colour. */
  bag: number;
  /** The phone frame's colour. */
  phone: number;
}

/** The finishes' material parameters (art, like the palette: not tuning). Neon glows in its own colour. */
export const FINISHES: Record<Finish, { color: number; metalness: number; roughness: number; emissive: number; emissiveIntensity: number }> = {
  gold: { color: 0xd4a017, metalness: 1, roughness: 0.3, emissive: 0x000000, emissiveIntensity: 1 },
  chrome: { color: 0xdfe3e8, metalness: 1, roughness: 0.1, emissive: 0x000000, emissiveIntensity: 1 },
  neon: { color: 0x39ff14, metalness: 0, roughness: 0.5, emissive: 0x39ff14, emissiveIntensity: 0.6 },
};

let envMap: THREE.DataTexture | null = null;

/**
 * A small sky-over-sand gradient the metals reflect (the scene has no environment, and a metal lit only by the
 * hemisphere light draws black). Equirectangular: the renderer prefilters it once (PMREM). Shared by every finish.
 */
export function finishEnvMap(): THREE.DataTexture {
  if (envMap) return envMap;
  // 2:1 equirectangular; the prefilter's cube is a quarter of the width (16 px).
  const w = 64;
  const h = 32;
  const data = new Uint8Array(w * h * 4);
  const top = new THREE.Color(palette.hemiSky);
  const horizon = new THREE.Color(0xffffff);
  const ground = new THREE.Color(palette.hemiGround);
  const c = new THREE.Color();
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1); // 0 = bottom row
    if (t < 0.5) c.lerpColors(ground, horizon, t / 0.5);
    else c.lerpColors(horizon, top, (t - 0.5) / 0.5);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = Math.round(c.r * 255);
      data[i + 1] = Math.round(c.g * 255);
      data[i + 2] = Math.round(c.b * 255);
      data[i + 3] = 255;
    }
  }
  envMap = new THREE.DataTexture(data, w, h);
  envMap.mapping = THREE.EquirectangularReflectionMapping;
  envMap.magFilter = THREE.LinearFilter;
  envMap.needsUpdate = true;
  return envMap;
}

/** Gold: 0xd4a017, metalness 1, roughness 0.3; Chrome: 0xdfe3e8, metalness 1, roughness 0.1; Neon: 0x39ff14 glowing at 0.6. */
export function finishMaterial(finish: Finish, base: THREE.MeshStandardMaterial): void {
  const f = FINISHES[finish];
  base.color.setHex(f.color);
  base.metalness = f.metalness;
  base.roughness = f.roughness;
  base.emissive.setHex(f.emissive);
  base.emissiveIntensity = f.emissiveIntensity;
  base.envMap = finishEnvMap();
}

/** A material's own surface, kept so a colour after a finish brings it back. */
export interface Surface {
  metalness: number;
  roughness: number;
  emissive: number;
  emissiveIntensity: number;
  envMap: THREE.Texture | null;
}

type Painted = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;

export function surfaceOf(m: Painted): Surface {
  const std = m as THREE.MeshStandardMaterial;
  return {
    metalness: std.isMeshStandardMaterial ? std.metalness : 0,
    roughness: std.isMeshStandardMaterial ? std.roughness : 1,
    emissive: m.emissive.getHex(),
    emissiveIntensity: m.emissiveIntensity,
    envMap: m.envMap,
  };
}

/**
 * Paints `m` in place: a colour on its own `surface`, or a finish (finishMaterial on a standard material; a Lambert
 * one takes the finish's colour and glow, it has no metal).
 */
export function paintMaterial(m: Painted, paint: Paint, surface: Surface, factory: number): void {
  const std = m as THREE.MeshStandardMaterial;
  const env = m.envMap;
  if ('finish' in paint) {
    if (std.isMeshStandardMaterial) finishMaterial(paint.finish, std);
    else {
      const f = FINISHES[paint.finish];
      m.color.setHex(f.color);
      m.emissive.setHex(f.emissive);
      m.emissiveIntensity = f.emissiveIntensity;
    }
  } else {
    m.color.setHex(paint.color ?? factory);
    if (std.isMeshStandardMaterial) {
      std.metalness = surface.metalness;
      std.roughness = surface.roughness;
    }
    m.emissive.setHex(surface.emissive);
    m.emissiveIntensity = surface.emissiveIntensity;
    m.envMap = surface.envMap;
  }
  if (m.envMap !== env) m.needsUpdate = true; // an env map coming or going changes the shader; colours do not
}

/** Whether two looks draw the same (Game repaints only on a change). */
export function sameLook(a: Look, b: Look): boolean {
  return samePaint(a.outfit, b.outfit) && samePaint(a.vehicle, b.vehicle) && a.bag === b.bag && a.phone === b.phone;
}

function samePaint(a: Paint, b: Paint): boolean {
  return 'finish' in a ? 'finish' in b && a.finish === b.finish : 'color' in b && a.color === b.color;
}

/**
 * Draws a look only when it differs from the last one drawn: the chain changes on every payout, settle and lock
 * renewal, and a repaint for nothing would churn materials. Returns whether `draw` ran.
 */
export function lookApplier(draw: (look: Look) => void): (look: Look) => boolean {
  let last: Look | null = null;
  return (look) => {
    if (last && sameLook(last, look)) return false;
    last = look;
    draw(look);
    return true;
  };
}

/** The pack car's scale: its model is shorter than the collider it drives with (Decision 13: 4.4 / 3.3). */
export function carModelScale(modelLength: number, colliderLength: number): number {
  return colliderLength / modelLength;
}

/** What `w` looks like with the premium skins the chain owns (`skins`); an unowned skin draws the slot's free item. */
export function lookOf(w: Wardrobe, skins: readonly ShopItemId[]): Look {
  const paint = {} as Record<CosmeticSlot, Paint>;
  for (const slot of COSMETIC_SLOTS) {
    const item = wornItem(w, slot, skins);
    if (item.kind === 'skin' && item.finish) paint[slot] = { finish: item.finish };
    else paint[slot] = { color: item.kind === 'cosmetic' && item.color !== undefined ? item.color : null };
  }
  const colour = (p: Paint, fallback: number): number => ('color' in p && p.color !== null ? p.color : fallback);
  return { outfit: paint.outfit, vehicle: paint.vehicle, bag: colour(paint.bag, palette.parcel), phone: colour(paint.phone, palette.phoneCase) };
}
